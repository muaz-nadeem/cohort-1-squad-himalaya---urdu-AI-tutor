"""Orchestrate extract → vision → chunk → embed → Supabase upsert."""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from .. import db
from ..config import settings
from ..rag import embed
from .chunk import TextbookChunk, pages_to_chunks
from .extract import ExtractedPage, iter_pdf_pages
from .vision import caption_page_visuals

TEXTBOOKS_DIR = Path(__file__).resolve().parents[2] / "data" / "textbooks"

DEFAULT_FILES = {
    "fsc_bio_part1": "fsc_biology_part1.pdf",
    "fsc_bio_part2": "fsc_biology_part2.pdf",
}


def resolve_pdf(book: str, path: Optional[Path] = None) -> Path:
    if path:
        return Path(path)
    return TEXTBOOKS_DIR / DEFAULT_FILES[book]


def _delete_book_chunks(book: str) -> None:
    client = db.require_client()
    if _supports_multimodal_columns(client):
        client.table("textbook_chunks").delete().eq("book", book).execute()
        return
    rows = (
        client.table("textbook_chunks")
        .select("id,chapter")
        .like("chapter", f"{book}|%")
        .execute()
        .data
        or []
    )
    for row in rows:
        client.table("textbook_chunks").delete().eq("id", row["id"]).execute()


def _sanitize_text(text: str) -> str:
    """Postgres text columns reject NUL bytes from some PDF extractors."""
    return (text or "").replace("\x00", "")


def _row_for_chunk(chunk: TextbookChunk, vector: list[float], *, legacy: bool) -> dict:
    from .chunk import book_display_name

    header = (
        f"[{book_display_name(chunk.book)} - p. {chunk.page_number} - "
        f"{chunk.content_type}]"
    )
    body = f"{header}\n{_sanitize_text(chunk.content)}"
    if legacy:
        return {
            "chapter": f"{chunk.book}|p{chunk.page_number}|{chunk.content_type}|{chunk.chapter}",
            "concept": chunk.content_type,
            "content": body,
            "embedding": vector,
        }
    return {
        "book": chunk.book,
        "chapter": chunk.chapter,
        "page_number": chunk.page_number,
        "pdf_page_index": chunk.pdf_page_index,
        "content_type": chunk.content_type,
        "content": body,
        "embedding": vector,
    }


def _supports_multimodal_columns(client) -> bool:
    try:
        client.table("textbook_chunks").select("book,page_number,content_type").limit(1).execute()
        return True
    except Exception:
        return False


def _store_chunks(chunks: list[TextbookChunk], *, batch_size: int = 25) -> int:
    client = db.require_client()
    legacy = not _supports_multimodal_columns(client)
    if legacy:
        print(
            "  WARN: multimodal columns missing — storing with legacy "
            "content/chapter encoding. Run db/migrate_textbook_chunks.sql when you can."
        )

    stored = 0
    batch: list[dict] = []

    for chunk in chunks:
        vector = embed(chunk.content)
        if vector is None:
            print(f"  [embed] failed for page {chunk.page_number}, skipping")
            continue
        batch.append(_row_for_chunk(chunk, vector, legacy=legacy))
        if len(batch) >= batch_size:
            client.table("textbook_chunks").insert(batch).execute()
            stored += len(batch)
            print(f"  stored {stored} chunks...")
            batch = []

    if batch:
        client.table("textbook_chunks").insert(batch).execute()
        stored += len(batch)

    return stored


