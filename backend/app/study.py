"""Study-session logic: diagnostic, chapter practice, custom quiz, platform FLP.

All question sets are sampled from the mixed bank (academy tests + FLPs +
past papers + most-repeated). Chapter practice never uses a single PDF;
full-length is always our own 81-Q Biology mix — never one academy FLP as-is.
"""
from __future__ import annotations

from typing import Any, Optional

from . import db, weak_spots
from .chapters import list_chapters

DIAGNOSTIC_COUNT = 25
CHAPTER_PRACTICE_COUNT = 100
FULL_LENGTH_BIOLOGY = 81
DRILL_TIME_LIMIT_SEC = 20 * 60
DRILL_MASTERY_STREAK = 3
# MDCAT Biology timed section ~ 81 Q in ~65–70 min → ~50s each; use 70 min
FULL_LENGTH_TIMED_SEC = 70 * 60


def build_diagnostic(count: int = DIAGNOSTIC_COUNT) -> list[dict[str, Any]]:
    return db.sample_questions(count=count)


def build_chapter_practice(
    chapter: str, count: int = CHAPTER_PRACTICE_COUNT
) -> list[dict[str, Any]]:
    """100 MCQs for one chapter, mixed across all source_types."""
    return db.sample_questions(count=count, chapter=chapter)


def build_custom(selections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """selections: [{ chapter, book?, count }] — each slice mixed from bank."""
    ordered: list[dict[str, Any]] = []
    seen: set[str] = set()
    for sel in selections:
        chapter = sel.get("chapter")
        if not chapter:
            continue
        n = max(1, min(int(sel.get("count") or 10), 100))
        # Sample by chapter only — book is UI metadata; bank mixes all sources
        batch = db.sample_questions(count=n, chapter=chapter)
        for q in batch:
            qid = q.get("id")
            if qid and qid in seen:
                continue
            if qid:
                seen.add(qid)
            ordered.append(q)
    return ordered


def build_platform_flp(count: int = FULL_LENGTH_BIOLOGY) -> list[dict[str, Any]]:
    """Our own Biology FLP: mix from entire bank (tests + FLPs + past papers)."""
    chapters = db.list_distinct_chapters()
    if len(chapters) >= 4:
        # Stratify roughly evenly across chapters present in bank
        per = max(1, count // len(chapters))
        picked: list[dict[str, Any]] = []
        seen: set[str] = set()
        for ch in chapters:
            for q in db.sample_questions(count=per + 2, chapter=ch):
                qid = q.get("id")
                if qid in seen:
                    continue
                seen.add(qid)
                picked.append(q)
                if len(picked) >= count:
                    return picked[:count]
        if len(picked) < count:
            extra = db.sample_questions(count=count - len(picked))
            for q in extra:
                qid = q.get("id")
                if qid and qid not in seen:
                    seen.add(qid)
                    picked.append(q)
                if len(picked) >= count:
                    break
        return picked[:count]
    return db.sample_questions(count=count)


def build_drill(concept_id: str) -> list[dict[str, Any]]:
    ordered: list[dict[str, Any]] = []
    for level in (1, 2, 3):
        ordered.extend(
            db.get_questions(concept_id=concept_id, difficulty=level, limit=10)
        )
    return ordered


def next_questions_for_student(
    student_id: str,
    *,
    chapter: Optional[str] = None,
    concept_id: Optional[str] = None,
) -> dict[str, Any]:
    """Legacy helper used by /api/questions — prefers chapter practice / drill."""
    if concept_id:
        return {
            "mode": "drill",
            "concept_id": concept_id,
            "questions": build_drill(concept_id),
        }

    if chapter:
        report = weak_spots.ranked_report(student_id)
        drill_target = next(
            (
                r
                for r in report
                if r.get("chapter") == chapter and r.get("needs_drill")
            ),
            None,
        )
        if drill_target:
            return {
                "mode": "drill",
                "concept_id": drill_target["concept_id"],
                "recommended": drill_target,
                "questions": build_drill(drill_target["concept_id"]),
            }
        return {
            "mode": "chapter_practice",
            "chapter": chapter,
            "questions": build_chapter_practice(chapter),
        }

    focus = weak_spots.recommended_focus(student_id)
    if focus:
        return {
            "mode": "drill",
            "concept_id": focus["concept_id"],
            "recommended": focus,
            "questions": build_drill(focus["concept_id"]),
        }
    return {"mode": "diagnostic", "questions": build_diagnostic()}


def session_summary(student_id: str, session_id: str) -> dict[str, Any]:
    attempts = db.get_attempts(student_id, session_id=session_id)
    total = len(attempts)
    correct = sum(1 for a in attempts if a.get("is_correct"))

    concepts = {c["id"]: c for c in db.list_concepts()}
    per_concept: dict[str, dict[str, Any]] = {}
    chapters: dict[str, dict[str, Any]] = {}

    for a in attempts:
        cid = a.get("concept_id")
        if cid:
            bucket = per_concept.setdefault(
                cid,
                {
                    "concept_id": cid,
                    "concept": concepts.get(cid, {}).get("name", "Unknown"),
                    "attempted": 0,
                    "correct": 0,
                },
            )
            bucket["attempted"] += 1
            if a.get("is_correct"):
                bucket["correct"] += 1

        q = db.get_question(a["question_id"]) if a.get("question_id") else None
        ch = (q or {}).get("chapter") or concepts.get(cid or "", {}).get("chapter")
        if ch:
            cb = chapters.setdefault(
                ch, {"chapter": ch, "attempted": 0, "correct": 0}
            )
            cb["attempted"] += 1
            if a.get("is_correct"):
                cb["correct"] += 1

    for b in per_concept.values():
        b["accuracy_pct"] = round(b["correct"] / b["attempted"] * 100, 1)
    for b in chapters.values():
        b["accuracy_pct"] = round(b["correct"] / b["attempted"] * 100, 1)

    focus = weak_spots.recommended_focus(student_id)
    return {
        "session_id": session_id,
        "score": correct,
        "total": total,
        "accuracy_pct": round(correct / total * 100, 1) if total else 0,
        "concepts": list(per_concept.values()),
        "chapters": list(chapters.values()),
        "next_recommendation": focus,
    }


def available_chapters() -> list[dict[str, Any]]:
    catalog = list_chapters()
    in_bank = set(db.list_distinct_chapters())
    out = []
    for c in catalog:
        out.append({**c, "has_questions": c["name"] in in_bank})
    # Include any bank chapters not in catalog
    known = {c["name"] for c in catalog}
    for name in in_bank:
        if name not in known:
            out.append(
                {
                    "id": name.lower().replace(" ", "_")[:40],
                    "name": name,
                    "book": "fsc_part1",
                    "has_questions": True,
                }
            )
    return out
