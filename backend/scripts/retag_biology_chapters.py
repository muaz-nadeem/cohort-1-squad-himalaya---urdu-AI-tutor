"""Re-tag questions whose chapter is the generic 'Biology' bucket.

Uses keyword/unit inference from question text, options, and explanation.
Leaves non-Biology subjects (physics/English/etc.) as chapter='Biology'.

Usage:
  python -m scripts.retag_biology_chapters           # dry-run
  python -m scripts.retag_biology_chapters --apply   # write updates
"""
from __future__ import annotations

import argparse
import json
from collections import Counter

from app import db
from app.chapters import infer_chapter_from_text

GENERIC = "Biology"
PAGE = 1000


def _blob(row: dict) -> str:
    opts = row.get("options")
    if isinstance(opts, (list, dict)):
        opts_s = json.dumps(opts, ensure_ascii=False)
    else:
        opts_s = str(opts or "")
    return "\n".join(
        [
            str(row.get("question_text") or ""),
            opts_s,
            str(row.get("explanation") or ""),
            str(row.get("source") or ""),
        ]
    )


def fetch_biology_rows() -> list[dict]:
    client = db.require_client()
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("questions")
            .select("id,chapter,question_text,options,explanation,source")
            .eq("chapter", GENERIC)
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        print(f"  loaded {len(rows)}...")
        if len(batch) < PAGE:
            break
        offset += PAGE
    return rows


def plan_updates(rows: list[dict]) -> list[tuple[str, str]]:
    planned: list[tuple[str, str]] = []
    for row in rows:
        chapter = infer_chapter_from_text(_blob(row))
        if chapter and chapter != GENERIC:
            planned.append((row["id"], chapter))
    return planned


def apply_updates(planned: list[tuple[str, str]]) -> int:
    client = db.require_client()
    # Group by target chapter so we can update many ids at once
    by_chapter: dict[str, list[str]] = {}
    for qid, chapter in planned:
        by_chapter.setdefault(chapter, []).append(qid)

    updated = 0
    for chapter, ids in by_chapter.items():
        for i in range(0, len(ids), 200):
            chunk = ids[i : i + 200]
            client.table("questions").update({"chapter": chapter}).in_(
                "id", chunk
            ).execute()
            updated += len(chunk)
            print(f"  wrote {updated}/{len(planned)}  ({chapter})")
    return updated


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Persist updates (default is dry-run)",
    )
    args = parser.parse_args()

    print(f"Fetching chapter='{GENERIC}' rows...")
    rows = fetch_biology_rows()
    print(f"Total generic rows: {len(rows)}")

    planned = plan_updates(rows)
    dist = Counter(ch for _, ch in planned)
    print(f"\nWould re-tag: {len(planned)}")
    print(f"Left as '{GENERIC}': {len(rows) - len(planned)}")
    print("\nTarget distribution:")
    for name, n in dist.most_common():
        print(f"  {n:5d}  {name}")

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to write.")
        return

    print("\nApplying updates...")
    n = apply_updates(planned)
    # Bust cached counts so /api/chapters reflects the new tags
    db.chapter_question_counts.cache_clear()
    print(f"\nDone. Updated {n} rows.")

    counts = db.catalog_question_counts()
    print("\nCatalog counts after retag:")
    for name, n in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        if name == GENERIC:
            continue
        print(f"  {n:5d}  {name}")
    print(f"  {db.chapter_question_counts().get(GENERIC, 0):5d}  still '{GENERIC}'")


if __name__ == "__main__":
    main()
