"""Groq Llama-4 Scout vision captions for textbook figures and tables."""
from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from ..config import settings
from ..llm import get_groq_client

VISION_PROMPT = """You are analyzing a page (or image) from an FSc Biology textbook (Punjab).

If the image contains figures, diagrams, charts, or tables, describe them clearly for a student.
Rules:
- Prefer scientific English terms (mitochondria, ATP, etc.).
- For diagrams: name labeled parts and what the figure shows.
- For tables: summarize column headers and key rows/values as plain text.
- If there is no meaningful figure or table, reply exactly: NONE
- Otherwise reply as JSON only (no markdown):
{"items":[{"content_type":"figure"|"table","description":"..."}]}
"""


@dataclass
class VisualChunk:
    content_type: str  # figure | table
    description: str


def _to_data_url(png_bytes: bytes, mime: str = "image/png") -> str:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _parse_vision_json(raw: str) -> list[VisualChunk]:
    text = (raw or "").strip()
    if not text or text.upper() == "NONE":
        return []

    # Strip fenced code if model wraps JSON
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()

    if text.upper() == "NONE":
        return []

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Fallback: treat whole reply as one figure description
        if len(text) > 40 and "NONE" not in text.upper()[:20]:
            return [VisualChunk(content_type="figure", description=text)]
        return []

    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    out: list[VisualChunk] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        ctype = (item.get("content_type") or "figure").lower()
        if ctype not in ("figure", "table"):
            ctype = "figure"
        desc = (item.get("description") or "").strip()
        if desc:
            out.append(VisualChunk(content_type=ctype, description=desc))
    return out


def caption_image(png_bytes: bytes) -> list[VisualChunk]:
    """Describe figures/tables in an image using Groq vision. Empty if none."""
    if not settings.groq_ready or not png_bytes:
        return []

    # Groq limit ~20MB; skip absurdly large payloads
    if len(png_bytes) > 15_000_000:
        return []

    client = get_groq_client()
    try:
        response = client.chat.completions.create(
            model=settings.VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": _to_data_url(png_bytes)},
                        },
                    ],
                }
            ],
            max_tokens=700,
            temperature=0.2,
            reasoning_effort="none",
        )
        raw = response.choices[0].message.content or ""
        return _parse_vision_json(raw)
    except Exception as exc:
        print(f"  [vision] failed: {exc}")
        return []


def caption_page_visuals(
    images: list, *, prefer_page_render: bool = True
) -> list[VisualChunk]:
    """Caption page/embedded images. Prefer one full-page call when available."""
    if not images:
        return []

    page_imgs = [i for i in images if getattr(i, "kind", "") == "page"]
    embedded = [i for i in images if getattr(i, "kind", "") == "embedded"]

    results: list[VisualChunk] = []
    if prefer_page_render and page_imgs:
        results.extend(caption_image(page_imgs[0].png_bytes))
        if results:
            return results

    for img in embedded[:2]:
        results.extend(caption_image(img.png_bytes))

    return results


OCR_PROMPT = """Extract all readable text from this FSc Biology textbook page.
Preserve reading order. Include headings, body text, figure captions, and table text.
Also look for the printed page number (usually in a corner or footer) and put it alone
on the last line as: PAGE_NUMBER: <number>
If you cannot find a printed page number, end with: PAGE_NUMBER: unknown
Return plain text only."""


def ocr_page_with_vision(png_bytes: bytes) -> str:
    """OCR a page image via Groq vision when local Tesseract is unavailable."""
    if not settings.groq_ready or not png_bytes:
        return ""
    if len(png_bytes) > 15_000_000:
        return ""

    client = get_groq_client()
    try:
        response = client.chat.completions.create(
            model=settings.VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": OCR_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {"url": _to_data_url(png_bytes)},
                        },
                    ],
                }
            ],
            max_tokens=1200,
            temperature=0.1,
            reasoning_effort="none",
        )
        return (response.choices[0].message.content or "").strip()
    except Exception as exc:
        print(f"  [vision-ocr] failed: {exc}")
        return ""
