"""Fold non-syllabus / legacy chapter buckets into the 16 canonical MDCAT units.

Every question whose ``chapter`` is not one of the 16 canonical MDCAT chapters is
re-classified with the keyword classifier (question text + options + explanation).
When the classifier confidently returns a canonical chapter, the row is retagged;
otherwise it is left untouched. This cleans the taxonomy the Practice page shows
and recovers mis-tagged MCQs (e.g. Evolution / Biotechnology) that were sitting in
combined KIPS units or biodiversity buckets.

Usage:
  python -m scripts.fold_fragment_chapters           # dry-run
  python -m scripts.fold_fragment_chapters --apply    # write updates
"""
from __future__ import annotations

import argparse
import json
from collections import Counter

from app import db
from app.chapters import (
    CHAPTER_NORMALIZATION,
    _CANONICAL_NAMES,
    infer_chapter_from_text,
)

PAGE = 1000
GENERIC = "Biology"


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


def fetch_non_canonical_rows() -> list[dict]:
    """All questions whose chapter is not one of the 16 canonical names."""
    client = db.require_client()
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("questions")
            .select("id,chapter,question_text,options,explanation,source")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
            or []
        )
        for r in batch:
            ch = (r.get("chapter") or "").strip()
            if ch and ch not in _CANONICAL_NAMES:
                rows.append(r)
        if len(batch) < PAGE:
            break
        offset += PAGE
        print(f"  scanned {offset}...")
    return rows


def plan_updates(rows: list[dict]) -> list[tuple[str, str]]:
    planned: list[tuple[str, str]] = []
    for row in rows:
        current = (row.get("chapter") or "").strip()
        # 1) Direct normalization mapping for known legacy buckets.
        mapped = CHAPTER_NORMALIZATION.get(current.lower())
        target = None
        if mapped and mapped in _CANONICAL_NAMES:
            target = mapped
        else:
            # 2) Per-question keyword classification (recovers evolution/biotech
            #    etc. from combined units and biodiversity buckets).
            inferred = infer_chapter_from_text(_blob(row))
            if inferred and inferred in _CANONICAL_NAMES:
                target = inferred
        if target and target != current:
            planned.append((row["id"], target))
    return planned


def apply_updates(planned: list[tuple[str, str]]) -> int:
    client = db.require_client()
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
    parser.add_argument("--apply", action="store_true", help="Persist updates")
    args = parser.parse_args()

    print("Fetching non-canonical chapter rows...")
    rows = fetch_non_canonical_rows()
    print(f"Total non-canonical rows: {len(rows)}")

    planned = plan_updates(rows)
    dist = Counter(ch for _, ch in planned)
    print(f"\nWould re-tag: {len(planned)}")
    print(f"Left unchanged: {len(rows) - len(planned)}")
    print("\nTarget distribution:")
    for name, n in dist.most_common():
        print(f"  {n:5d}  {name}")

    if not args.apply:
        print("\nDry-run only. Re-run with --apply to write.")
        return

    print("\nApplying updates...")
    n = apply_updates(planned)
    db.chapter_question_counts.cache_clear()
    print(f"\nDone. Updated {n} rows.")

    counts = db.catalog_question_counts()
    print("\nCanonical catalog counts after fold:")
    for name, cnt in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {cnt:5d}  {name}")


if __name__ == "__main__":
    main()
