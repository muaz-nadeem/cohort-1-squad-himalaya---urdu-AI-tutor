"""Weak-spot engine.

Personalisation is derived from `student_attempts`. With only a handful of
MCQs tagged to concepts, chapter-level aggregation is the primary signal; concept
rows are used when enough tagged data exists.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from . import db

MASTERY_STREAK = 3
MIN_CHAPTER_ATTEMPTS = 3


def _priority(accuracy: float, failures: int, weightage: int = 1) -> float:
    return round(
        (1 - accuracy) * 50 + min(failures, 10) * 3 + weightage * 5,
        2,
    )


def _normalize_chapter(name: str) -> str:
    n = (name or "").strip()
    if not n:
        return "Unknown"
    return db.CHAPTER_COUNT_ALIASES.get(n, n)


def _attempts_grouped_by_chapter(student_id: str) -> dict[str, list[dict[str, Any]]]:
    """Group attempts by canonical chapter name (batch-fetch questions)."""
    attempts = db.get_attempts(student_id)
    if not attempts:
        return {}

    concepts = {c["id"]: c for c in db.list_concepts()}
    needed_qids = [
        a["question_id"]
        for a in attempts
        if a.get("question_id") and not concepts.get(a.get("concept_id"))
    ]
    q_map = (
        db.get_questions_by_ids(needed_qids, columns="id,chapter")
        if needed_qids
        else {}
    )

    grouped: dict[str, list[dict[str, Any]]] = {}
    for a in attempts:
        concept = concepts.get(a.get("concept_id"))
        chapter = None
        if concept:
            chapter = concept.get("chapter")
        else:
            q = q_map.get(a.get("question_id"))
            chapter = (q or {}).get("chapter")
        if not chapter:
            continue
        ch = _normalize_chapter(chapter)
        grouped.setdefault(ch, []).append(a)
    return grouped


def _tail_streak(attempts: list[dict[str, Any]]) -> int:
    streak = 0
    for a in reversed(attempts):
        if a.get("is_correct"):
            streak += 1
        else:
            break
    return streak


def _chapter_trend(attempts: list[dict[str, Any]]) -> str:
    """Trend from tail streak + recent vs older accuracy."""
    if len(attempts) < MIN_CHAPTER_ATTEMPTS:
        return "stuck"

    sorted_a = sorted(attempts, key=lambda x: x.get("created_at") or "")
    streak = _tail_streak(sorted_a)
    total = len(sorted_a)
    correct = sum(1 for a in sorted_a if a.get("is_correct"))
    accuracy = correct / total

    if streak >= MASTERY_STREAK or accuracy >= 0.8:
        return "improving"

    window = min(10, max(3, total // 2))
    recent = sorted_a[-window:]
    older = sorted_a[:-window] if total > window else []
    recent_acc = sum(1 for a in recent if a.get("is_correct")) / len(recent)

    if older:
        older_acc = sum(1 for a in older if a.get("is_correct")) / len(older)
        if recent_acc >= older_acc + 0.08:
            return "improving"
        if recent_acc <= older_acc - 0.08:
            return "getting_worse"

    if accuracy < 0.4:
        return "getting_worse"
    return "stuck"


def _color_for(acc_pct: float, streak: int) -> str:
    if acc_pct >= 75 or streak >= MASTERY_STREAK:
        return "green"
    if acc_pct >= 50:
        return "amber"
    return "red"


def chapter_progress(student_id: str) -> list[dict[str, Any]]:
    """Per-chapter stats with trend — for dashboard and practice cards."""
    grouped = _attempts_grouped_by_chapter(student_id)
    out: list[dict[str, Any]] = []
    for chapter, attempts in grouped.items():
        total = len(attempts)
        correct = sum(1 for a in attempts if a.get("is_correct"))
        acc_pct = round(correct / total * 100, 1) if total else 0.0
        streak = _tail_streak(sorted(attempts, key=lambda x: x.get("created_at") or ""))
        out.append(
            {
                "chapter": chapter,
                "attempted": total,
                "correct": correct,
                "accuracy_pct": acc_pct,
                "trend": _chapter_trend(attempts),
                "correct_streak": streak,
            }
        )
    out.sort(key=lambda x: (-x["attempted"], x["accuracy_pct"]))
    return out


def ranked_chapter_report(student_id: str) -> list[dict[str, Any]]:
    """Ranked chapter weak spots — primary report for the live MCQ bank."""
    grouped = _attempts_grouped_by_chapter(student_id)
    report: list[dict[str, Any]] = []

    for chapter, attempts in grouped.items():
        total = len(attempts)
        if total < MIN_CHAPTER_ATTEMPTS:
            continue
        correct = sum(1 for a in attempts if a.get("is_correct"))
        failures = total - correct
        accuracy = correct / total
        acc_pct = round(accuracy * 100, 1)
        streak = _tail_streak(sorted(attempts, key=lambda x: x.get("created_at") or ""))
        trend = _chapter_trend(attempts)
        color = _color_for(acc_pct, streak)

        report.append(
            {
                "chapter": chapter,
                "concept": chapter,
                "accuracy_pct": acc_pct,
                "attempts": total,
                "priority_score": _priority(accuracy, failures),
                "trend": trend,
                "color": color,
                "needs_drill": total >= MIN_CHAPTER_ATTEMPTS and acc_pct < 65,
            }
        )

    report.sort(key=lambda x: (-x["priority_score"], x["accuracy_pct"]))
    return report


def _ranked_concept_report(student_id: str) -> list[dict[str, Any]]:
    """Concept-level weak spots when enough tagged MCQs exist."""
    rows = db.list_weak_spots(student_id)
    concepts = {c["id"]: c for c in db.list_concepts()}
    report = []
    for r in rows:
        concept = concepts.get(r["concept_id"], {})
        accuracy = (r.get("accuracy_pct") or 0) / 100
        streak = r.get("correct_streak", 0)
        acc_pct = r.get("accuracy_pct") or 0

        report.append(
            {
                "concept_id": r["concept_id"],
                "concept": concept.get("name", "Unknown"),
                "chapter": concept.get("chapter"),
                "accuracy_pct": acc_pct,
                "attempts": r.get("attempts", 0),
                "priority_score": r.get("priority_score", 0),
                "trend": _concept_trend(accuracy, streak),
                "color": _color_for(acc_pct, streak),
                "needs_drill": r.get("attempts", 0) >= 2 and acc_pct < 50,
            }
        )
    return report


def _concept_trend(accuracy: float, streak: int) -> str:
    if streak >= MASTERY_STREAK or accuracy >= 0.8:
        return "improving"
    if accuracy < 0.4:
        return "getting_worse"
    return "stuck"


def ranked_report(student_id: str) -> list[dict[str, Any]]:
    """Weak-spot list for the UI — chapter-first unless concept data is rich."""
    concept_report = _ranked_concept_report(student_id)
    chapter_report = ranked_chapter_report(student_id)
    if len(concept_report) >= 3:
        return concept_report
    return chapter_report


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

    streak = _tail_streak(attempts)

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
    """Highest-priority chapter (or concept) to drill today."""
    report = ranked_report(student_id)
    if not report:
        return None
    return report[0]


def session_weak_chapters(
    student_id: str, session_chapters: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Chapters that went poorly in this session (for summary highlights)."""
    weak = [
        c
        for c in session_chapters
        if c.get("attempted", 0) >= 2 and (c.get("accuracy_pct") or 0) < 65
    ]
    weak.sort(key=lambda x: x.get("accuracy_pct", 0))
    return weak
