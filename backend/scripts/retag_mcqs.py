"""Reclassify MCQs tagged with generic 'Biology' or non-canonical chapter names.

Phase 1: keyword-based (free, instant)
Phase 2: LLM-based for remaining generic MCQs (gpt-4o-mini, ~$0.05-0.10)

Safe to run multiple times — only updates rows that can be classified.

Usage (from backend/):
  python -m scripts.retag_mcqs                  # keywords only
  python -m scripts.retag_mcqs --llm            # keywords + LLM for leftovers
  python -m scripts.retag_mcqs --dry-run        # preview without writing
  python -m scripts.retag_mcqs --dry-run --llm  # preview LLM classifications
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.chapters import (  # noqa: E402
    BIOLOGY_CHAPTERS,
    CHAPTER_NORMALIZATION,
    _CANONICAL_NAMES,
    classify_question_chapter,
    normalize_chapter,
)
from app.config import settings  # noqa: E402
from app.db import require_client  # noqa: E402

CHAPTER_LIST_STR = "\n".join(f"- {ch['name']}" for ch in BIOLOGY_CHAPTERS)

LLM_CLASSIFY_PROMPT = f"""You are a Biology MCQ classifier for MDCAT (Pakistan medical entry test).
Given a batch of MCQs, classify each into exactly one of these FSc Biology chapters:

{CHAPTER_LIST_STR}

For each MCQ, return the chapter name EXACTLY as listed above.
Return JSON only (no markdown fences):
{{"results": [{{"id": "...", "chapter": "..."}}]}}

