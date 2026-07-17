"""Ingest MCQs from backend/data resource folders into the mixed questions bank.

Usage (from backend/):
  python -m scripts.ingest_mcqs --resume
  python -m scripts.ingest_mcqs --max-pdfs 2 --max-pages 5
  python -m scripts.ingest_mcqs --path "data/Biology/some.pdf" --chapter "Homeostasis"
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.chapters import infer_chapter_from_text  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import insert_questions  # noqa: E402
from app.mcq_ingest import (  # noqa: E402
    extract_pdf_mcqs,
    infer_source_type,
    is_mnemonic_pdf,
    list_mcq_pdfs,
)

DATA_ROOT = Path(__file__).resolve().parents[1] / "data"
EXTRACTED = DATA_ROOT / "_extracted"
DONE_LOG = EXTRACTED / "_done_sources.txt"


def _source_label(pdf: Path) -> str:
    return pdf.stem[:120]


def _json_path(pdf: Path) -> Path:
    return EXTRACTED / f"{pdf.stem[:80]}.json"


def _load_done() -> set[str]:
    if not DONE_LOG.exists():
        return set()
    return {line.strip() for line in DONE_LOG.read_text(encoding="utf-8").splitlines() if line.strip()}


def _mark_done(source: str) -> None:
    EXTRACTED.mkdir(parents=True, exist_ok=True)
    with DONE_LOG.open("a", encoding="utf-8") as f:
        f.write(source + "\n")


def ingest_one(
    pdf: Path,
    *,
    chapter: str | None,
    book: str | None,
    start_page: int,
    max_pages: int | None,
    dry_run: bool,
    page_pause: float,
) -> int:
    if is_mnemonic_pdf(pdf):
        print(f"  skip mnemonic: {pdf.name}")
        return 0

    source_type = infer_source_type(pdf)
    source = _source_label(pdf)
    ch = chapter or infer_chapter_from_text(pdf.stem) or "Biology"

    try:
        rel = pdf.relative_to(DATA_ROOT.parent)
    except ValueError:
        rel = pdf
    print(f"\n==> {rel}")
    print(f"    source_type={source_type} chapter={ch}")

    rows_raw = extract_pdf_mcqs(
        pdf,
        start_page=start_page,
        max_pages=max_pages,
        prefer_text=True,
        page_pause_sec=page_pause,
    )
    EXTRACTED.mkdir(parents=True, exist_ok=True)
    out_json = _json_path(pdf)
    out_json.write_text(json.dumps(rows_raw, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"    extracted {len(rows_raw)} MCQs with answers -> {out_json.name}")

    db_rows = []
    for r in rows_raw:
        db_rows.append(
            {
                "question_text": r["question_text"],
                "options": r["options"],
                "correct_option": r["correct_option"],
                "explanation": r.get("explanation"),
                "chapter": r.get("chapter") or ch,
                "book": book,
                "source": source,
                "source_type": source_type,
                "difficulty": 2,
            }
        )

    if dry_run:
        print("    dry-run - not inserting")
        return len(db_rows)

    if not settings.supabase_ready:
        print("    ERROR: Supabase not configured")
        return 0

    n = insert_questions(db_rows)
    print(f"    inserted {n}")
    _mark_done(source)
    return n


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest MCQ PDFs into questions bank")
    parser.add_argument("--path", type=str, default=None, help="Single PDF path")
    parser.add_argument("--chapter", type=str, default=None)
    parser.add_argument("--book", type=str, default=None, help="fsc_part1 | fsc_part2")
    parser.add_argument("--start-page", type=int, default=0)
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument("--max-pdfs", type=int, default=None)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip PDFs already marked done in data/_extracted/_done_sources.txt",
    )
    parser.add_argument(
        "--page-pause",
        type=float,
        default=1.5,
        help="Seconds to sleep between pages (default 1.5) to ease Groq limits",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.path:
        pdfs = [Path(args.path)]
    else:
        pdfs = list_mcq_pdfs(DATA_ROOT)
        if args.max_pdfs:
            pdfs = pdfs[: args.max_pdfs]

    if not pdfs:
        print("No MCQ PDFs found under data/")
        return

    done = _load_done() if args.resume else set()
    if args.resume and done:
        print(f"Resume: skipping {len(done)} already-done source(s)")

    total = 0
    for pdf in pdfs:
        if not pdf.exists():
            print(f"Missing: {pdf}")
            continue
        source = _source_label(pdf)
        if args.resume and source in done:
            print(f"\n==> skip (already done): {pdf.name}")
            continue
        try:
            total += ingest_one(
                pdf,
                chapter=args.chapter,
                book=args.book,
                start_page=args.start_page,
                max_pages=args.max_pages,
                dry_run=args.dry_run,
                page_pause=args.page_pause,
            )
        except Exception as exc:
            print(f"    FAILED: {type(exc).__name__}: {exc}")
            print("    Tip: wait a few minutes, then re-run with --resume")
            break
    print(f"\nDone. Total MCQs this run: {total}")


if __name__ == "__main__":
    main()
