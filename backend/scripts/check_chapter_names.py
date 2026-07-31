"""Compare chapter names in the MCQ bank vs the practice catalog."""
from __future__ import annotations

from app import db
from app.chapters import BIOLOGY_CHAPTERS


def main() -> None:
    counts = db.chapter_question_counts()
    print(f"TOTAL QUESTIONS (limit 10k rows): {sum(counts.values())}")
    print(f"DISTINCT CHAPTER NAMES IN BANK: {len(counts)}")
    print()

    print("=== Names in questions table ===")
    for name, n in sorted(counts.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {n:5d}  {name!r}")

    catalog = {c["name"] for c in BIOLOGY_CHAPTERS}
    bank = set(counts)

    print()
    print("=== Catalog chapters with ZERO exact bank match ===")
    for c in BIOLOGY_CHAPTERS:
        n = counts.get(c["name"], 0)
        if n == 0:
            print(f"  0  {c['name']!r}")

    print()
    print("=== Bank chapters NOT in catalog ===")
    for name in sorted(bank - catalog):
        print(f"  {counts[name]:5d}  {name!r}")

    print()
    print("=== Exact matches ===")
    for c in BIOLOGY_CHAPTERS:
        n = counts.get(c["name"], 0)
        if n:
            print(f"  {n:5d}  {c['name']!r}")

    # Fuzzy: show possible near-matches for zeros
    print()
    print("=== Possible near-matches for empty catalog chapters ===")
    for c in BIOLOGY_CHAPTERS:
        if counts.get(c["name"], 0):
            continue
        needle = c["name"].lower()
        hits = []
        for bname, n in counts.items():
            bl = bname.lower()
            if needle in bl or bl in needle or any(
                tok in bl for tok in needle.split() if len(tok) > 4
            ):
                hits.append((n, bname))
        if hits:
            print(f"  catalog: {c['name']!r}")
            for n, bname in sorted(hits, reverse=True)[:5]:
                print(f"    -> {n:5d}  {bname!r}")


if __name__ == "__main__":
    main()
