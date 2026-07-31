"""MCQ PDF ingest helpers: folder → source_type, text/OCR extract → JSON rows."""
from __future__ import annotations

import base64
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import fitz

from ..chapters import infer_chapter_from_text
from ..config import settings
from ..llm import get_groq_client, get_openai_client


def _get_ingest_client():
    """Return the best available client for MCQ ingestion.

    Priority: OpenAI (gpt-4o-mini, cheapest) > Groq (free but rate-limited).
    """
    if settings.openai_ready:
        return get_openai_client(), "openai"
    if settings.groq_ready:
        return get_groq_client(), "groq"
    return None, None


class TokenTracker:
    """Accumulates token usage across all LLM calls during an ingest run."""

    def __init__(self):
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.calls = 0

    def record(self, response):
        usage = getattr(response, "usage", None)
        if usage:
            self.prompt_tokens += usage.prompt_tokens or 0
            self.completion_tokens += usage.completion_tokens or 0
            self.calls += 1

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def cost_usd(self, input_price: float = 0.15, output_price: float = 0.60) -> float:
        """Estimated cost in USD. Defaults to gpt-4o-mini pricing per 1M tokens."""
        return (self.prompt_tokens / 1e6) * input_price + (self.completion_tokens / 1e6) * output_price

    def summary(self) -> str:
        cost = self.cost_usd()
        return (
            f"API calls: {self.calls} | "
            f"Input tokens: {self.prompt_tokens:,} | "
            f"Output tokens: {self.completion_tokens:,} | "
            f"Total tokens: {self.total_tokens:,} | "
            f"Est. cost (gpt-4o-mini): ${cost:.4f}"
        )


token_tracker = TokenTracker()

# Pages with at least this much extractable text use text structuring only
# (no vision fallback). Thin/scanned pages go to vision.
TEXT_MIN_CHARS = 50

MCQ_VISION_PROMPT = """Extract all multiple-choice questions (MCQs) from this exam/test page image.
Return JSON only (no markdown):
{"questions":[{"question_text":"...","options":[{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],"correct_option":"A"|"B"|"C"|"D"|null,"explanation":null}]}

Rules:
- Include every complete MCQ on the page (Biology preferred; skip non-biology if obvious).
- Options must be A–D when present.
- If the correct answer is marked (tick, bold, answer key), set correct_option; else null.
- Keep scientific English. Do not invent options.
- If no MCQs, return {"questions":[]}.
"""

TEXT_EXTRACT_PROMPT = """Extract all MCQs from this exam page text.
Return JSON only:
{"questions":[{"question_text":"...","options":[{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."},{"key":"D","text":"..."}],"correct_option":"A"|"B"|"C"|"D"|null,"explanation":null}]}
If none: {"questions":[]}.
"""

FOLDER_SOURCE_TYPE: list[tuple[str, str]] = [
    ("most repeated", "most_repeated"),
    ("flps", "flp"),
    ("kips flps", "flp"),
    ("steps", "academy_test"),
    ("biology", "academy_test"),
    ("other resources", "past_paper"),
]


@dataclass
class ExtractedMcq:
    question_text: str
    options: list[dict[str, str]]
    correct_option: Optional[str]
    explanation: Optional[str] = None


def infer_source_type(path: Path) -> str:
    parts = " / ".join(p.lower() for p in path.parts)
    for needle, st in FOLDER_SOURCE_TYPE:
        if needle in parts:
            return st
    return "academy_test"


def is_mnemonic_pdf(path: Path) -> bool:
    return "mnemonic" in path.name.lower()


def list_mcq_pdfs(data_root: Path) -> list[Path]:
    skip_dirs = {"textbooks", "_extracted", "_cache", "__pycache__"}
    pdfs: list[Path] = []
    for p in data_root.rglob("*.pdf"):
        if any(part.lower() in skip_dirs for part in p.parts):
            continue
        if is_mnemonic_pdf(p):
            continue
        pdfs.append(p)
    return sorted(pdfs)


