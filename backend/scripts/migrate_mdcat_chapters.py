"""Migrate MCQ chapters to match the official MDCAT 2026 Biology syllabus.

Phase 1: Simple renames/merges (free, instant)
Phase 2: LLM-split chapters that map to 2 MDCAT chapters
Phase 3: Keyword-reclassify generic "Biology" MCQs

Usage (from backend/):
  python -m scripts.migrate_mdcat_chapters              # full migration
  python -m scripts.migrate_mdcat_chapters --dry-run     # preview only
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.chapters import BIOLOGY_CHAPTERS, _CANONICAL_NAMES, classify_question_chapter  # noqa: E402
from app.config import settings  # noqa: E402
from app.db import require_client  # noqa: E402

CHAPTER_LIST_STR = "\n".join(f"- {ch['name']}" for ch in BIOLOGY_CHAPTERS)

# ── Phase 1: simple renames ──
SIMPLE_RENAMES = {
    "Variation and Genetics": "Inheritance",
    "Cell Biology": "Cell Structure and Function",
    "Biomolecules": "Biological Molecules",
    "Molecular Biology": "Biological Molecules",
    "Cell Cycle": "Cell Structure and Function",
}

# ── Phase 2: chapters that need LLM to split into 2 MDCAT chapters ──
SPLIT_CHAPTERS = {
    "Circulation and Immunity": {
        "targets": ["Circulation", "Immunity"],
        "hint": "Circulation = heart, cardiac cycle, blood vessels, blood cells, lymphatic system. Immunity = antibodies, antigens, vaccines, defense mechanisms, immune response.",
    },
    "Life Processes (Nutrition & Gaseous Exchange)": {
        "targets": ["Digestion", "Respiration"],
        "hint": "Digestion = digestive system, stomach, intestine, nutrition, absorption, bile, liver, pancreas. Respiration = respiratory system, lungs, alveoli, gas exchange, breathing, trachea, smoking.",
    },
    "Chromosome and DNA": {
        "targets": ["Biological Molecules", "Inheritance"],
        "hint": "Biological Molecules = DNA structure, double helix, nucleotides, RNA types, Watson & Crick. Inheritance = chromosomes, genes, gene expression, transcription, translation, replication as part of genetics.",
    },
}


def _get_client():
    if settings.openai_ready:
        from app.llm import get_openai_client
        return get_openai_client(), settings.MCQ_TEXT_MODEL
    if settings.groq_ready:
        from app.llm import get_groq_client
        return get_groq_client(), settings.LLM_MODEL
    return None, None


def fetch_by_chapter(client, chapter: str) -> list[dict]:
    page_size = 1000
    offset = 0
    rows = []
    while True:
        batch = (
            client.table("questions")
            .select("id, question_text, options, chapter")
            .eq("chapter", chapter)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
        )
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def llm_split_batch(questions: list[dict], targets: list[str], hint: str, batch_size: int = 25) -> dict[str, str]:
    client, model = _get_client()
    if not client:
        print("  ERROR: No LLM API key")
        return {}

    prompt = f"""Classify each MCQ into exactly one of these two chapters:
- {targets[0]}
- {targets[1]}

Guide: {hint}

