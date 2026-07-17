"""Supabase client + thin data-access helpers.

Everything that touches Postgres/pgvector goes through here so the rest of the
codebase never imports the supabase SDK directly.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Optional

from supabase import Client, create_client

from .config import settings


@lru_cache
def get_client() -> Optional[Client]:
    if not settings.supabase_ready:
        return None
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


def require_client() -> Client:
    client = get_client()
    if client is None:
        raise RuntimeError(
            "Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY in .env."
        )
    return client


# ── students ────────────────────────────────────────────────────────────────
def create_student(payload: dict[str, Any]) -> dict[str, Any]:
    res = require_client().table("students").insert(payload).execute()
    return res.data[0]


def get_student(student_id: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("students")
        .select("*")
        .eq("id", student_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def find_student_by_email(email: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("students")
        .select("*")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def update_student(student_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return (
        require_client()
        .table("students")
        .update(payload)
        .eq("id", student_id)
        .execute()
        .data[0]
    )


# ── concepts ────────────────────────────────────────────────────────────────
def list_concepts() -> list[dict[str, Any]]:
    return require_client().table("concepts").select("*").execute().data


def get_concept(concept_id: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("concepts")
        .select("*")
        .eq("id", concept_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


# ── questions ───────────────────────────────────────────────────────────────
def get_questions(
    *,
    chapter: Optional[str] = None,
    concept_id: Optional[str] = None,
    difficulty: Optional[int] = None,
    book: Optional[str] = None,
    source_type: Optional[str] = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    q = require_client().table("questions").select("*")
    if chapter:
        q = q.eq("chapter", chapter)
    if concept_id:
        q = q.eq("concept_id", concept_id)
    if difficulty:
        q = q.eq("difficulty", difficulty)
    if book:
        q = q.eq("book", book)
    if source_type:
        q = q.eq("source_type", source_type)
    return q.limit(limit).execute().data


def sample_questions(
    *,
    count: int = 25,
    chapter: Optional[str] = None,
    book: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Random sample across the mixed bank (all source_types)."""
    try:
        res = require_client().rpc(
            "sample_questions",
            {
                "match_count": count,
                "filter_chapter": chapter,
                "filter_book": book,
            },
        ).execute()
        if res.data:
            return res.data
    except Exception:
        pass
    # Fallback: fetch a pool and shuffle in Python
    import random

    pool = get_questions(chapter=chapter, book=book, limit=max(count * 5, 200))
    random.shuffle(pool)
    return pool[:count]


def insert_questions(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    client = require_client()
    stored = 0
    batch = 50
    for i in range(0, len(rows), batch):
        chunk = rows[i : i + batch]
        client.table("questions").insert(chunk).execute()
        stored += len(chunk)
    return stored


def list_distinct_chapters() -> list[str]:
    rows = (
        require_client()
        .table("questions")
        .select("chapter")
        .limit(2000)
        .execute()
        .data
        or []
    )
    seen: list[str] = []
    for r in rows:
        ch = r.get("chapter")
        if ch and ch not in seen:
            seen.append(ch)
    return seen


def get_question(question_id: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("questions")
        .select("*")
        .eq("id", question_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


# ── sessions ────────────────────────────────────────────────────────────────
def create_session(payload: dict[str, Any]) -> dict[str, Any]:
    return require_client().table("sessions").insert(payload).execute().data[0]


def end_session(session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return (
        require_client()
        .table("sessions")
        .update(payload)
        .eq("id", session_id)
        .execute()
        .data[0]
    )


def get_session(session_id: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


# ── attempts ────────────────────────────────────────────────────────────────
def log_attempt(payload: dict[str, Any]) -> dict[str, Any]:
    return require_client().table("student_attempts").insert(payload).execute().data[0]


def get_attempts(
    student_id: str, *, session_id: Optional[str] = None
) -> list[dict[str, Any]]:
    q = (
        require_client()
        .table("student_attempts")
        .select("*")
        .eq("student_id", student_id)
    )
    if session_id:
        q = q.eq("session_id", session_id)
    return q.order("created_at").execute().data


# ── weak spots ──────────────────────────────────────────────────────────────
def upsert_weak_spot(payload: dict[str, Any]) -> dict[str, Any]:
    return (
        require_client()
        .table("weak_spots")
        .upsert(payload, on_conflict="student_id,concept_id")
        .execute()
        .data[0]
    )


def get_weak_spot(student_id: str, concept_id: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("weak_spots")
        .select("*")
        .eq("student_id", student_id)
        .eq("concept_id", concept_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_weak_spots(student_id: str) -> list[dict[str, Any]]:
    return (
        require_client()
        .table("weak_spots")
        .select("*")
        .eq("student_id", student_id)
        .order("priority_score", desc=True)
        .execute()
        .data
    )


# ── weekly plan ─────────────────────────────────────────────────────────────
def upsert_weekly_plan(payload: dict[str, Any]) -> dict[str, Any]:
    return (
        require_client()
        .table("weekly_plans")
        .upsert(payload, on_conflict="student_id,week_start")
        .execute()
        .data[0]
    )


def get_latest_weekly_plan(student_id: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("weekly_plans")
        .select("*")
        .eq("student_id", student_id)
        .order("week_start", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


# ── daily plans ─────────────────────────────────────────────────────────────
def upsert_daily_plan(payload: dict[str, Any]) -> dict[str, Any]:
    return (
        require_client()
        .table("daily_plans")
        .upsert(payload, on_conflict="student_id,plan_date")
        .execute()
        .data[0]
    )


def get_daily_plan(student_id: str, plan_date: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("daily_plans")
        .select("*")
        .eq("student_id", student_id)
        .eq("plan_date", plan_date)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


# ── mnemonic chunks ─────────────────────────────────────────────────────────
def insert_mnemonic_chunks(rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    client = require_client()
    stored = 0
    for i in range(0, len(rows), 40):
        chunk = rows[i : i + 40]
        client.table("mnemonic_chunks").insert(chunk).execute()
        stored += len(chunk)
    return stored


def match_mnemonic_chunks(
    query_embedding: list[float], match_count: int = 3
) -> list[dict[str, Any]]:
    try:
        res = require_client().rpc(
            "match_mnemonic_chunks",
            {"query_embedding": query_embedding, "match_count": match_count},
        ).execute()
        return res.data or []
    except Exception:
        return []


# ── RAG retrieval ───────────────────────────────────────────────────────────
def match_chunks(
    query_embedding: list[float],
    match_count: int = 2,
    concept: Optional[str] = None,
    book: Optional[str] = None,
) -> list[dict[str, Any]]:
    payload = {
        "query_embedding": query_embedding,
        "match_count": match_count,
        "filter_concept": concept,
        "filter_book": book,
    }
    try:
        res = require_client().rpc("match_chunks", payload).execute()
        return res.data or []
    except Exception:
        # Pre-migration RPC without filter_book
        payload.pop("filter_book", None)
        res = require_client().rpc("match_chunks", payload).execute()
        return res.data or []