def _parse_questions_json(raw: str) -> list[ExtractedMcq]:
    text = (raw or "").strip()
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    items = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out: list[ExtractedMcq] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        qtext = (item.get("question_text") or "").strip()
        options = item.get("options") or []
        if not qtext or not isinstance(options, list) or len(options) < 2:
            continue
        norm_opts = []
        for opt in options:
            if not isinstance(opt, dict):
                continue
            key = str(opt.get("key", "")).strip().upper()[:1]
            ot = str(opt.get("text", "")).strip()
            if key and ot:
                norm_opts.append({"key": key, "text": ot})
        if len(norm_opts) < 2:
            continue
        correct = item.get("correct_option")
        correct_s = str(correct).strip().upper()[:1] if correct else None
        if correct_s and correct_s not in {o["key"] for o in norm_opts}:
            correct_s = None
        out.append(
            ExtractedMcq(
                question_text=qtext,
                options=norm_opts,
                correct_option=correct_s,
                explanation=item.get("explanation"),
            )
        )
    return out


def _to_data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _groq_with_retry(create_fn, *, label: str, max_retries: int = 8):
    """Call Groq; on 429 sleep and retry (parses wait hint when present)."""
    last_err: Exception | None = None
    for attempt in range(max_retries):
        try:
            return create_fn()
        except Exception as exc:
            last_err = exc
            name = type(exc).__name__
            msg = str(exc)
            is_rate = (
                "429" in msg
                or "rate_limit" in msg.lower()
                or name == "RateLimitError"
            )
            if not is_rate:
                raise
            wait = 60.0
            m = re.search(r"try again in ([\d.]+)s", msg, re.IGNORECASE)
            if m:
                wait = float(m.group(1)) + 2.0
            wait = min(max(wait, 5.0), 600.0)
            print(
                f"    [rate-limit] {label}: waiting {wait:.0f}s "
                f"(attempt {attempt + 1}/{max_retries})"
            )
            time.sleep(wait)
    raise last_err  # type: ignore[misc]


def looks_like_non_mcq_page(page_text: str) -> bool:
    """Promo / contact / cover pages — skip vision to save tokens."""
    t = (page_text or "").lower()
    if not t.strip():
        return False
    promo_hits = sum(
        1
        for w in (
            "instagram",
            "whatsapp",
            "preptitans",
            "@preptitans",
            "scan the qr",
            "follow our",
            "community groups",
        )
        if w in t
    )
    if promo_hits >= 2:
        return True
    # Tiny OCR watermark only (real MCQs are in the scan image)
    if len(t.strip()) < 40 and "camscanner" in t:
        return False
    return False


def extract_mcqs_from_page_image(png_bytes: bytes) -> list[ExtractedMcq]:
    client, provider = _get_ingest_client()
    if client is None:
        print("    [vision] no ingest API key configured (set OPENAI_API_KEY)")
        return []

    def _call():
        kwargs: dict = dict(
            model=settings.MCQ_VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": MCQ_VISION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": _to_data_url(png_bytes)},
                        },
                    ],
                }
            ],
            max_tokens=3500,
            temperature=0.1,
        )
        if provider == "groq":
            kwargs["reasoning_effort"] = "none"
        return client.chat.completions.create(**kwargs)

    response = _groq_with_retry(_call, label="vision")
    token_tracker.record(response)
    raw = response.choices[0].message.content or ""
    parsed = _parse_questions_json(raw)
    if not parsed:
        preview = re.sub(r"\s+", " ", raw)[:160]
        print(f"    [vision] no MCQs parsed (raw: {preview!r})", flush=True)
    return parsed


def extract_mcqs_from_page_text(page_text: str) -> list[ExtractedMcq]:
    if not page_text.strip():
        return []
    client, provider = _get_ingest_client()
    if client is None:
        print("    [text] no ingest API key configured (set OPENAI_API_KEY)")
        return []
    if looks_like_non_mcq_page(page_text):
        return []
    if not re.search(r"\b[A-Da-d][).]\s", page_text) and "?" not in page_text:
        return []

    def _call():
        return client.chat.completions.create(
            model=settings.MCQ_TEXT_MODEL,
            messages=[
                {"role": "system", "content": TEXT_EXTRACT_PROMPT},
                {"role": "user", "content": page_text[:6000]},
            ],
            max_tokens=2000,
            temperature=0.1,
        )

    response = _groq_with_retry(_call, label="text")
    token_tracker.record(response)
    return _parse_questions_json(response.choices[0].message.content or "")


def render_page_png(page: fitz.Page, zoom: float = 1.4) -> bytes:
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return pix.tobytes("png")