Return JSON only (no markdown):
{{"results": [{{"id": "...", "chapter": "..."}}]}}
Every MCQ must get one of the two chapters listed above.
"""

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
            batch_text.append(f"ID: {q['id']}\nQ: {q['question_text']}\nOptions: {opts_str}")

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": "\n\n".join(batch_text)},
                ],
                max_tokens=2000,
                temperature=0.0,
            )
            raw = response.choices[0].message.content or ""
            raw = re.sub(r"```(?:json)?\s*", "", raw).replace("```", "").strip()
            if not raw.startswith("{"):
                start, end = raw.find("{"), raw.rfind("}")
                if start >= 0 and end > start:
                    raw = raw[start : end + 1]
            data = json.loads(raw)
            for item in data.get("results", []):
                ch = item.get("chapter", "")
                if ch in targets:
                    results[item["id"]] = ch

            tokens = getattr(response, "usage", None)
            tok_count = tokens.total_tokens if tokens else 0
            print(
                f"    batch {i // batch_size + 1}/{(total + batch_size - 1) // batch_size}: "
                f"{len(batch)} MCQs ({tok_count} tokens)",
                flush=True,
            )
        except json.JSONDecodeError:
            print(f"    batch {i // batch_size + 1}: JSON parse error, skipping")
        except Exception as exc:
            print(f"    batch {i // batch_size + 1} FAILED: {type(exc).__name__}: {exc}")
            if "429" in str(exc):
                time.sleep(30)

        if i + batch_size < total:
            time.sleep(1.0)

    return results


def apply_updates(client, changes: list[tuple[str, str]], dry_run: bool, label: str) -> int:
    if dry_run or not changes:
        return 0
    applied = 0
    for qid, new_ch in changes:
        client.table("questions").update({"chapter": new_ch}).eq("id", qid).execute()
        applied += 1
        if applied % 50 == 0:
            print(f"    {label}: {applied}/{len(changes)}...", end="\r", flush=True)
    print(f"    {label}: {applied}/{len(changes)} done.          ")
    return applied


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    client = require_client()
    total_updated = 0

    # ── Phase 1: Simple renames ──
    print("=" * 60)
    print("Phase 1: Simple renames/merges")
    print("=" * 60)
    for old_name, new_name in SIMPLE_RENAMES.items():
        rows = fetch_by_chapter(client, old_name)
        if not rows:
            print(f"  {old_name}: 0 MCQs (skip)")
            continue
        print(f"  {old_name} -> {new_name}: {len(rows)} MCQs")
        changes = [(r["id"], new_name) for r in rows]
        total_updated += apply_updates(client, changes, args.dry_run, old_name)

    # ── Phase 2: LLM splits ──
    print(f"\n{'=' * 60}")
    print("Phase 2: LLM chapter splits")
    print("=" * 60)
    for old_name, cfg in SPLIT_CHAPTERS.items():
        rows = fetch_by_chapter(client, old_name)
        if not rows:
            print(f"\n  {old_name}: 0 MCQs (skip)")
            continue
        targets = cfg["targets"]
        print(f"\n  {old_name} -> {targets[0]} / {targets[1]}: {len(rows)} MCQs")
        llm_results = llm_split_batch(rows, targets, cfg["hint"])

        counts = {}
        changes = []
        unclassified = 0
        for r in rows:
            new_ch = llm_results.get(r["id"])
            if new_ch:
                changes.append((r["id"], new_ch))
                counts[new_ch] = counts.get(new_ch, 0) + 1
            else:
                unclassified += 1

        for ch, n in sorted(counts.items(), key=lambda x: -x[1]):
            print(f"    -> {ch}: {n}")
        if unclassified:
            print(f"    -> unclassified: {unclassified}")

        total_updated += apply_updates(client, changes, args.dry_run, old_name)

    # ── Phase 3: Keyword reclassify remaining "Biology" generics ──
    print(f"\n{'=' * 60}")
    print("Phase 3: Keyword reclassify generic 'Biology'")
    print("=" * 60)
    generic = fetch_by_chapter(client, "Biology")
    if generic:
        kw_changes = []
        for r in generic:
            new_ch = classify_question_chapter(r["question_text"], r.get("options"), fallback="Biology")
            if new_ch != "Biology" and new_ch in _CANONICAL_NAMES:
                kw_changes.append((r["id"], new_ch))
        print(f"  {len(generic)} generic MCQs -> {len(kw_changes)} reclassified by keywords")
        total_updated += apply_updates(client, kw_changes, args.dry_run, "Keywords")
    else:
        print("  No generic MCQs")

    # ── Summary ──
    print(f"\n{'=' * 60}")
    action = "Would update" if args.dry_run else "Updated"
    print(f"{action} {total_updated} MCQs total.")
    if args.dry_run:
        print("Re-run without --dry-run to apply.")


if __name__ == "__main__":
    main()
