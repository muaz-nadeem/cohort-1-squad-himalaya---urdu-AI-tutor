"""MDCAT AI Tutor — FastAPI backend.

Orchestrates the STT -> RAG -> GPT-4o -> TTS pipeline and serves all the
question/attempt/weak-spot/plan endpoints documented in the project spec.
"""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import db, llm, planner, rag, study, voice, weak_spots
from .config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-warm the embedding model on startup so first request is fast
    await asyncio.get_event_loop().run_in_executor(None, rag.warmup)
    yield


app = FastAPI(title="MDCAT AI Tutor API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===========================================================================
# Ask AI — text + voice
# ===========================================================================
class AskRequest(BaseModel):
    concept: str
    student_question: str
    context_chunk: str = ""
    history: Optional[list[dict]] = None


@app.post("/api/ask")
async def ask_ai(req: AskRequest):
    """Text question -> RAG -> GPT-4o -> answer text + Urdu audio."""
    context = req.context_chunk
    sources: list[dict] = []
    if not context:
        retrieved = rag.retrieve_context(req.student_question, concept=req.concept)
        context = retrieved["context"]
        sources = retrieved["sources"]
        # Chapter labels from MCQs often don't match textbook concept tags —
        # fall back to open retrieval so Ask AI still uses FSc passages.
        if not context:
            retrieved = rag.retrieve_context(req.student_question, top_k=6)
            context = retrieved["context"]
            sources = retrieved["sources"]

    answer_text = llm.answer_question(
        concept=req.concept,
        student_question=req.student_question,
        context_chunk=context,
        history=req.history,
    )
    citation = rag.format_citation_short(sources)
    if citation:
        answer_text = f"{answer_text}\n\n({citation})"

    # Skip TTS for speed — text answer is enough in-session
    return {
        "answer": answer_text,
        "audio": None,
        "transcript": "",
        "concept": req.concept,
        "sources": sources,
    }


@app.post("/api/ask-voice")
async def ask_voice(
    audio: UploadFile = File(...),
    concept: str = Form(...),
    context_chunk: str = Form(default=""),
):
    """Audio -> Uplift STT -> RAG -> GPT-4o -> TTS -> transcript + answer + audio."""
    audio_bytes = await audio.read()
    transcript = await voice.speech_to_text(
        audio_bytes, filename=audio.filename or "audio.webm"
    )
    if not transcript:
        return {"error": "Could not understand audio", "transcript": ""}

    result = await ask_ai(
        AskRequest(
            concept=concept,
            student_question=transcript,
            context_chunk=context_chunk,
        )
    )
    result["transcript"] = transcript
    return result


# ===========================================================================
# Multimodal textbook RAG ask (printed page citations)
# ===========================================================================
class RagAskRequest(BaseModel):
    question: str
    book: Optional[str] = None  # fsc_bio_part1 | fsc_bio_part2 | null = both
    top_k: int = 5


@app.post("/api/rag/ask")
async def rag_ask(req: RagAskRequest):
    """Question -> vector search over FSc Biology chunks -> grounded answer + pages."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    retrieved = rag.retrieve_context(
        req.question.strip(),
        top_k=max(1, min(req.top_k, 10)),
        book=req.book,
    )
    context = retrieved["context"]
    sources = retrieved["sources"]

    if not context:
        return {
            "answer": (
                "No textbook passages were retrieved. "
                "Ingest FSc Biology PDFs with: python -m scripts.build_biology_rag"
            ),
            "sources": [],
            "citation": None,
        }

    answer_text = llm.answer_from_rag(req.question.strip(), context)
    citation = rag.format_citation(sources)
    if citation and citation not in answer_text:
        answer_text = f"{answer_text}\n\n({citation})"

    return {
        "answer": answer_text,
        "sources": sources,
        "citation": citation,
    }


@app.post("/api/rag/ask-stream")
async def rag_ask_stream(req: RagAskRequest):
    """Streaming version: sends sources first, then LLM tokens as SSE."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    retrieved = rag.retrieve_context(
        req.question.strip(),
        top_k=max(1, min(req.top_k, 10)),
        book=req.book,
    )
    context = retrieved["context"]
    sources = retrieved["sources"]
    citation = rag.format_citation(sources)

    if not context:
        async def empty_stream():
            yield f"data: {json.dumps({'type': 'sources', 'sources': [], 'citation': None})}\n\n"
            yield f"data: {json.dumps({'type': 'text', 'content': 'No textbook passages were retrieved.'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(empty_stream(), media_type="text/event-stream")

    async def generate():
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources, 'citation': citation})}\n\n"
        for token in llm.stream_answer_from_rag(req.question.strip(), context):
            yield f"data: {json.dumps({'type': 'text', 'content': token})}\n\n"
        if citation:
            yield f"data: {json.dumps({'type': 'text', 'content': f'  ({citation})'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ===========================================================================
