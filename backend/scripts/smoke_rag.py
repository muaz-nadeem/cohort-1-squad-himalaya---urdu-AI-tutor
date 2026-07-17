"""Smoke tests for multimodal RAG (page detection, citations, ask path)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(".")

from app.config import settings  # noqa: E402
from app.llm import answer_from_rag  # noqa: E402
from app.rag import format_citation, retrieve_context, embed  # noqa: E402
from app.textbook_rag.extract import detect_printed_page_number  # noqa: E402
from app import db  # noqa: E402


def test_page_detection() -> None:
    samples = [
        ("Header\n\nSome biology text about cells.\n\n84\n", 84),
        ("CHAPTER 4\nCell Biology\n\n... content ...\n\nPage 12\n", 12),
        ("iii\nPreface only\n", None),
        ("BIOLOGY\n11\nPUNJAB\nPAGE_NUMBER: unknown\n", None),
        # PTB Part 2 header: "1" is volume, "13" next to Chap is chapter, "84" is page
        ("1\nChap 18\nChap\nINHERITANCE\n84\nSome text\nwww.taleem360.com", 84),
        # PTB Part 2 early pages: page num is first line
        ("6\nBIODIVERSITY & CLASSIFICATION\n1\nChap\nBIODIVERSITY\n13\nChap\nText\nwww.taleem360.com", 6),
    ]
    for text, expected in samples:
        got = detect_printed_page_number(text)
        assert got == expected, f"expected {expected}, got {got} for {text!r}"
    print("OK page detection")


def test_citation() -> None:
    cite = format_citation(
        [
            {
                "book": "fsc_bio_part1",
                "book_label": "FSc Biology Part 1",
                "page_number": 84,
            },
            {
                "book": "fsc_bio_part1",
                "book_label": "FSc Biology Part 1",
                "page_number": 86,
            },
        ]
    )
    assert cite and "p. 84" in cite and "86" in cite
    print("OK citation:", cite)


def test_llm_with_synthetic_context() -> None:
    context = (
        "[FSc Biology Part 1 · p. 84 · figure]\n"
        "Cross-section of a mitochondrion showing outer membrane, inner membrane "
        "folded into cristae, and matrix with circular DNA. Site of ATP synthesis."
    )
    answer = answer_from_rag("What does the mitochondrion figure show?", context)
    print("OK synthetic RAG answer:\n", answer)
    assert answer and len(answer) > 20


def schema_ready() -> bool:
    if not settings.supabase_ready:
        print("WARN: Supabase not configured")
        return False
    try:
        db.require_client().table("textbook_chunks").select(
            "id,book,page_number,content_type"
        ).limit(1).execute()
        print("OK schema columns present")
        return True
    except Exception:
        print(
            "WARN: multimodal columns not migrated yet — using legacy "
            "content/chapter encoding. Run db/migrate_textbook_chunks.sql when you can."
        )
        return False


def test_db_retrieve_path() -> None:
    retrieved = retrieve_context(
        "echinoderms tube-like digestive system figure", top_k=3
    )
    if not retrieved["sources"]:
        retrieved = retrieve_context("biology chapter cells", top_k=3)
    assert retrieved["sources"], "expected at least one ingested source"
    print("OK retrieve:", retrieved["sources"][0])
    answer = answer_from_rag(
        "Summarize what the retrieved textbook passage says.", retrieved["context"]
    )
    print("OK DB-backed answer:\n", answer)
    cite = format_citation(retrieved["sources"])
    print("OK citation:", cite)
    assert cite and "p." in cite


def main() -> None:
    test_page_detection()
    test_citation()
    test_llm_with_synthetic_context()

    schema_ready()  # informational
    if settings.supabase_ready:
        test_db_retrieve_path()

    textbooks = Path("data/textbooks")
    pdfs = list(textbooks.glob("*.pdf")) if textbooks.exists() else []
    if pdfs:
        print(f"PDFs found: {[p.name for p in pdfs]}")
        print("Run full ingest: python -m scripts.build_biology_rag")
    else:
        print(
            "NOTE: Drop fsc_biology_part1.pdf and fsc_biology_part2.pdf into "
            "data/textbooks/ then run python -m scripts.build_biology_rag"
        )

    # Import app routes as a final sanity check
    from app.main import app

    paths = {getattr(r, "path", None) for r in app.routes}
    assert "/api/rag/ask" in paths
    print("OK /api/rag/ask registered")
    print("\nSmoke checks finished.")


if __name__ == "__main__":
    main()
