"""Page through ALL questions and report chapter-name distribution."""
from __future__ import annotations

from collections import Counter

from app import db
from app.chapters import BIOLOGY_CHAPTERS, infer_chapter_from_text


def fetch_all_chapters() -> list[dict]:
    client = db.require_client()
    page_size = 1000
    offset = 0
    rows: list[dict] = []
    while True:
        batch = (
            client.table("questions")
            .select("id,chapter,question_text,source,source_type")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        print(f"  fetched {len(rows)}...")
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def main() -> None:
    print("Paging through questions table...")
    rows = fetch_all_chapters()
    print(f"\nTOTAL ROWS: {len(rows)}")

    counts = Counter((r.get("chapter") or "").strip() or "(empty)" for r in rows)
    print(f"DISTINCT chapter values: {len(counts)}\n")
    print("=== Full chapter distribution ===")
    for name, n in counts.most_common():
        print(f"  {n:5d}  {name!r}")

    # How many generic 'Biology' rows could be re-inferred from question text?
    biology_rows = [r for r in rows if (r.get("chapter") or "").strip() == "Biology"]
    print(f"\nGeneric 'Biology' rows: {len(biology_rows)}")
    inferred = Counter()
    unmapped = 0
    for r in biology_rows:
        text = " ".join(
            [
                r.get("question_text") or "",
                r.get("source") or "",
                r.get("source_type") or "",
            ]
        )
        ch = infer_chapter_from_text(text)
        if ch:
            inferred[ch] += 1
        else:
            unmapped += 1
    print("If we re-infer chapter from question text/source:")
    for name, n in inferred.most_common():
        print(f"  {n:5d}  {name}")
    print(f"  {unmapped:5d}  (still unmapped)")

    catalog = {c["name"] for c in BIOLOGY_CHAPTERS}
    print("\nCatalog coverage if we used exact chapter field only:")
    for c in BIOLOGY_CHAPTERS:
        print(f"  {counts.get(c['name'], 0):5d}  {c['name']}")


if __name__ == "__main__":
    main()
