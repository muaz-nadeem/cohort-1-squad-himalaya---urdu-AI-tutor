"""Weak-spot engine.

Everything about personalisation is derived from `student_attempts`:
  - accuracy per concept
  - failure frequency
  - correct streak (mastery detection: 3-in-a-row)
  - priority score used to rank drills and build the weekly plan

Priority score (higher = drill sooner):
    priority = (1 - accuracy) * 50          # weakness weight
             + min(failures, 10) * 3        # how often they miss it
             + mdcat_weightage * 5          # exam importance
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from . import db

MASTERY_STREAK = 3


def _priority(accuracy: float, failures: int, weightage: int) -> float:
    return round(
        (1 - accuracy) * 50 + min(failures, 10) * 3 + weightage * 5,
        2,
    )


def _trend(accuracy: float, streak: int) -> str:
    if streak >= MASTERY_STREAK or accuracy >= 0.8:
        return "improving"
    if accuracy < 0.4:
        return "getting_worse"
    return "stuck"


def recompute_for_concept(student_id: str, concept_id: str) -> dict[str, Any]:
    """Recalculate one concept's weak-spot row from all attempts on it."""
    attempts = [
        a
        for a in db.get_attempts(student_id)
        if a.get("concept_id") == concept_id
    ]
    total = len(attempts)
    correct = sum(1 for a in attempts if a.get("is_correct"))
    failures = total - correct
    accuracy = (correct / total) if total else 0.0

    # consecutive correct answers at the tail
    streak = 0
    for a in reversed(attempts):
        if a.get("is_correct"):
            streak += 1
        else:
            break

    last_wrong_at = None
    for a in reversed(attempts):
        if not a.get("is_correct"):
            last_wrong_at = a.get("created_at")
            break

    concept = db.get_concept(concept_id) or {}
    weightage = int(concept.get("mdcat_weightage", 1))

    row = {
        "student_id": student_id,
        "concept_id": concept_id,
        "accuracy_pct": round(accuracy * 100, 1),
        "attempts": total,
        "correct_streak": streak,
        "last_wrong_at": last_wrong_at,
        "priority_score": _priority(accuracy, failures, weightage),
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    return db.upsert_weak_spot(row)


def recompute_for_session(student_id: str, session_id: str) -> list[dict[str, Any]]:
    """After a session ends, refresh every concept touched in that session."""
    attempts = db.get_attempts(student_id, session_id=session_id)
    concept_ids = {a["concept_id"] for a in attempts if a.get("concept_id")}
    return [recompute_for_concept(student_id, cid) for cid in concept_ids]


def ranked_report(student_id: str) -> list[dict[str, Any]]:
    """Ranked weak-spot list with color-coding + trend, ready for the UI."""
    rows = db.list_weak_spots(student_id)
    concepts = {c["id"]: c for c in db.list_concepts()}
    report = []
    for r in rows:
        concept = concepts.get(r["concept_id"], {})
        accuracy = (r.get("accuracy_pct") or 0) / 100
        streak = r.get("correct_streak", 0)
        acc_pct = r.get("accuracy_pct") or 0

        if acc_pct >= 75 or streak >= MASTERY_STREAK:
            color = "green"  # mastered
        elif acc_pct >= 50:
            color = "amber"  # review
        else:
            color = "red"  # drill immediately

        report.append(
            {
                "concept_id": r["concept_id"],
                "concept": concept.get("name", "Unknown"),
                "chapter": concept.get("chapter"),
                "accuracy_pct": acc_pct,
                "attempts": r.get("attempts", 0),
                "priority_score": r.get("priority_score", 0),
                "trend": _trend(accuracy, streak),
                "color": color,
                "needs_drill": r.get("attempts", 0) >= 2 and acc_pct < 50,
            }
        )
    return report


def concept_failed_enough_for_drill(student_id: str, concept_id: str) -> bool:
    """A concept enters Drill mode once it has failed 2+ times."""
    ws = db.get_weak_spot(student_id, concept_id)
    if not ws:
        return False
    total = ws.get("attempts", 0)
    accuracy = (ws.get("accuracy_pct") or 0) / 100
    failures = round(total * (1 - accuracy))
    return failures >= 2


def recommended_focus(student_id: str) -> dict[str, Any] | None:
    """'Aaj ka focus' — highest-priority concept to drill today."""
    report = ranked_report(student_id)
    if not report:
        return None
    return report[0]
