"""Supabase client + thin data-access helpers.

Everything that touches Postgres/pgvector goes through here so the rest of the
codebase never imports the supabase SDK directly.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Optional

from supabase import Client, create_client

from .config import settings
from .mcq_quality import EXCLUDED_CHAPTER, is_excluded_chapter, is_non_biology


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
    rows = q.limit(limit).execute().data or []
    return [r for r in rows if not is_non_biology(r)]


def _list_question_ids(
    *,
    chapter: Optional[str] = None,
    book: Optional[str] = None,
    max_ids: int = 20_000,
) -> list[str]:
    """Fetch only question ids (tiny payload) for in-process sampling."""
    client = require_client()
    page_size = 1000
    ids: list[str] = []
    offset = 0
    while len(ids) < max_ids:
        q = client.table("questions").select("id").neq("chapter", EXCLUDED_CHAPTER)
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
    return [by_id[i] for i in ids if i in by_id and not is_non_biology(by_id[i])]


def sample_questions(
    *,
    count: int = 25,
    chapter: Optional[str] = None,
    book: Optional[str] = None,
    exclude_ids: Optional[list[str]] = None,
    reuse_seen: bool = True,
) -> list[dict[str, Any]]:
    """Random sample across the mixed bank (all source_types).

    When ``exclude_ids`` is provided (questions the student has already seen),
    unseen questions are returned first so a re-attempt of the same chapter
    yields fresh MCQs. If the unseen pool is smaller than ``count`` and
    ``reuse_seen`` is true (chapter exhausted), the remainder is topped up
    with a reshuffled set of seen ones.

    Fallback path is id-first (tiny) then hydrate only the chosen rows — keeps
    free-tier RAM under control even for count=100.
    """
    import random

    exclude = {str(x) for x in (exclude_ids or []) if x}
    count = max(1, count)

    def _from_rpc(extra_exclude: Optional[set[str]]) -> Optional[list[dict[str, Any]]]:
        try:
            payload: dict[str, Any] = {
                "match_count": count,
                "filter_chapter": chapter,
                "filter_book": book,
            }
            if extra_exclude:
                payload["exclude_ids"] = list(extra_exclude)
            res = require_client().rpc("sample_questions", payload).execute()
            if not res.data:
                return None
            ids = [str(r["id"]) for r in res.data if r.get("id")]
            if extra_exclude and not reuse_seen:
                ids = [i for i in ids if i not in extra_exclude]
            return _hydrate_questions(ids) or res.data
        except Exception:
            return None

    if not exclude:
        picked = _from_rpc(None)
        if picked:
            return _top_up_biology(picked, count, chapter=chapter, book=book)
        ids = _list_question_ids(chapter=chapter, book=book)
        random.shuffle(ids)
        return _top_up_biology(
            _hydrate_questions(ids[: count + 12]),
            count,
            chapter=chapter,
            book=book,
        )

    picked = _from_rpc(exclude)
    if picked:
        return _top_up_biology(
            picked, count, chapter=chapter, book=book, exclude=exclude
        )

    ids = _list_question_ids(chapter=chapter, book=book)
    unseen = [i for i in ids if i not in exclude]
    random.shuffle(unseen)
    if reuse_seen:
        seen = [i for i in ids if i in exclude]
        random.shuffle(seen)
        picked_ids = (unseen + seen)[: count + 12]
    else:
        picked_ids = unseen[: count + 12]
    return _top_up_biology(
        _hydrate_questions(picked_ids),
        count,
        chapter=chapter,
        book=book,
        exclude=exclude,
    )


def questions_in_order(question_ids: list[str]) -> list[dict[str, Any]]:
    """Hydrate questions in the given order (for resuming a saved batch)."""
    return _hydrate_questions([str(i) for i in question_ids if i])


def sample_question_ids(
    *,
    count: int = 25,
    chapter: Optional[str] = None,
    book: Optional[str] = None,
    exclude_ids: Optional[list[str]] = None,
    reuse_seen: bool = True,
) -> list[str]:
    """Pick question ids only — no row hydrate. Used so chapter practice can
    open after the first few MCQs and load the rest in the background.
    """
    import random

    exclude = {str(x) for x in (exclude_ids or []) if x}
    count = max(1, count)
    ids = _list_question_ids(chapter=chapter, book=book)
    if not ids:
        return []
    if not exclude:
        random.shuffle(ids)
        pool = ids
    else:
        unseen = [i for i in ids if i not in exclude]
        random.shuffle(unseen)
        if not reuse_seen:
            pool = unseen
        else:
            seen = [i for i in ids if i in exclude]
            random.shuffle(seen)
            pool = unseen + seen
    # Hydrate a slightly larger slice so Physics rows can be dropped
    # without shrinking the batch the student sees.
    hydrated = _hydrate_questions(pool[: max(count + 20, count)])
    kept = [r["id"] for r in hydrated]
    if len(kept) >= count:
        return kept[:count]
    extra = [i for i in pool if i not in set(kept)]
    more = _hydrate_questions(extra[:80])
    kept.extend(r["id"] for r in more)
    return kept[:count]


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


def _top_up_biology(
    picked: list[dict[str, Any]],
    count: int,
    *,
    chapter: Optional[str] = None,
    book: Optional[str] = None,
    exclude: Optional[set[str]] = None,
) -> list[dict[str, Any]]:
    """Drop Physics / quarantined rows, then fill until ``count``."""
    kept = [r for r in picked if not is_non_biology(r)]
    if len(kept) >= count:
        return kept[:count]
    seen = {str(r.get("id")) for r in kept}
    if exclude:
        seen |= exclude
    ids = [i for i in _list_question_ids(chapter=chapter, book=book) if i not in seen]
    import random

    random.shuffle(ids)
    extra = _hydrate_questions(ids[: max(40, count - len(kept) + 12)])
    for row in extra:
        if is_non_biology(row):
            continue
        kept.append(row)
        if len(kept) >= count:
            break
    return kept[:count]


def insert_questions(rows: list[dict[str, Any]]) -> int:
    rows = [r for r in rows if not is_non_biology(r)]
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


@lru_cache(maxsize=1)
def chapter_question_counts() -> dict[str, int]:
    """Biology-only MCQ counts per chapter name.

    The grouped chapter_counts() RPC counts every row, including leftover
    Physics. Practice already drops those via is_non_biology, so the cards
    must use the same filter or the "MCQs in bank" numbers stay inflated.
    """
    import time
    from concurrent.futures import ThreadPoolExecutor

    client = require_client()
    page_size = 1000
    fields = "id,chapter,question_text,options,explanation,source"

    total = (
        client.table("questions").select("id", count="exact").limit(1).execute().count
        or 0
    )
    num_pages = max(1, (total + page_size - 1) // page_size)

    def fetch_page(page: int) -> list[dict[str, Any]]:
        start = page * page_size
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                return (
                    require_client()
                    .table("questions")
                    .select(fields)
                    .range(start, start + page_size - 1)
                    .execute()
                    .data
                    or []
                )
            except Exception as exc:
                last_exc = exc
                time.sleep(0.4 * (attempt + 1))
        assert last_exc is not None
        raise last_exc

    counts: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=min(num_pages, 4)) as pool:
        for rows in pool.map(fetch_page, range(num_pages)):
            for r in rows:
                if is_non_biology(r):
                    continue
                ch = (r.get("chapter") or "").strip()
                if ch and not is_excluded_chapter(ch):
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
        if is_excluded_chapter(name):
            continue
        key = CHAPTER_COUNT_ALIASES.get(name, name)
        out[key] = out.get(key, 0) + n
    return out


def update_correct_option(question_id: str, correct_option: str) -> None:
    key = (correct_option or "").strip().upper()[:1]
    if not question_id or key not in {"A", "B", "C", "D"}:
        return
    require_client().table("questions").update({"correct_option": key}).eq(
        "id", question_id
    ).execute()


def quarantine_questions(question_ids: list[str]) -> int:
    ids = [i for i in dict.fromkeys(question_ids) if i]
    if not ids:
        return 0
    client = require_client()
    updated = 0
    for i in range(0, len(ids), 200):
        chunk = ids[i : i + 200]
        res = (
            client.table("questions")
            .update({"chapter": EXCLUDED_CHAPTER})
            .in_("id", chunk)
            .execute()
        )
        wrote = len(res.data or [])
        if wrote == 0:
            raise RuntimeError(
                "Could not quarantine questions — Supabase returned no updated "
                "rows. The anon key cannot UPDATE the bank; set "
                "SUPABASE_SERVICE_ROLE_KEY."
            )
        updated += wrote
    chapter_question_counts.cache_clear()
    list_distinct_chapters.cache_clear()
    return updated


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


# ── Ask Textbook chat history ───────────────────────────────────────────────
def list_textbook_chats(student_id: str, limit: int = 40) -> list[dict[str, Any]]:
    res = (
        require_client()
        .table("textbook_chats")
        .select("id,title,book_filter,created_at,updated_at")
        .eq("student_id", student_id)
        .order("updated_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def create_textbook_chat(
    student_id: str,
    title: str = "New chat",
    book_filter: Optional[str] = None,
) -> dict[str, Any]:
    payload = {
        "student_id": student_id,
        "title": (title or "New chat")[:120],
        "book_filter": book_filter,
    }
    res = require_client().table("textbook_chats").insert(payload).execute()
    return (res.data or [payload])[0]


def get_textbook_chat(chat_id: str, student_id: str) -> Optional[dict[str, Any]]:
    res = (
        require_client()
        .table("textbook_chats")
        .select("id,student_id,title,book_filter,created_at,updated_at")
        .eq("id", chat_id)
        .eq("student_id", student_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def update_textbook_chat(
    chat_id: str,
    student_id: str,
    *,
    title: Optional[str] = None,
    book_filter: Optional[str] = None,
    touch: bool = True,
) -> Optional[dict[str, Any]]:
    patch: dict[str, Any] = {}
    if title is not None:
        patch["title"] = title[:120]
    if book_filter is not None:
        patch["book_filter"] = book_filter or None
    if touch:
        from datetime import datetime, timezone

        patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    if not patch:
        return get_textbook_chat(chat_id, student_id)
    res = (
        require_client()
        .table("textbook_chats")
        .update(patch)
        .eq("id", chat_id)
        .eq("student_id", student_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else get_textbook_chat(chat_id, student_id)


def delete_textbook_chat(chat_id: str, student_id: str) -> bool:
    require_client().table("textbook_chats").delete().eq("id", chat_id).eq(
        "student_id", student_id
    ).execute()
    return True


def list_textbook_chat_messages(chat_id: str) -> list[dict[str, Any]]:
    res = (
        require_client()
        .table("textbook_chat_messages")
        .select("id,role,content,sources,citation,created_at")
        .eq("chat_id", chat_id)
        .order("created_at")
        .execute()
    )
    return res.data or []


def append_textbook_chat_messages(
    chat_id: str, messages: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    if not messages:
        return []
    rows = []
    for m in messages:
        rows.append(
            {
                "chat_id": chat_id,
                "role": m["role"],
                "content": m["content"],
                "sources": m.get("sources") or [],
                "citation": m.get("citation"),
            }
        )
    res = require_client().table("textbook_chat_messages").insert(rows).execute()
    return res.data or rows
