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
    res = (
        require_client()
        .table("students")
        .upsert(payload, on_conflict="id")
        .execute()
    )
    if not res.data:
        raise RuntimeError("Student upsert returned no rows (check SUPABASE service_role key)")
    return res.data[0]


def upsert_student_profile(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Create or update the students row for auth.uid() (== user_id)."""
    existing = get_student(user_id)
    clean = {k: v for k, v in payload.items() if k != "id" and v is not None}
    if existing:
        if not clean:
            return existing
        return update_student(user_id, clean)
    # Prefer upsert so a partial/racy create does not hard-fail.
    row = {"id": user_id, **clean}
    try:
        return create_student(row)
    except Exception as exc:
        # Unique email conflict: retry without email so practice can start.
        if "email" in row and "email" in str(exc).lower():
            row.pop("email", None)
            return create_student(row)
        raise


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


def session_attempt_score(student_id: str, session_id: str) -> tuple[int, int]:
    """Recompute score/total from logged attempts (do not trust the client)."""
    attempts = get_attempts(student_id, session_id=session_id)
    total = len(attempts)
    score = sum(1 for a in attempts if a.get("is_correct"))
    return score, total


# ── concepts ────────────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
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
# Lean columns for practice payloads (answer key stripped later by public_question).
_PRACTICE_COLUMNS = (
    "id,concept_id,chapter,difficulty,question_text,options,"
    "source,source_type,book"
)


def get_questions(
    *,
    chapter: Optional[str] = None,
    concept_id: Optional[str] = None,
    difficulty: Optional[int] = None,
    book: Optional[str] = None,
    source_type: Optional[str] = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    q = require_client().table("questions").select(_PRACTICE_COLUMNS)
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
    return q.limit(limit).execute().data or []


def _list_question_ids(
    *,
    chapter: Optional[str] = None,
    book: Optional[str] = None,
    max_ids: int = 800,
) -> list[str]:
    """Fetch only question ids (tiny payload) for in-process sampling."""
    client = require_client()
    page_size = 1000
    ids: list[str] = []
    offset = 0
    while len(ids) < max_ids:
        q = client.table("questions").select("id")
        if chapter:
            q = q.eq("chapter", chapter)
        if book:
            q = q.eq("book", book)
        rows = (
            q.range(offset, offset + page_size - 1).execute().data or []
        )
        for r in rows:
            qid = r.get("id")
            if qid:
                ids.append(str(qid))
                if len(ids) >= max_ids:
                    break
        if len(rows) < page_size:
            break
        offset += page_size
    return ids


def _hydrate_questions(ids: list[str]) -> list[dict[str, Any]]:
    if not ids:
        return []
    by_id = get_questions_by_ids(ids, columns=_PRACTICE_COLUMNS)
    return [by_id[i] for i in ids if i in by_id]


def sample_questions(
    *,
    count: int = 25,
    chapter: Optional[str] = None,
    book: Optional[str] = None,
    exclude_ids: Optional[list[str]] = None,
) -> list[dict[str, Any]]:
    """Random sample across the mixed bank (all source_types).

    When ``exclude_ids`` is provided (questions the student has already seen),
    unseen questions are returned first so a re-attempt of the same chapter
    yields fresh MCQs. If the unseen pool is smaller than ``count`` (chapter
    exhausted), the remainder is topped up with a reshuffled set of seen ones.

    Fallback path is id-first (tiny) then hydrate only the chosen rows — keeps
    free-tier RAM under control even for count=100.
    """
    import random

    exclude = {str(x) for x in (exclude_ids or []) if x}
    count = max(1, count)

    if not exclude:
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
                # RPC may return full rows; re-hydrate lean if oversized risk.
                ids = [str(r["id"]) for r in res.data if r.get("id")]
                return _hydrate_questions(ids) or res.data
        except Exception:
            pass
        ids = _list_question_ids(chapter=chapter, book=book)
        random.shuffle(ids)
        return _hydrate_questions(ids[:count])

    try:
        res = require_client().rpc(
            "sample_questions",
            {
                "match_count": count,
                "filter_chapter": chapter,
                "filter_book": book,
                "exclude_ids": list(exclude),
            },
        ).execute()
        if res.data:
            ids = [str(r["id"]) for r in res.data if r.get("id")]
            return _hydrate_questions(ids) or res.data
    except Exception:
        pass

    ids = _list_question_ids(chapter=chapter, book=book)
    unseen = [i for i in ids if i not in exclude]
    seen = [i for i in ids if i in exclude]
    random.shuffle(unseen)
    random.shuffle(seen)
    picked = (unseen + seen)[:count]
    return _hydrate_questions(picked)


def get_attempted_question_ids(student_id: str) -> list[str]:
    """All question_ids a student has ever attempted (for unseen-first sampling)."""
    if not student_id:
        return []
    client = require_client()
    page_size = 1000
    offset = 0
    ids: list[str] = []
    while True:
        rows = (
            client.table("student_attempts")
            .select("question_id")
            .eq("student_id", student_id)
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )
        for r in rows:
            qid = r.get("question_id")
            if qid:
                ids.append(qid)
        if len(rows) < page_size:
            break
        offset += page_size
    return ids


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


@lru_cache(maxsize=1)
def list_distinct_chapters() -> list[str]:
    return list(chapter_question_counts().keys())


def _chapter_counts_via_rpc() -> Optional[dict[str, int]]:
    """Single grouped query if the optional chapter_counts() RPC is applied."""
    try:
        res = require_client().rpc("chapter_counts", {}).execute()
        rows = res.data or []
        if not rows:
            return None
        counts: dict[str, int] = {}
        for r in rows:
            ch = (r.get("chapter") or "").strip()
            if ch:
                counts[ch] = int(r.get("n") or r.get("count") or 0)
        return counts or None
    except Exception:
        return None


@lru_cache(maxsize=1)
def chapter_question_counts() -> dict[str, int]:
    """How many MCQs exist per chapter name in the bank.

    Prefers a grouped chapter_counts() RPC (one round-trip). Without it, pages
    the ``chapter`` column concurrently — PostgREST caps at 1000 rows/request,
    so fetching pages in parallel keeps this well under a second instead of the
    ~9s a sequential loop took on the full bank.
    """
    rpc_counts = _chapter_counts_via_rpc()
    if rpc_counts is not None:
        return rpc_counts

    from concurrent.futures import ThreadPoolExecutor

    client = require_client()
    page_size = 1000

    # Total rows so we know how many pages to fetch in parallel.
    total = (
        client.table("questions").select("id", count="exact").limit(1).execute().count
        or 0
    )
    num_pages = max(1, (total + page_size - 1) // page_size)

    def fetch_page(page: int) -> list[dict[str, Any]]:
        start = page * page_size
        return (
            require_client()
            .table("questions")
            .select("chapter")
            .range(start, start + page_size - 1)
            .execute()
            .data
            or []
        )

    counts: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=min(num_pages, 10)) as pool:
        for rows in pool.map(fetch_page, range(num_pages)):
            for r in rows:
                ch = (r.get("chapter") or "").strip()
                if ch:
                    counts[ch] = counts.get(ch, 0) + 1
    return counts


# Aliases seen in ingested banks that should map onto the practice catalog.
CHAPTER_COUNT_ALIASES: dict[str, str] = {
    "Cell Biology": "Cell Structure and Function",
    "Cell Cycle": "Cell Structure and Function",
    "Biomolecules": "Biological Molecules",
    "Molecular Biology": "Biological Molecules",
    "Chromosome and DNA": "Inheritance",
    "Prokaryotes": "Cell Structure and Function",
    "Growth and Development": "Reproduction",
    "Genetics": "Inheritance",
    "Variation and Genetics": "Inheritance",
}


def catalog_question_counts() -> dict[str, int]:
    """Counts keyed by catalog chapter names (aliases folded in)."""
    raw = chapter_question_counts()
    out: dict[str, int] = {}
    for name, n in raw.items():
        key = CHAPTER_COUNT_ALIASES.get(name, name)
        out[key] = out.get(key, 0) + n
    return out


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


def get_questions_by_ids(
    question_ids: list[str], columns: str = "*"
) -> dict[str, dict[str, Any]]:
    """Batch-fetch questions by id in one round-trip. Returns {id: row}."""
    ids = [q for q in dict.fromkeys(question_ids) if q]
    if not ids:
        return {}
    client = require_client()
    out: dict[str, dict[str, Any]] = {}
    batch = 200  # keep the `in` filter URL within limits
    for i in range(0, len(ids), batch):
        chunk = ids[i : i + batch]
        rows = (
            client.table("questions")
            .select(columns)
            .in_("id", chunk)
            .execute()
            .data
            or []
        )
        for r in rows:
            out[r["id"]] = r
    return out


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


def search_chunks_text(
    terms: list[str],
    match_count: int = 5,
    book: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Keyword fallback when vector embeddings are unavailable (slim deploys)."""
    cleaned = [t.strip() for t in terms if t and len(t.strip()) >= 3]
    if not cleaned or not settings.supabase_ready:
        return []

    client = require_client()
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    # Prefer rarer/longer terms first (better precision than "what"/"from").
    ordered = sorted(cleaned, key=len, reverse=True)[:5]

    for term in ordered:
        try:
            q = (
                client.table("textbook_chunks")
                .select(
                    "id,content,chapter,concept,book,page_number,content_type"
                )
                .ilike("content", f"%{term}%")
                .limit(match_count)
            )
            if book:
                q = q.eq("book", book)
            rows = q.execute().data or []
        except Exception as exc:
            print(f"  [rag] keyword search failed: {type(exc).__name__}")
            continue
        for row in rows:
            rid = str(row.get("id") or "")
            if not rid or rid in seen:
                continue
            seen.add(rid)
            # Synthetic score so callers that filter on similarity keep the hit.
            row = dict(row)
            row["similarity"] = 0.42
            found.append(row)
            if len(found) >= match_count:
                return found
    return found