def _infer_page_offset(
    detected: list[tuple[int, int]],
) -> Optional[int]:
    """Given (pdf_page, printed_page) pairs, infer the most common offset.

    Returns offset such that printed_page ≈ pdf_page - offset + 1, or None
    if not enough data or no consensus.
    """
    if len(detected) < 3:
        return None

    offsets: list[int] = []
    for pdf_idx, printed in detected:
        offsets.append(pdf_idx - printed)

    from collections import Counter
    counts = Counter(offsets)
    best_offset, best_count = counts.most_common(1)[0]
    if best_count >= max(2, len(detected) // 3):
        return best_offset
    return None


def ingest_pdf(
    pdf_path: Path,
    *,
    book: str,
    chapter: Optional[str] = None,
    replace: bool = True,
    max_pages: Optional[int] = None,
    start_page: int = 0,
    skip_vision: bool = False,
    use_offset_fallback: bool = True,
    vision_rate_limit_delay: float = 2.0,
) -> dict:
    """Ingest one PDF into textbook_chunks. Returns a summary dict."""
    if not settings.supabase_ready:
        raise RuntimeError("SUPABASE_URL/SUPABASE_KEY must be set")
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    chapter = chapter or pdf_path.stem
    print(f"\n=== Ingesting {pdf_path.name} as {book} ===")

    # --- Pass 1: extract all pages, collect detected page numbers ---
    all_pages: list[ExtractedPage] = []
    end_page = None if max_pages is None else start_page + max_pages

    for page in iter_pdf_pages(pdf_path):
        if page.pdf_page_index < start_page:
            continue
        if end_page is not None and page.pdf_page_index >= end_page:
            break
        all_pages.append(page)

    # Collect pages that had a printed page detected
    detected_pairs = [
        (p.pdf_page_index, p.printed_page)
        for p in all_pages
        if p.printed_page is not None
    ]
    offset = _infer_page_offset(detected_pairs) if use_offset_fallback else None
    if offset is not None:
        print(f"  page offset inferred: pdf_page - {offset} = printed_page")

    # --- Pass 2: assign page numbers using offset fallback ---
    pages: list[ExtractedPage] = []
    skipped_no_page = 0
    skipped_too_short = 0
    offset_assigned = 0
    visuals_by_index: dict[int, list] = {}

    for page in all_pages:
        if page.printed_page is None and offset is not None:
            inferred = page.pdf_page_index - offset
            if 1 <= inferred <= 999:
                page.printed_page = inferred
                offset_assigned += 1

        if page.printed_page is None:
            skipped_no_page += 1
            continue

        if len(page.text.split()) < 15:
            skipped_too_short += 1
            continue

        pages.append(page)
        print(
            f"  page printed={page.printed_page} "
            f"pdf={page.pdf_page_index} chars={len(page.text)} "
            f"visual={page.likely_has_visual}"
        )

        if not skip_vision and page.likely_has_visual and page.images:
            try:
                captions = caption_page_visuals(page.images)
                if captions:
                    visuals_by_index[page.pdf_page_index] = captions
                    print(f"    + {len(captions)} vision caption(s)")
                if vision_rate_limit_delay > 0:
                    time.sleep(vision_rate_limit_delay)
            except Exception as exc:
                print(f"    [vision] {exc}")

    chunks = pages_to_chunks(
        pages,
        book=book,
        chapter=chapter,
        visuals_by_pdf_index=visuals_by_index,
    )
    print(
        f"  chunks ready: {len(chunks)} "
        f"(skipped_no_page={skipped_no_page}, "
        f"skipped_short={skipped_too_short}, "
        f"offset_assigned={offset_assigned})"
    )

    if replace:
        print(f"  clearing previous chunks for {book}...")
        _delete_book_chunks(book)

    stored = _store_chunks(chunks)
    summary = {
        "book": book,
        "pdf": str(pdf_path),
        "pages_indexed": len(pages),
        "skipped_no_printed_page": skipped_no_page,
        "skipped_too_short": skipped_too_short,
        "offset_assigned": offset_assigned,
        "chunks_stored": stored,
        "vision_pages": len(visuals_by_index),
    }
    print(f"  DONE: {summary}")
    return summary


def ingest_default_textbooks(
    *,
    part1: Optional[Path] = None,
    part2: Optional[Path] = None,
    replace: bool = True,
    max_pages: Optional[int] = None,
    start_page: int = 0,
    skip_vision: bool = False,
    only_book: Optional[str] = None,
) -> list[dict]:
    results = []
    for book, override in (
        ("fsc_bio_part1", part1),
        ("fsc_bio_part2", part2),
    ):
        if only_book and book != only_book:
            continue
        path = resolve_pdf(book, override)
        if not path.exists():
            print(f"WARNING: missing {path} — skip {book}")
            continue
        results.append(
            ingest_pdf(
                path,
                book=book,
                replace=replace,
                max_pages=max_pages,
                start_page=start_page,
                skip_vision=skip_vision,
            )
        )
    return results
