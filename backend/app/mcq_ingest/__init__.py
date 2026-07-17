"""MCQ PDF ingest helpers: folder → source_type, Vision/text extract → JSON rows."""
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
from ..llm import get_groq_client

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
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
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


def extract_mcqs_from_page_image(png_bytes: bytes) -> list[ExtractedMcq]:
    if not settings.groq_ready:
        return []
    client = get_groq_client()

    def _call():
        return client.chat.completions.create(
            model=settings.VISION_MODEL,
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
            max_tokens=2000,
            temperature=0.1,
        )

    response = _groq_with_retry(_call, label="vision")
    return _parse_questions_json(response.choices[0].message.content or "")


def extract_mcqs_from_page_text(page_text: str) -> list[ExtractedMcq]:
    if not page_text.strip() or not settings.groq_ready:
        return []
    if not re.search(r"\b[A-Da-d][).]\s", page_text) and "?" not in page_text:
        return []
    client = get_groq_client()

    def _call():
        return client.chat.completions.create(
            model=settings.LLM_MODEL,
            messages=[
                {"role": "system", "content": TEXT_EXTRACT_PROMPT},
                {"role": "user", "content": page_text[:6000]},
            ],
            max_tokens=2000,
            temperature=0.1,
        )

    response = _groq_with_retry(_call, label="text")
    return _parse_questions_json(response.choices[0].message.content or "")


def render_page_png(page: fitz.Page, zoom: float = 1.4) -> bytes:
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return pix.tobytes("png")


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

    for i in range(start_page, end):
        page = doc[i]
        text = page.get_text() or ""
        mcqs: list[ExtractedMcq] = []
        if prefer_text and len(text.strip()) > 80:
            mcqs = extract_mcqs_from_page_text(text)
        if not mcqs:
            png = render_page_png(page)
            mcqs = extract_mcqs_from_page_image(png)

        for m in mcqs:
            correct = m.correct_option
            if not correct:
                continue
            rows.append(
                {
                    "question_text": m.question_text,
                    "options": m.options,
                    "correct_option": correct,
                    "explanation": m.explanation,
                    "chapter": chapter_hint or "Biology",
                    "pdf_page_index": i,
                }
            )
        if page_pause_sec > 0 and i + 1 < end:
            time.sleep(page_pause_sec)
    return rows