Rules:
- Use the chapter that best matches the PRIMARY topic of the question.
- If a question spans multiple chapters, pick the most specific one.
- Every MCQ must get a chapter — never return null or "Biology".
"""


def _get_classify_client():
    """Return the best client for classification."""
    if settings.openai_ready:
        from app.llm import get_openai_client
        return get_openai_client(), settings.MCQ_TEXT_MODEL
    if settings.groq_ready:
        from app.llm import get_groq_client
        return get_groq_client(), settings.LLM_MODEL
    return None, None


def llm_classify_batch(questions: list[dict], batch_size: int = 25) -> dict[str, str]:
    """Classify a batch of MCQs using LLM. Returns {id: chapter_name}."""
    client, model = _get_classify_client()
    if client is None:
        print("  ERROR: No LLM API key configured for classification")
        return {}

    results: dict[str, str] = {}
    total = len(questions)

    for i in range(0, total, batch_size):
        batch = questions[i : i + batch_size]
        batch_text = []
        for q in batch:
            opts_str = " | ".join(
                f"{o.get('key', '?')}) {o.get('text', '')}"
                for o in (q.get("options") or [])
            )
            batch_text.append(
                f"ID: {q['id']}\nQ: {q['question_text']}\nOptions: {opts_str}"
            )

        user_msg = "\n\n".join(batch_text)
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": LLM_CLASSIFY_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                max_tokens=2000,
                temperature=0.0,
            )
            raw = response.choices[0].message.content or ""
            # Parse JSON
            raw = re.sub(r"```(?:json)?\s*", "", raw).replace("```", "").strip()
            if not raw.startswith("{"):
                start = raw.find("{")
                end = raw.rfind("}")
                if start >= 0 and end > start:
                    raw = raw[start : end + 1]
            data = json.loads(raw)
            for item in data.get("results", []):
                ch = item.get("chapter", "")
                if ch in _CANONICAL_NAMES:
                    results[item["id"]] = ch

            usage = getattr(response, "usage", None)
            tokens = (usage.total_tokens if usage else 0)
            print(
                f"  LLM batch {i // batch_size + 1}/"
                f"{(total + batch_size - 1) // batch_size}: "
                f"classified {len(batch)} MCQs ({tokens} tokens)",
                flush=True,
            )

        except Exception as exc:
            print(f"  LLM batch {i // batch_size + 1} FAILED: {type(exc).__name__}: {exc}")
            if "429" in str(exc) or "rate_limit" in str(exc).lower():
                wait = 30
                m = re.search(r"try again in ([\d.]+)s", str(exc), re.IGNORECASE)
                if m:
                    wait = float(m.group(1)) + 2
                print(f"  Rate limited, waiting {wait:.0f}s...")
                time.sleep(wait)
                i -= batch_size  # retry this batch
            continue

        if i + batch_size < total:
            time.sleep(1.0)  # gentle on rate limits

    return results


def fetch_questions(client, *, chapter_filter: str | None = None, all_chapters: bool = False):
    """Paginate through the questions table."""
    page_size = 1000
    offset = 0
    rows = []
    while True:
        q = client.table("questions").select("id, question_text, options, chapter")
        if chapter_filter and not all_chapters:
            q = q.eq("chapter", chapter_filter)
        elif not all_chapters:
            targets = ["Biology"] + [
                k for k, v in CHAPTER_NORMALIZATION.items()
                if v is not None and k.title() not in _CANONICAL_NAMES
            ]
            q = q.in_("chapter", targets)
        batch = q.range(offset, offset + page_size - 1).execute().data
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def apply_updates(client, changes: list[tuple[str, str]], label: str):
    """Write (id, new_chapter) pairs to the database."""
    applied = 0
    for qid, new_ch in changes:
        client.table("questions").update({"chapter": new_ch}).eq("id", qid).execute()
        applied += 1
        if applied % 50 == 0:
            print(f"  {label}: {applied}/{len(changes)}...", end="\r", flush=True)
    print(f"  {label}: {applied}/{len(changes)} done.          ")
    return applied


def main():
    parser = argparse.ArgumentParser(description="Reclassify MCQs by chapter")
    parser.add_argument("--dry-run", action="store_true", help="Preview only")
    parser.add_argument("--llm", action="store_true", help="Use LLM for remaining generic MCQs")
    parser.add_argument("--all", action="store_true", help="Re-check all MCQs, not just generic ones")
    args = parser.parse_args()

    client = require_client()

    print("Fetching MCQs to reclassify...")
    rows = fetch_questions(client, all_chapters=args.all)
    print(f"  Found {len(rows)} MCQs to check\n")

    keyword_updates = []
    normalize_fixes = []
    still_generic = []

    for row in rows:
        qid = row["id"]
        old_ch = row.get("chapter") or "Biology"
        q_text = row.get("question_text") or ""
        options = row.get("options") or []

        # Fix non-canonical names
        normalized = normalize_chapter(old_ch)
        if normalized != old_ch:
            normalize_fixes.append((qid, old_ch, normalized))
            old_ch = normalized

        # Keyword classification
        if old_ch == "Biology":
            new_ch = classify_question_chapter(q_text, options, fallback="Biology")
            if new_ch != "Biology":
                keyword_updates.append((qid, "Biology", new_ch))
            else:
                still_generic.append(row)
        elif args.all and old_ch in _CANONICAL_NAMES:
            new_ch = classify_question_chapter(q_text, options, fallback=old_ch)
            if new_ch != old_ch:
                keyword_updates.append((qid, old_ch, new_ch))

    # Phase 1 summary
    print(f"Phase 1 (keywords):")
    print(f"  Reclassified:    {len(keyword_updates)}")
    print(f"  Name normalized: {len(normalize_fixes)}")
    print(f"  Still generic:   {len(still_generic)}")

    # Show breakdown
    chapter_counts: dict[str, int] = {}
    for _, _, new_ch in keyword_updates + normalize_fixes:
        chapter_counts[new_ch] = chapter_counts.get(new_ch, 0) + 1
    if chapter_counts:
        print("\n  Keyword breakdown:")
        for ch, n in sorted(chapter_counts.items(), key=lambda x: -x[1]):
            print(f"    {n:5d}  -> {ch}")
    print()

    # Apply keyword fixes
    if not args.dry_run and (keyword_updates or normalize_fixes):
        all_kw = [(qid, new_ch) for qid, _, new_ch in keyword_updates + normalize_fixes]
        apply_updates(client, all_kw, "Keywords")
        print()

    # Phase 2: LLM classification
    if args.llm and still_generic:
        print(f"Phase 2 (LLM): classifying {len(still_generic)} remaining generic MCQs...\n")
        llm_results = llm_classify_batch(still_generic)

        llm_updates = []
        for row in still_generic:
            new_ch = llm_results.get(row["id"])
            if new_ch and new_ch != "Biology":
                llm_updates.append((row["id"], new_ch))

        llm_counts: dict[str, int] = {}
        for _, new_ch in llm_updates:
            llm_counts[new_ch] = llm_counts.get(new_ch, 0) + 1

        print(f"\n  LLM classified: {len(llm_updates)}/{len(still_generic)}")
        print(f"  Still generic:  {len(still_generic) - len(llm_updates)}")
        if llm_counts:
            print("\n  LLM breakdown:")
            for ch, n in sorted(llm_counts.items(), key=lambda x: -x[1]):
                print(f"    {n:5d}  -> {ch}")
        print()

        if not args.dry_run and llm_updates:
            apply_updates(client, llm_updates, "LLM")
            print()

    # Final summary
    total = len(keyword_updates) + len(normalize_fixes)
    if args.llm:
        total += len([r for r in still_generic if llm_results.get(r["id"])])
    action = "Would update" if args.dry_run else "Updated"
    print(f"{action} {total} MCQs total.")
    if args.dry_run:
        print("Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
