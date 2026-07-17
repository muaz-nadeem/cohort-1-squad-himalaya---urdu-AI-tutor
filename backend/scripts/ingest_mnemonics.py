"""Ingest MDCAT mnemonic PDF into mnemonic_chunks for explanation memory tips.

Usage (from backend/):
  python -m scripts.ingest_mnemonics
  python -m scripts.ingest_mnemonics --path "data/other resources/MDCAT-MNEMONIC-2023.pdf"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import fitz

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import insert_mnemonic_chunks  # noqa: E402
from app.rag import embed  # noqa: E402

DEFAULT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "other resources"
    / "MDCAT-MNEMONIC-2023.pdf"
)


def chunk_page_text(text: str, max_words: int = 180) -> list[str]:
    words = text.split()
    if not words:
        return []
    chunks: list[str] = []
    cur: list[str] = []
    for w in words:
        cur.append(w)
        if len(cur) >= max_words:
            chunks.append(" ".join(cur))
            cur = []
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", type=str, default=str(DEFAULT))
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pdf = Path(args.path)
    if not pdf.exists():
        print(f"Not found: {pdf}")
        sys.exit(1)
    if not settings.supabase_ready and not args.dry_run:
        print("Supabase not configured")
        sys.exit(1)

    doc = fitz.open(pdf)
    end = len(doc) if args.max_pages is None else min(len(doc), args.max_pages)
    rows = []
    for i in range(end):
        text = (doc[i].get_text() or "").strip()
        if len(text) < 40:
            continue
        for chunk in chunk_page_text(text):
            emb = None if args.dry_run else embed(chunk)
            if emb is None and not args.dry_run:
                print(f"  skip page {i} chunk (embed failed)")
                continue
            rows.append(
                {
                    "topic": "MDCAT Biology mnemonics",
                    "content": chunk,
                    "page_number": i + 1,
                    **({"embedding": emb} if emb is not None else {}),
                }
            )

    print(f"Prepared {len(rows)} mnemonic chunks from {pdf.name}")
    if args.dry_run:
        return
    n = insert_mnemonic_chunks(rows)
    print(f"Inserted {n}")


if __name__ == "__main__":
    main()