# Explain a wrong/right answer
# ===========================================================================
class ExplainRequest(BaseModel):
    question_id: str
    concept: str
    selected_option: str
    correct_option: str
    context_chunk: str = ""


@app.post("/api/explain")
async def explain(req: ExplainRequest):
    """MCQ explanation — teach the question; cite textbook book + page only."""
    question = db.get_question(req.question_id)
    question_text = (question or {}).get("question_text") or ""
    q_chapter = (question or {}).get("chapter") or req.concept

    search_q = f"{question_text} {req.correct_option}".strip() or req.concept
    retrieved = rag.retrieve_context(search_q, top_k=3)
    context = req.context_chunk or retrieved.get("context") or ""
    sources = retrieved.get("sources") or []

    # One mnemonic lookup max — skip if empty to save time on cold path
    mnemonic_ctx = ""
    try:
        mnemonic = rag.retrieve_mnemonics(search_q or req.concept, top_k=1)
        mnemonic_ctx = mnemonic.get("context") or ""
    except Exception:
        pass

    explanation = llm.explain_answer(
        concept=q_chapter,
        selected_option=req.selected_option,
        correct_option=req.correct_option,
        question_text=question_text,
        context_chunk=context,
        mnemonic_chunk=mnemonic_ctx,
    )

    # Only book + page (never academy PDF / MCQ source filename)
    citation = rag.format_citation_short(sources)

    # Skip TTS here — it was the main delay; students read text first
    return {
        "explanation": explanation,
        "answer": explanation,
        "audio": None,
        "concept": q_chapter,
        "citation": citation,
        "sources": sources,
        "mnemonics": [],
    }


# ===========================================================================
# Students / onboarding
# ===========================================================================
class StudentCreate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    level: str
    daily_time: str
    exam: str = "MDCAT 2026"
    subject: str = "Biology"


@app.get("/api/login")
async def login(email: str):
    """Simple email-based login — find existing student by email."""
    student = db.find_student_by_email(email)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@app.post("/api/students")
async def create_student(req: StudentCreate):
    return db.create_student(req.model_dump(exclude_none=True))


