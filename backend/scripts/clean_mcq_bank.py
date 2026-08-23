"""Quarantine Physics MCQs and optionally repair swapped answer keys.

Usage (from backend/):
  python -m scripts.clean_mcq_bank                  # dry-run Physics scan
  python -m scripts.clean_mcq_bank --apply          # hide Physics from the bank
  python -m scripts.clean_mcq_bank --keys --apply   # write high-confidence key fixes
  python -m scripts.clean_mcq_bank --keys --apply --resume
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import db, llm  # noqa: E402
from app.mcq_quality import (  # noqa: E402
    EXCLUDED_CHAPTER,
    format_options,
    is_excluded_chapter,
    is_non_biology,
    parse_audit_json,
)

PAGE = 500
PROGRESS = (
    Path(__file__).resolve().parents[1] / "data" / "_extracted" / "_key_audit_done.txt"
)
AUDIT_PROMPT = """You check MDCAT MCQ answer keys for a Biology-only app.
Return JSON only:
{"subject":"biology"|"physics"|"chemistry"|"english"|"other","correct_option":"A"|"B"|"C"|"D","confidence":"high"|"medium"|"low"}
Rules:
- subject=physics for mechanics, electricity, waves, optics, modern physics — not Biology.
- correct_option is the scientifically correct letter from the given options.
- If unsure, confidence=low. Do not guess a key."""


def fetch_all() -> list[dict]:
    client = db.require_client()
    rows: list[dict] = []
    offset = 0
    while True:
        batch = (
            client.table("questions")
            .select("id,chapter,question_text,options,correct_option,explanation,source")
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


def load_done() -> set[str]:
    if not PROGRESS.exists():
        return set()
    return {
        line.strip()
        for line in PROGRESS.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }


def mark_done(qid: str) -> None:
    PROGRESS.parent.mkdir(parents=True, exist_ok=True)
    with PROGRESS.open("a", encoding="utf-8") as f:
        f.write(qid + "\n")


def audit_row(row: dict) -> dict | None:
    user = (
        f"Question: {row.get('question_text')}\n"
        f"Options:\n{format_options(row.get('options'))}\n"
        f"Stored key: {row.get('correct_option')}"
    )
    raw = llm._chat_openai(AUDIT_PROMPT, user, max_tokens=80)
    return parse_audit_json(raw)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--keys",
        action="store_true",
        help="Ask the LLM to verify Biology answer keys",
    )
    parser.add_argument("--limit", type=int, default=0, help="Max rows to key-audit")
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip question ids already logged in data/_extracted/_key_audit_done.txt",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="Skip the first N remaining rows (use if you remember how far you got)",
    )
    args = parser.parse_args()

    print("Fetching questions...")
    rows = fetch_all()
    live = [r for r in rows if not is_excluded_chapter(r.get("chapter"))]
    physics = [r for r in live if is_non_biology(r)]
    print(f"Total: {len(rows)}")
    print(f"Already quarantined: {len(rows) - len(live)}")
    print(f"Physics / non-Biology to hide: {len(physics)}")
    for row in physics[:15]:
        stem = (row.get("question_text") or "").replace("\n", " ")[:90]
        print(f"  - {row.get('id')}: {stem}")
    if len(physics) > 15:
        print(f"  ... {len(physics) - 15} more")

    if args.apply and physics:
        n = db.quarantine_questions([r["id"] for r in physics])
        print(f"Quarantined {n} rows as chapter={EXCLUDED_CHAPTER}")
    elif physics:
        print("Dry-run: Physics not hidden yet. Re-run with --apply.")

    if not args.keys:
        return

    pool = [r for r in live if not is_non_biology(r)]
    done = load_done() if args.resume else set()
    if done:
        before = len(pool)
        pool = [r for r in pool if r["id"] not in done]
        print(f"Resume: skipped {before - len(pool)} already-audited ids")
    if args.offset:
        pool = pool[args.offset :]
        print(f"Offset: skipped first {args.offset} remaining rows")
    if args.limit:
        pool = pool[: args.limit]
    print(f"\nAuditing {len(pool)} Biology keys...")
    print(f"Progress file: {PROGRESS}")

    fixes = 0
    extra_physics = 0
    client = db.require_client() if args.apply else None
    try:
        for i, row in enumerate(pool, 1):
            qid = row["id"]
            try:
                verdict = audit_row(row)
            except Exception as exc:
                print(f"  [{i}/{len(pool)}] skip {qid}: {exc}")
                continue
            if not verdict:
                print(f"  [{i}/{len(pool)}] unreadable")
                mark_done(qid)
                continue
            stored = str(row.get("correct_option") or "").strip().upper()[:1]
            if verdict["subject"] == "physics":
                extra_physics += 1
                print(f"  [{i}/{len(pool)}] PHYSICS  {qid}")
                if client:
                    db.quarantine_questions([qid])
                mark_done(qid)
                continue
            key = verdict["correct_option"]
            if (
                key
                and key != stored
                and verdict["confidence"] in {"high", "medium"}
            ):
                fixes += 1
                print(
                    f"  [{i}/{len(pool)}] KEY {stored}->{key} "
                    f"({verdict['confidence']})"
                )
                if client:
                    client.table("questions").update({"correct_option": key}).eq(
                        "id", qid
                    ).execute()
            elif i % 20 == 0:
                print(f"  [{i}/{len(pool)}] ok")
            mark_done(qid)
    except KeyboardInterrupt:
        print("\nStopped. Re-run with --resume to continue from the progress file.")
        return

    print(f"\nKey fixes this run: {fixes}")
    print(f"Extra Physics this run: {extra_physics}")
    if not args.apply:
        print("Dry-run only. Re-run with --apply to write.")
        return
    print("Done. Each fix was written as it was found.")


if __name__ == "__main__":
    main()
