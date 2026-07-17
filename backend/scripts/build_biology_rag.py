"""Build multimodal RAG index for FSc Biology Part 1 + Part 2.

Usage:
    cd backend
    python -m scripts.build_biology_rag

    # Custom paths
    python -m scripts.build_biology_rag --part1 ./data/textbooks/fsc_biology_part1.pdf \\
                                       --part2 ./data/textbooks/fsc_biology_part2.pdf

    # Smoke-test first N PDF pages
    python -m scripts.build_biology_rag --max-pages 5

Place PDFs in backend/data/textbooks/ as:
    fsc_biology_part1.pdf
    fsc_biology_part2.pdf

Before first run: execute db/migrate_textbook_chunks.sql in Supabase.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.append(".")

from app.textbook_rag.ingest import ingest_default_textbooks  # noqa: E402


def main() -> None:
    try:
        from app.rag import embed
    except Exception as exc:
        sys.exit(f"Failed to import app.rag: {exc}")

    probe = embed("embedding health check")
    if probe is None:
        sys.exit(
            "Embedding model failed to load. Use the project venv:\n"
            r"  .\venv\Scripts\activate" "\n"
            "  python -m scripts.build_biology_rag\n"
            r"Or: .\venv\Scripts\python.exe -m scripts.build_biology_rag"
        )
    print(f"Embedding OK (dim={len(probe)}) using this Python.")

    parser = argparse.ArgumentParser(description="Ingest FSc Biology PDFs into pgvector RAG")
    parser.add_argument("--part1", type=Path, default=None, help="Path to Part 1 PDF")
    parser.add_argument("--part2", type=Path, default=None, help="Path to Part 2 PDF")
    parser.add_argument("--max-pages", type=int, default=None, help="Limit pages per book (debug)")
    parser.add_argument("--start-page", type=int, default=0, help="0-based PDF page to start from")
    parser.add_argument(
        "--only",
        choices=["fsc_bio_part1", "fsc_bio_part2"],
        default=None,
        help="Ingest only one book",
    )
    parser.add_argument(
        "--skip-vision",
        action="store_true",
        help="Skip Groq vision captions (text-only ingest)",
    )
    parser.add_argument(
        "--no-replace",
        action="store_true",
        help="Do not delete existing chunks for the book before insert",
    )
    args = parser.parse_args()

    results = ingest_default_textbooks(
        part1=args.part1,
        part2=args.part2,
        replace=not args.no_replace,
        max_pages=args.max_pages,
        start_page=args.start_page,
        skip_vision=args.skip_vision,
        only_book=args.only,
    )
    if not results:
        sys.exit(
            "No PDFs found. Drop fsc_biology_part1.pdf and fsc_biology_part2.pdf "
            "into backend/data/textbooks/"
        )
    print("\n=== Summary ===")
    for r in results:
        print(r)


if __name__ == "__main__":
    main()