def _ocr_scanned_page(page: fitz.Page, *, zoom: float = 2.0) -> str:
    """Render a thin/scanned page and OCR with local Tesseract (no vision API).

    Prefers a large embedded full-page image when present (common in phone
    scans), otherwise falls back to a rendered pixmap.
    """
    from ..textbook_rag.extract import ocr_with_tesseract

    candidates: list[bytes] = []

    # Full-page phone/CamScanner JPEGs often OCR better than re-rasterizing
    try:
        doc = page.parent
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                base = doc.extract_image(xref)
            except Exception:
                continue
            if not base or not base.get("image"):
                continue
            w, h = int(base.get("width") or 0), int(base.get("height") or 0)
            if w * h < 200_000:
                continue
            candidates.append(base["image"])
    except Exception:
        pass

    candidates.append(render_page_png(page, zoom=zoom))

    best = ""
    for blob in candidates:
        text = ocr_with_tesseract(blob)
        if len(text.strip()) > len(best.strip()):
            best = text
        if len(best.strip()) >= 400:
            break
    return best


def extract_pdf_mcqs(
    pdf_path: Path,
    *,
    start_page: int = 0,
    max_pages: Optional[int] = None,
    prefer_text: bool = True,
    page_pause_sec: float = 1.5,
) -> list[dict[str, Any]]:
    doc = fitz.open(pdf_path)
    rows: list[dict[str, Any]] = []
    end = len(doc) if max_pages is None else min(len(doc), start_page + max_pages)
    chapter_hint = infer_chapter_from_text(pdf_path.stem) or infer_chapter_from_text(
        str(pdf_path)
    )

    total_pages = end - start_page
    print(f"    pages {start_page + 1}-{end} of {len(doc)} ({total_pages} to process)")

    for i in range(start_page, end):
        page = doc[i]
        text = page.get_text() or ""
        text_len = len(text.strip())
        mcqs: list[ExtractedMcq] = []
        mode = "skip"

        if looks_like_non_mcq_page(text):
            print(
                f"    page {i + 1}/{len(doc)} [skip] promo/cover (no MCQs)",
                flush=True,
            )
            continue

        # Digital pages: embedded text → cheap text model.
        # Scanned / thin pages: Tesseract OCR → same text model (no vision API).
        if prefer_text and text_len >= TEXT_MIN_CHARS:
            print(f"    page {i + 1}/{len(doc)} text extract...", flush=True)
            mcqs = extract_mcqs_from_page_text(text)
            mode = "text"
        else:
            zoom = 2.0 if text_len < TEXT_MIN_CHARS else 1.4
            print(
                f"    page {i + 1}/{len(doc)} tesseract OCR (zoom={zoom})...",
                flush=True,
            )
            ocr_text = _ocr_scanned_page(page, zoom=zoom)
            ocr_len = len(ocr_text.strip())
            if ocr_len < TEXT_MIN_CHARS:
                print(
                    f"    page {i + 1}/{len(doc)} [skip] OCR too thin "
                    f"({ocr_len} chars)",
                    flush=True,
                )
                continue
            print(
                f"    page {i + 1}/{len(doc)} OCR ok ({ocr_len} chars) → text extract...",
                flush=True,
            )
            mcqs = extract_mcqs_from_page_text(ocr_text)
            mode = "ocr+text"

        with_key = 0
        for m in mcqs:
            if m.correct_option:
                with_key += 1
            rows.append(
                {
                    "question_text": m.question_text,
                    "options": m.options,
                    "correct_option": m.correct_option,
                    "explanation": m.explanation,
                    "chapter": chapter_hint or "Biology",
                    "pdf_page_index": i,
                }
            )
        print(
            f"    page {i + 1}/{len(doc)} [{mode}] found {len(mcqs)} "
            f"(with key {with_key}) total {len(rows)}",
            flush=True,
        )
        if page_pause_sec > 0 and i + 1 < end:
            time.sleep(page_pause_sec)

    # Never LLM-guess answers — drop MCQs without a marked key in the source
    before = len(rows)
    rows = [r for r in rows if r.get("correct_option")]
    dropped = before - len(rows)
    if dropped:
        print(
            f"    dropped {dropped} MCQ(s) with no marked answer in source",
            flush=True,
        )
    return rows
