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
    report = weak_spots.ranked_chapter_report(student_id) or weak_spots.ranked_report(
        student_id
    )
    targets = report[:5]

    plan_items = []
    for i, day in enumerate(DAYS):
        if i < len(targets):
            t = targets[i]
            minutes = _minutes_for(t.get("priority_score", 0))
            label = t.get("concept") or t.get("chapter") or "Biology"
            plan_items.append(
                {
                    "day": day,
                    "concept_id": t.get("concept_id"),
                    "concept": label,
                    "chapter": t.get("chapter"),
                    "minutes": minutes,
                    "question_count": max(5, minutes // 3),
                    "reason": (
                        f"Drill {t['chapter']} — {t['accuracy_pct']:.0f}% accuracy so far"
                        if t.get("chapter")
                        else f"Focus on {label} — keep drilling until it sticks"
                    ),
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
    ranked = weak_spots.ranked_chapter_report(student_id)[:4]

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
                    "reason": (
                        f"Do {t['chapter']} — {t['accuracy_pct']:.0f}% accuracy. "
                        "Keep drilling until it sticks."
                    ),
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

    if ranked:
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
