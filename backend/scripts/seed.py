"""Seed concepts + questions into Supabase from data/seed_biology.json.

Usage:
    python -m scripts.seed
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.append(".")

from app.config import settings  # noqa: E402
from app.db import require_client  # noqa: E402

SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "seed_biology.json"


def main() -> None:
    if not settings.supabase_ready:
        sys.exit("SUPABASE_URL/SUPABASE_KEY must be set in .env")

    supabase = require_client()
    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))

    # 1. Concepts — insert and map name -> id
    concept_ids: dict[str, str] = {}
    for c in data["concepts"]:
        existing = (
            supabase.table("concepts")
            .select("id")
            .eq("name", c["name"])
            .eq("chapter", c["chapter"])
            .execute()
            .data
        )
        if existing:
            concept_ids[c["name"]] = existing[0]["id"]
            print(f"  concept exists: {c['name']}")
            continue
        row = supabase.table("concepts").insert(c).execute().data[0]
        concept_ids[c["name"]] = row["id"]
        print(f"  + concept: {c['name']}")

    # 2. Questions — resolve concept name -> concept_id
    inserted = 0
    for q in data["questions"]:
        concept_name = q.pop("concept")
        q["concept_id"] = concept_ids.get(concept_name)
        # avoid dupes on identical question_text
        existing = (
            supabase.table("questions")
            .select("id")
            .eq("question_text", q["question_text"])
            .execute()
            .data
        )
        if existing:
            print(f"  question exists: {q['question_text'][:50]}...")
            continue
        supabase.table("questions").insert(q).execute()
        inserted += 1
        print(f"  + question: {q['question_text'][:50]}...")

    print(f"\nDone. {len(concept_ids)} concepts, {inserted} new questions.")


if __name__ == "__main__":
    main()
