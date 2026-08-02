"""Weekly + daily study-plan generators from weak-spot scores."""
from __future__ import annotations

import datetime as dt
from typing import Any

from . import db, weak_spots

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]


def _minutes_for(priority: float) -> int:
    if priority >= 60:
        return 45
    if priority >= 40:
        return 30
    return 20


def _next_monday(today: dt.date | None = None) -> dt.date:
    today = today or dt.date.today()
    days_ahead = (7 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    return today + dt.timedelta(days=days_ahead)


def generate_plan(student_id: str) -> dict[str, Any]:
    report = weak_spots.ranked_report(student_id)
    targets = report[:5]

    plan_items = []
    for i, day in enumerate(DAYS):
        if i < len(targets):
            t = targets[i]
            minutes = _minutes_for(t.get("priority_score", 0))
            plan_items.append(
                {
                    "day": day,
                    "concept_id": t["concept_id"],
                    "concept": t["concept"],
                    "chapter": t.get("chapter"),
                    "minutes": minutes,
                    "question_count": max(5, minutes // 3),
                    "reason": f"Focus on {t['concept']} — keep drilling until it sticks",
                }
            )
        else:
            plan_items.append(
                {
                    "day": day,
                    "concept": "Mixed revision",
                    "minutes": 20,
                    "question_count": 7,
                    "reason": "General practice",
                }
            )

    week_start = _next_monday()
    payload = {
        "student_id": student_id,
        "week_start": week_start.isoformat(),
        "plan": plan_items,
    }
    return db.upsert_weekly_plan(payload)


def generate_daily_plan(student_id: str, plan_date: dt.date | None = None) -> dict[str, Any]:
    """Build today's plan from weak chapters — practice those first."""
    plan_date = plan_date or dt.date.today()
    report = weak_spots.ranked_report(student_id)

    # Collapse to chapter-level weak spots from concept report
    by_chapter: dict[str, dict[str, Any]] = {}
    for r in report:
        ch = r.get("chapter") or "Biology"
        bucket = by_chapter.setdefault(
            ch,
            {
                "chapter": ch,
                "accuracy_pct": r.get("accuracy_pct", 0),
                "priority_score": r.get("priority_score", 0),
                "concept": r.get("concept"),
                "concept_id": r.get("concept_id"),
            },
        )
        if r.get("priority_score", 0) > bucket["priority_score"]:
            bucket.update(
                {
                    "accuracy_pct": r.get("accuracy_pct", 0),
                    "priority_score": r.get("priority_score", 0),
                    "concept": r.get("concept"),
                    "concept_id": r.get("concept_id"),
                }
            )

    # Fallback: chapter accuracy from attempts (MCQ bank often has chapter, no concept_id)
    if not by_chapter:
        attempts = db.get_attempts(student_id)
        chapters: dict[str, dict[str, int]] = {}
        for a in attempts:
            q = db.get_question(a["question_id"]) if a.get("question_id") else None
            ch = (q or {}).get("chapter")
            if not ch:
                continue
            b = chapters.setdefault(ch, {"attempted": 0, "correct": 0})
            b["attempted"] += 1
            if a.get("is_correct"):
                b["correct"] += 1
        for ch, b in chapters.items():
            acc = round(b["correct"] / b["attempted"] * 100, 1) if b["attempted"] else 0
            failures = b["attempted"] - b["correct"]
            by_chapter[ch] = {
                "chapter": ch,
                "accuracy_pct": acc,
                "priority_score": round((1 - acc / 100) * 50 + min(failures, 10) * 3, 2),
            }

    ranked = sorted(
        by_chapter.values(), key=lambda x: x["priority_score"], reverse=True
    )[:4]

    items: list[dict[str, Any]] = []
    if ranked:
        for t in ranked:
            minutes = _minutes_for(t["priority_score"])
            items.append(
                {
                    "chapter": t["chapter"],
                    "concept": t.get("concept"),
                    "concept_id": t.get("concept_id"),
                    "minutes": minutes,
                    "question_count": min(100, max(15, minutes)),
                    "reason": "You keep missing questions here — focus this chapter today",
                    "action": "chapter_practice",
                }
            )
    else:
        items.append(
            {
                "chapter": None,
                "minutes": 30,
                "question_count": 25,
                "reason": "Pick any chapter and start practising — we adapt your plan as you go",
                "action": "chapter_practice",
            }
        )

    if by_chapter:
        items.append(
            {
                "chapter": None,
                "minutes": 70,
                "question_count": 81,
                "reason": "Simulate MDCAT Biology — our mixed 81-Q FLP",
                "action": "full_length_practice",
            }
        )

    payload = {
        "student_id": student_id,
        "plan_date": plan_date.isoformat(),
        "items": items,
    }
    return db.upsert_daily_plan(payload)


def get_or_create_daily_plan(student_id: str) -> dict[str, Any]:
    today = dt.date.today().isoformat()
    existing = db.get_daily_plan(student_id, today)
    if existing:
        return existing
    return generate_daily_plan(student_id)