@app.get("/api/students/{student_id}")
async def get_student(student_id: str):
    student = db.get_student(student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


# ===========================================================================
# Concepts + chapters
# ===========================================================================
@app.get("/api/concepts")
async def list_concepts():
    return db.list_concepts()


@app.get("/api/chapters")
async def list_chapters():
    """Catalog + which chapters already have MCQs in the mixed bank."""
    return study.available_chapters()


# ===========================================================================
# Questions — diagnostic / chapter / custom / platform FLP
# ===========================================================================
@app.get("/api/questions")
async def get_questions(
    student_id: str,
    chapter: Optional[str] = None,
    concept_id: Optional[str] = None,
):
    """Next questions for a student based on mode + weak-spot profile."""
    return study.next_questions_for_student(
        student_id, chapter=chapter, concept_id=concept_id
    )


@app.get("/api/questions/diagnostic")
async def questions_diagnostic(student_id: str, count: int = 25):
    qs = study.build_diagnostic(count=max(10, min(count, 40)))
    return {
        "mode": "diagnostic",
        "student_id": student_id,
        "questions": qs,
        "timed_seconds": None,
    }


@app.get("/api/questions/chapter")
async def questions_chapter(chapter: str, count: int = 100):
    """Chapter practice: mix from ALL sources (tests, FLPs, past papers, repeated)."""
    n = max(1, min(count, 100))
    qs = study.build_chapter_practice(chapter, count=n)
    return {
        "mode": "chapter_practice",
        "chapter": chapter,
        "questions": qs,
        "timed_seconds": None,
    }


class CustomQuizRequest(BaseModel):
    selections: list[dict]  # [{ chapter, book?, count }]


@app.post("/api/questions/custom")
async def questions_custom(req: CustomQuizRequest):
    qs = study.build_custom(req.selections)
    return {
        "mode": "custom",
        "questions": qs,
        "selections": req.selections,
        "timed_seconds": None,
    }


@app.get("/api/questions/full-length")
async def questions_full_length(mode: str = "practice"):
    """Our own Biology FLP: 81 MCQs mixed from the entire bank — not one FLP PDF."""
    if mode not in ("practice", "timed"):
        raise HTTPException(status_code=400, detail="mode must be practice or timed")
    qs = study.build_platform_flp()
    session_mode = (
        "full_length_timed" if mode == "timed" else "full_length_practice"
    )
    return {
        "mode": session_mode,
        "questions": qs,
        "timed_seconds": study.FULL_LENGTH_TIMED_SEC if mode == "timed" else None,
        "note": "Platform FLP — mixed from academy tests, FLPs, past papers & most-repeated",
    }


# ===========================================================================
# Sessions
# ===========================================================================
class SessionStart(BaseModel):
    student_id: str
    mode: str
    concept_id: Optional[str] = None
    chapter: Optional[str] = None


@app.post("/api/sessions")
async def start_session(req: SessionStart):
    return db.create_session(req.model_dump(exclude_none=True))


class SessionEnd(BaseModel):
    score: Optional[int] = None
    total: Optional[int] = None


@app.post("/api/sessions/{session_id}/end")
async def finish_session(session_id: str, req: SessionEnd):
    import datetime as dt

    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    db.end_session(
        session_id,
        {
            "ended_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            **req.model_dump(exclude_none=True),
        },
    )
    weak_spots.recompute_for_session(session["student_id"], session_id)

    if session.get("mode") == "diagnostic":
        db.update_student(session["student_id"], {"diagnostic_done": True})

    # Refresh daily plan after every completed session
    try:
        planner.generate_daily_plan(session["student_id"])
    except Exception:
        pass

    return study.session_summary(session["student_id"], session_id)


@app.get("/api/session-summary")
async def session_summary(student_id: str, session_id: str):
    return study.session_summary(student_id, session_id)


# ===========================================================================
# Attempts
# ===========================================================================
class AttemptCreate(BaseModel):
    student_id: str
    question_id: str
    selected_option: str
    session_id: Optional[str] = None


@app.post("/api/attempt")
async def log_attempt(req: AttemptCreate):
    question = db.get_question(req.question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    is_correct = req.selected_option == question["correct_option"]
    attempt = db.log_attempt(
        {
            "student_id": req.student_id,
            "question_id": req.question_id,
            "concept_id": question.get("concept_id"),
            "session_id": req.session_id,
            "selected_option": req.selected_option,
            "is_correct": is_correct,
        }
    )
    if question.get("concept_id"):
        weak_spots.recompute_for_concept(req.student_id, question["concept_id"])

    return {
        "is_correct": is_correct,
        "correct_option": question["correct_option"],
        "attempt": attempt,
    }


# ===========================================================================
# Weak spots + dashboard + plans
# ===========================================================================
@app.get("/api/weak-spots")
async def get_weak_spots(student_id: str):
    return weak_spots.ranked_report(student_id)


@app.get("/api/dashboard")
async def dashboard(student_id: str):
    student = db.get_student(student_id)
    attempts = db.get_attempts(student_id)
    total = len(attempts)
    correct = sum(1 for a in attempts if a.get("is_correct"))

    concepts = {c["id"]: c for c in db.list_concepts()}
    chapters: dict[str, dict] = {}
    for a in attempts:
        concept = concepts.get(a.get("concept_id"))
        chapter = None
        if concept:
            chapter = concept.get("chapter", "Unknown")
        else:
            q = db.get_question(a["question_id"]) if a.get("question_id") else None
            chapter = (q or {}).get("chapter") or "Unknown"
        bucket = chapters.setdefault(
            chapter, {"chapter": chapter, "attempted": 0, "correct": 0}
        )
        bucket["attempted"] += 1
        if a.get("is_correct"):
            bucket["correct"] += 1
    for b in chapters.values():
        b["accuracy_pct"] = round(b["correct"] / b["attempted"] * 100, 1)

    import datetime as dt

    days = sorted({a["created_at"][:10] for a in attempts if a.get("created_at")}, reverse=True)
    streak = 0
    cursor = dt.date.today()
    day_set = set(days)
    while cursor.isoformat() in day_set:
        streak += 1
        cursor -= dt.timedelta(days=1)

    daily = None
    try:
        daily = planner.get_or_create_daily_plan(student_id)
    except Exception:
        pass

    return {
        "accuracy_pct": round(correct / total * 100, 1) if total else 0,
        "total_attempted": total,
        "streak": streak,
        "chapters": list(chapters.values()),
        "focus": weak_spots.recommended_focus(student_id),
        "diagnostic_done": bool(student and student.get("diagnostic_done")),
        "daily_plan": daily,
    }


@app.get("/api/weekly-plan")
async def get_weekly_plan(student_id: str):
    plan = db.get_latest_weekly_plan(student_id)
    if not plan:
        plan = planner.generate_plan(student_id)
    return plan


@app.post("/api/weekly-plan/generate")
async def make_weekly_plan(student_id: str):
    return planner.generate_plan(student_id)


@app.get("/api/daily-plan")
async def get_daily_plan(student_id: str):
    return planner.get_or_create_daily_plan(student_id)


@app.post("/api/daily-plan/generate")
async def make_daily_plan(student_id: str):
    return planner.generate_daily_plan(student_id)


# ===========================================================================
# Health
# ===========================================================================
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "groq": settings.groq_ready,
        "uplift": settings.uplift_ready,
        "supabase": settings.supabase_ready,
    }
