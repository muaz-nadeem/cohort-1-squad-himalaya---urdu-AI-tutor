"""Turn extracted pages + vision captions into embeddable chunks with page metadata."""
from __future__ import annotations

from dataclasses import dataclass

from .extract import ExtractedPage
from .vision import VisualChunk


BOOK_LABELS = {
    "fsc_bio_part1": "FSc Biology Part 1",
    "fsc_bio_part2": "FSc Biology Part 2",
}


@dataclass
class TextbookChunk:
    book: str
    chapter: str
    page_number: int
    pdf_page_index: int
    content_type: str  # text | figure | table
    content: str


def _split_paragraphs(
    text: str, max_words: int = 300, overlap_words: int = 50
) -> list[str]:
    """Split text into overlapping chunks for better retrieval continuity."""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        words = text.split()
        if not words:
            return []
        chunks: list[str] = []
        i = 0
        while i < len(words):
            chunk = " ".join(words[i : i + max_words])
            if chunk.strip():
                chunks.append(chunk)
            i += max_words - overlap_words
        return chunks

    # Pack paragraphs into chunks, with overlap from previous chunk
    result: list[str] = []
    current = ""
    prev_tail = ""

    for para in paragraphs:
        trial = (current + "\n\n" + para).strip() if current else para
        if len(trial.split()) > max_words and current:
            result.append(current.strip())
            tail_words = current.strip().split()[-overlap_words:]
            prev_tail = " ".join(tail_words)
            current = prev_tail + "\n\n" + para if prev_tail else para
        else:
            current = trial

    if current.strip():
        result.append(current.strip())

    return result


def pages_to_chunks(
    pages: list[ExtractedPage],
    *,
    book: str,
    chapter: str,
    visuals_by_pdf_index: dict[int, list[VisualChunk]],
) -> list[TextbookChunk]:
    """Build text + figure/table chunks. Skips pages without a printed page number."""
    out: list[TextbookChunk] = []

    for page in pages:
        if page.printed_page is None:
            continue

        for piece in _split_paragraphs(page.text):
            if len(piece.split()) < 12:
                continue
            out.append(
                TextbookChunk(
                    book=book,
                    chapter=chapter,
                    page_number=page.printed_page,
                    pdf_page_index=page.pdf_page_index,
                    content_type="text",
                    content=piece,
                )
            )

        for visual in visuals_by_pdf_index.get(page.pdf_page_index, []):
            desc = visual.description.strip()
            if len(desc) < 20:
                continue
            out.append(
                TextbookChunk(
                    book=book,
                    chapter=chapter,
                    page_number=page.printed_page,
                    pdf_page_index=page.pdf_page_index,
                    content_type=visual.content_type,
                    content=desc,
                )
            )

    return out


def book_display_name(book: str) -> str:
    return BOOK_LABELS.get(book, book)
