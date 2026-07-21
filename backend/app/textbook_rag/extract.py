"""Per-page PDF extraction: text/OCR, printed page numbers, page + figure images."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

MIN_FIGURE_SIDE = 120
MIN_FIGURE_AREA = 20_000


@dataclass
class PageImage:
    kind: str  # "page" | "embedded"
    png_bytes: bytes
    width: int
    height: int


@dataclass
class ExtractedPage:
    pdf_page_index: int
    printed_page: Optional[int]
    text: str
    images: list[PageImage] = field(default_factory=list)
    likely_has_visual: bool = False


def _configure_tesseract() -> bool:
    try:
        import pytesseract
    except ImportError:
        return False

    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for path in candidates:
        if Path(path).exists():
            pytesseract.pytesseract.tesseract_cmd = path
            return True
    return True


def ocr_with_tesseract(png_bytes: bytes) -> str:
    """Local Tesseract OCR only. Returns empty string if unavailable or failed."""
    if not _configure_tesseract():
        return ""
    try:
        import pytesseract
        from PIL import Image, ImageEnhance, ImageFilter, ImageOps

        img = Image.open(io.BytesIO(png_bytes))
        if img.mode not in ("L", "RGB"):
            img = img.convert("RGB")
        gray = ImageOps.grayscale(img)
        gray = ImageOps.autocontrast(gray)
        # Upscale small / phone-scan images so Tesseract can resolve glyphs
        min_side = min(gray.size)
        if min_side < 1400:
            scale = max(2, int(1400 / min_side) + 1)
            gray = gray.resize(
                (gray.width * scale, gray.height * scale),
                Image.Resampling.LANCZOS,
            )
            gray = ImageEnhance.Contrast(gray).enhance(1.4)
            gray = gray.filter(ImageFilter.SHARPEN)

        text = pytesseract.image_to_string(
            gray, lang="eng", config="--oem 3 --psm 6"
        )
        return text or ""
    except Exception:
        return ""


def _ocr_page_image(png_bytes: bytes) -> str:
    """OCR via Tesseract if installed, else Groq vision OCR fallback."""
    text = ocr_with_tesseract(png_bytes)
    if text.strip():
        return text

    try:
        from .vision import ocr_page_with_vision

        return ocr_page_with_vision(png_bytes)
    except Exception:
        return ""


def _render_page_png(page: fitz.Page, zoom: float = 1.5) -> bytes:
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    return pix.tobytes("png")


def _extract_embedded_images(doc: fitz.Document, page: fitz.Page) -> list[PageImage]:
    images: list[PageImage] = []
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        try:
            base = doc.extract_image(xref)
        except Exception:
            continue
        if not base or not base.get("image"):
            continue
        w, h = int(base.get("width") or 0), int(base.get("height") or 0)
        if w < MIN_FIGURE_SIDE or h < MIN_FIGURE_SIDE or (w * h) < MIN_FIGURE_AREA:
            continue
        images.append(
            PageImage(
                kind="embedded",
                png_bytes=base["image"],
                width=w,
                height=h,
            )
        )
    return images


_PAGE_LABEL_RE = re.compile(r"(?i)\bpage\s*(\d{1,4})\b")
_CHAPTER_LINE_RE = re.compile(r"(?i)\bchap(?:ter)?\b")
_CLASS_YEAR_RE = re.compile(r"(?i)\bbiology\s*(11|12)\b")

# Lines that are clearly headers/titles, not page numbers
_HEADER_NOISE_RE = re.compile(
    r"(?i)(chap|chapter|biodiversity|classification|inheritance|"
    r"ecology|chromosome|dna|biostatistics|evolution|reproduction|"
    r"coordination|support|growth|nutrition|transport|homeostasis|"
    r"cell\s*biology|enzymes|bioenergetics|www\.|taleem|pectaa|"
    r"not\s+for\s+sale|web\s+version)",
)


def detect_printed_page_number(text: str) -> Optional[int]:
    """Best-effort printed page number from header/footer-ish regions."""
    if not text or not text.strip():
        return None

    marker = re.search(r"(?im)^\s*PAGE_NUMBER:\s*(\d{1,4}|unknown)\s*$", text)
    if marker:
        raw = marker.group(1)
        if raw.isdigit():
            n = int(raw)
            if 1 <= n <= 999:
                return n

    scrubbed = _CLASS_YEAR_RE.sub("Biology", text)
    lines = [ln.strip() for ln in scrubbed.splitlines() if ln.strip()]
    if not lines:
        return None

    footer_lines = lines[-4:]
    header_lines = lines[:6]

    # 1) Explicit "Page N" anywhere in header/footer
    for ln in footer_lines + header_lines:
        m = _PAGE_LABEL_RE.search(ln)
        if m:
            n = int(m.group(1))
            if 1 <= n <= 999:
                return n

    # 2) Pure numeric footer line — strongest signal in textbooks
    #    Skip if adjacent to a "Chap" line (chapter numbers, not page numbers)
    for fi, ln in enumerate(reversed(footer_lines)):
        if _HEADER_NOISE_RE.search(ln):
            continue
        if _CHAPTER_LINE_RE.search(ln):
            continue
        if not re.fullmatch(r"\d{1,4}", ln):
            continue
        n = int(ln)
        if not (1 <= n <= 999):
            continue
        real_idx = len(footer_lines) - 1 - fi
        prev_chap = real_idx > 0 and _CHAPTER_LINE_RE.search(footer_lines[real_idx - 1])
        next_chap = (real_idx + 1 < len(footer_lines)) and _CHAPTER_LINE_RE.search(footer_lines[real_idx + 1])
        if prev_chap or next_chap:
            continue
        return n

    # 3) Pure numeric in the header/top area.
    #    PTB headers have chapter numbers (e.g. "13") that always appear
    #    adjacent to a "Chap" line. Skip those. The actual page number is
    #    usually the first or last standalone number that is NOT a chapter id.
    #    Also check slightly beyond header into early body for the page number.
    scan_lines = lines[:8]
    for i, ln in enumerate(scan_lines):
        if _CHAPTER_LINE_RE.search(ln):
            continue
        if not re.fullmatch(r"\d{1,4}", ln):
            continue
        n = int(ln)
        if not (1 <= n <= 999):
            continue
        # Skip if immediately preceded or followed by a "Chap" line
        prev_is_chap = i > 0 and _CHAPTER_LINE_RE.search(scan_lines[i - 1])
        next_is_chap = (i + 1 < len(scan_lines)) and _CHAPTER_LINE_RE.search(scan_lines[i + 1])
        if prev_is_chap or next_is_chap:
            continue
        return n

    return None


_VISUAL_HINT_RE = re.compile(
    r"\b(fig(?:ure)?\.?\s*\d|table\s*\d|diagram|chart)\b",
    re.IGNORECASE,
)

_WATERMARK_RE = re.compile(
    r"(web version|not for sale|pectaa|sample)",
    re.IGNORECASE,
)


def _useful_text_len(text: str) -> int:
    """Length after stripping common PDF watermarks."""
    cleaned = _WATERMARK_RE.sub("", text or "")
    return len(cleaned.strip())


def extract_page(doc: fitz.Document, page_index: int) -> ExtractedPage:
    page = doc[page_index]
    native_text = (page.get_text("text") or "").strip()
    page_png = _render_page_png(page)
    text = native_text

    if _useful_text_len(text) < 80:
        ocr_text = _ocr_page_image(page_png).strip()
        if _useful_text_len(ocr_text) > _useful_text_len(text):
            text = ocr_text

    embedded = _extract_embedded_images(doc, page)
    printed = detect_printed_page_number(text)
    text = re.sub(r"(?im)^\s*PAGE_NUMBER:\s*\S+\s*$", "", text).strip()
    likely = bool(embedded) or bool(_VISUAL_HINT_RE.search(text))

    images: list[PageImage] = []
    if likely:
        images.append(PageImage(kind="page", png_bytes=page_png, width=0, height=0))
        images.extend(embedded[:3])

    return ExtractedPage(
        pdf_page_index=page_index,
        printed_page=printed,
        text=text,
        images=images,
        likely_has_visual=likely,
    )


def iter_pdf_pages(pdf_path: Path):
    """Yield ExtractedPage for every page in the PDF."""
    doc = fitz.open(pdf_path)
    try:
        for i in range(len(doc)):
            yield extract_page(doc, i)
    finally:
        doc.close()
