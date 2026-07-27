"""MDCAT AI Tutor — FastAPI backend.

Orchestrates the STT -> RAG -> GPT-4o -> TTS pipeline and serves all the
question/attempt/weak-spot/plan endpoints documented in the project spec.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import APIConnectionError, APITimeoutError, RateLimitError
from pydantic import BaseModel

from . import db, llm, planner, rag, study, voice, weak_spots
from .config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Windows consoles (cp1252) crash on Urdu/Arabic print(); force UTF-8 where possible
    try:
        import sys

        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    # Optional: skip warmup when RAM is tight (loads on first RAG request)
    if os.getenv("SKIP_EMBED_WARMUP", "").lower() in {"1", "true", "yes"}:
        print("  [rag] skipping embedding warmup (SKIP_EMBED_WARMUP)")
    else:
        try:
            await asyncio.get_event_loop().run_in_executor(None, rag.warmup)
        except Exception as exc:
            print(f"  [rag] warmup skipped: {type(exc).__name__}: {exc}")
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
# Speech cache — lets clients stream audio instead of waiting for it inline
# ===========================================================================
_SPEECH_CACHE: "OrderedDict[str, str]" = OrderedDict()
_SPEECH_CACHE_MAX = 200


def cache_speech(text: str) -> Optional[str]:
    """Store narration and return a short id the client can stream from."""
    speak = voice.clean_for_tts(text)
    if not speak:
        return None
    key = uuid.uuid4().hex[:16]
    _SPEECH_CACHE[key] = speak
    while len(_SPEECH_CACHE) > _SPEECH_CACHE_MAX:
        _SPEECH_CACHE.popitem(last=False)
    return key


@app.get("/api/tts-stream/{speech_id}")
async def tts_stream(speech_id: str):
    """Stream the cached Urdu narration as MP3 so playback starts immediately."""
    text = _SPEECH_CACHE.get(speech_id)
    if not text:
        raise HTTPException(status_code=404, detail="speech expired")
    return StreamingResponse(
        voice.stream_tts(text),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


class TtsRequest(BaseModel):
    text: str


@app.post("/api/tts-stream")
async def tts_stream_direct(req: TtsRequest):
    """Stream synthesis for arbitrary text (used for replay)."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    return StreamingResponse(
        voice.stream_tts(req.text),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )


# ===========================================================================
# Ask AI — text + voice
# ===========================================================================
async def ensure_urdu(english_answer: str, urdu_text: str) -> str:
    """Fall back to a dedicated translation if the model drifted to Roman Urdu."""
    if llm.looks_like_urdu(urdu_text):
        return urdu_text
    if not english_answer.strip():
        return urdu_text
    print("  [speak] bilingual Urdu section not Urdu script; re-translating")
    try:
        return await asyncio.get_event_loop().run_in_executor(
            None, llm.to_urdu_speech, english_answer
        )
    except Exception as exc:
        print(f"  [speak] Urdu fallback failed: {type(exc).__name__}")
        return urdu_text


def narration_id(english_answer: str, urdu_text: str) -> Optional[str]:
    """Register narration for streaming instead of synthesising inline.

    Synthesis (~2-3s) then happens while the client is already playing, rather
    than blocking the JSON response.
    """
    speak_text = urdu_text or llm._strip_for_speech(english_answer)
    return cache_speech(speak_text)


# Repeat "explain this MCQ" requests are identical, so memoise the whole
# retrieve + generate pipeline.
_ANSWER_CACHE: "OrderedDict[str, tuple]" = OrderedDict()
_ANSWER_CACHE_MAX = 128


def friendly_error(exc: Exception) -> str:
    """Turn provider exceptions into something a student can act on."""
    if isinstance(exc, RateLimitError):
        return "The AI is busy right now (rate limit). Wait a few seconds and ask again."
    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        return "The AI took too long to respond. Please ask again."
    return f"Understood your question but the AI response failed ({type(exc).__name__})."


def _answer_key(*parts: str) -> str:
    joined = "\x1f".join(p or "" for p in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def _answer_cache_put(key: str, value: tuple) -> None:
    _ANSWER_CACHE[key] = value
    while len(_ANSWER_CACHE) > _ANSWER_CACHE_MAX:
        _ANSWER_CACHE.popitem(last=False)


class McqContext(BaseModel):
    question_text: str = ""
    options: Optional[list[dict]] = None
    selected_option: str = ""
    correct_option: str = ""
    explanation: str = ""

    def summary(self) -> str:
        """Readable block describing the MCQ the student is looking at."""
        if not self.question_text:
            return ""
        lines = [f"Question: {self.question_text}"]
        for opt in self.options or []:
            key = opt.get("key", "")
            text = opt.get("text", "")
            marks = []
            if key and key == self.correct_option:
                marks.append("correct")
            if key and key == self.selected_option:
                marks.append("student chose this")
            suffix = f"  <-- {', '.join(marks)}" if marks else ""
            lines.append(f"{key}) {text}{suffix}")
        if self.explanation:
            lines.append(f"Existing explanation: {self.explanation}")
        return "\n".join(lines)

    def retrieval_query(self) -> str:
        """Anchor RAG on the MCQ topic, not on vague follow-ups."""
        parts = [self.question_text]
        for opt in self.options or []:
            if opt.get("key") == self.correct_option:
                parts.append(str(opt.get("text", "")))
        return " ".join(p for p in parts if p).strip()


class AskRequest(BaseModel):
    concept: str
    student_question: str
    context_chunk: str = ""
    history: Optional[list[dict]] = None
    speak: bool = True
    # Client streams audio from /api/tts-stream/{speech_id} instead of waiting
    # for base64 audio inline. Set false only for clients that cannot stream.
    stream_audio: bool = True
    mcq: Optional[McqContext] = None


@app.post("/api/ask")
async def ask_ai(req: AskRequest):
    """Text question -> RAG -> LLM -> English answer + spoken Urdu audio."""
    mcq_block = req.mcq.summary() if req.mcq else ""
    cache_key = _answer_key(
        "ask",
        req.concept,
        req.student_question,
        mcq_block,
        req.context_chunk,
        "speak" if req.speak else "silent",
    )
    cached = _ANSWER_CACHE.get(cache_key) if not req.history else None
    if cached:
        answer_text, urdu_text, sources = cached
    else:
        try:
            answer_text, urdu_text, sources = await _generate_ask_answer(req, mcq_block)
        except Exception as exc:
            print(f"  [ask] generation failed: {type(exc).__name__}")
            return {
                "answer": "",
                "audio": None,
                "speech_id": None,
                "urdu_text": "",
                "transcript": "",
                "concept": req.concept,
                "sources": [],
                "error": friendly_error(exc),
            }
        if not answer_text.strip():
            print("  [ask] model returned an empty answer")
            return {
                "answer": "",
                "audio": None,
                "speech_id": None,
                "urdu_text": "",
                "transcript": "",
                "concept": req.concept,
                "sources": [],
                "error": "The AI returned an empty answer. Please ask again.",
            }
        if req.speak:
            urdu_text = await ensure_urdu(answer_text, urdu_text)
        if not req.history:
            _answer_cache_put(cache_key, (answer_text, urdu_text, sources))

    citation = rag.format_citation_short(sources)
    display_answer = f"{answer_text}\n\n({citation})" if citation else answer_text

    audio_b64 = None
    speech_id = None
    if req.speak:
        if req.stream_audio:
            speech_id = narration_id(answer_text, urdu_text)
        else:
            try:
                audio_b64 = await voice.text_to_speech(
                    urdu_text or llm._strip_for_speech(answer_text)
                )
            except Exception as exc:
                print(f"  [ask] TTS failed: {type(exc).__name__}")

    return {
        "answer": display_answer,
        "audio": audio_b64,
        "speech_id": speech_id,
        "urdu_text": urdu_text,
        "transcript": "",
        "concept": req.concept,
        "sources": sources,
    }


async def _generate_ask_answer(
    req: "AskRequest", mcq_block: str
) -> tuple[str, str, list[dict]]:
    """Retrieve context then generate the answer (plus Urdu when speaking)."""
    context = req.context_chunk
    sources: list[dict] = []

    # When the student is looking at an MCQ, retrieve on the MCQ topic so a
    # vague follow-up ("explain in detail") cannot drift to another chapter.
    mcq_query = req.mcq.retrieval_query() if req.mcq else ""
    search_query = (
        f"{mcq_query} {req.student_question}".strip()
        if mcq_query
        else req.student_question
    )

    loop = asyncio.get_event_loop()
    if not context:
        # Single unfiltered search: the concept filter matched nothing in practice
        # yet cost a full extra round-trip on every request.
        try:
            retrieved = await loop.run_in_executor(
                None, lambda: rag.retrieve_context(search_query, top_k=3)
            )
            context = retrieved["context"]
            sources = retrieved["sources"]
        except Exception as exc:
            print(f"  [ask] RAG failed: {type(exc).__name__}: {exc}")

    urdu_text = ""
    if req.speak:
        # One call for both languages instead of answer-then-translate.
        answer_text, urdu_text = await loop.run_in_executor(
            None,
            lambda: llm.answer_question_bilingual(
                concept=req.concept,
                student_question=req.student_question,
                context_chunk=context or "",
                history=req.history,
                mcq_block=mcq_block,
            ),
        )
    else:
        answer_text = await loop.run_in_executor(
            None,
            lambda: llm.answer_question(
                concept=req.concept,
                student_question=req.student_question,
                context_chunk=context or "",
                history=req.history,
                mcq_block=mcq_block,
            ),
        )
    return answer_text, urdu_text, sources


@app.post("/api/ask-voice")
async def ask_voice(
    audio: UploadFile = File(...),
    concept: str = Form(...),
    context_chunk: str = Form(default=""),
    mcq: str = Form(default=""),
):
    """Audio -> STT -> RAG (anchored on the MCQ) -> English answer + Urdu audio."""
    audio_bytes = await audio.read()
    if not audio_bytes or len(audio_bytes) < 500:
        return {
            "error": "No usable audio received. Speak for at least 1–2 seconds.",
            "transcript": "",
            "answer": "",
            "audio": None,
        }

    transcript = await voice.speech_to_text(
        audio_bytes, filename=audio.filename or "audio.webm"
    )
    if not transcript or not _is_meaningful_question(transcript):
        return {
            "transcript": transcript or "",
            "answer": "",
            "audio": None,
            "no_speech": True,
        }

    mcq_ctx: Optional[McqContext] = None
    if mcq:
        try:
            mcq_ctx = McqContext(**json.loads(mcq))
        except Exception:
            mcq_ctx = None

    try:
        result = await ask_ai(
            AskRequest(
                concept=concept,
                student_question=transcript,
                context_chunk=context_chunk,
                mcq=mcq_ctx,
            )
        )
        result["transcript"] = transcript
        return result
    except Exception as exc:
        print(f"  [ask-voice] LLM/RAG failed after STT: {type(exc).__name__}")
        return {
            "error": friendly_error(exc),
            "transcript": transcript,
            "answer": "",
            "audio": None,
        }


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


def _is_meaningful_question(text: str) -> bool:
    """Reject silence / STT garbage like '.', '...', single letters."""
    cleaned = (text or "").strip()
    if not cleaned:
        return False
    # Keep letters from Latin + Arabic/Urdu scripts
    letters = re.sub(r"[^\w\u0600-\u06FF]", "", cleaned, flags=re.UNICODE)
    letters = letters.replace("_", "")
    if len(letters) < 3:
        return False
    # Common empty / filler transcripts
    if cleaned.lower() in {".", "..", "...", "?", "؟", "umm", "uh", "ah", "hmm"}:
        return False
    return True


@app.post("/api/rag/ask-voice")
async def rag_ask_voice(
    audio: UploadFile = File(...),
    book: Optional[str] = Form(default=None),
    top_k: int = Form(default=5),
):
    """Audio -> STT -> textbook RAG search -> English answer + TTS audio."""
    audio_bytes = await audio.read()
    filename = audio.filename or "audio.webm"
    if not audio_bytes or len(audio_bytes) < 500:
        return {
            "error": "No usable audio received. Hold the mic and speak for at least 1–2 seconds.",
            "transcript": "",
            "answer": "",
            "audio": None,
            "sources": [],
            "citation": None,
        }

    try:
        transcript = await voice.speech_to_text(audio_bytes, filename=filename)
    except Exception as exc:
        print(f"  [rag-ask-voice] STT crashed: {type(exc).__name__}")
        return {
            "error": "Voice transcription failed. Please try again or use text input.",
            "transcript": "",
            "answer": "",
            "audio": None,
            "sources": [],
            "citation": None,
        }

    if not transcript or not _is_meaningful_question(transcript):
        return {
            "transcript": transcript or "",
            "answer": "I didn't catch a clear question. Please speak again for 1–2 seconds, or type your question.",
            "audio": None,
            "urdu_text": "",
            "sources": [],
            "citation": None,
            "no_speech": True,
            "error": None,
        }

    try:
        loop = asyncio.get_event_loop()
        book_filter = book if book and book not in ("undefined", "null", "") else None
        retrieved = await loop.run_in_executor(
            None,
            lambda: rag.retrieve_context(
                transcript.strip(),
                top_k=max(1, min(int(top_k or 5), 10)),
                book=book_filter,
            ),
        )
        context = retrieved["context"]
        sources = retrieved["sources"]
        citation = rag.format_citation(sources) if context else None

        # One LLM call yields English text and the Urdu narration together.
        answer_text, urdu_text = await loop.run_in_executor(
            None, lambda: llm.answer_from_rag_bilingual(transcript.strip(), context)
        )
        if not answer_text.strip():
            print("  [rag-ask-voice] model returned an empty answer")
            return {
                "transcript": transcript,
                "answer": "",
                "audio": None,
                "speech_id": None,
                "urdu_text": "",
                "sources": [],
                "citation": None,
                "error": "The AI returned an empty answer. Please ask again.",
            }
        urdu_text = await ensure_urdu(answer_text, urdu_text)

        display_answer = answer_text
        if citation and citation not in display_answer:
            display_answer = f"{answer_text}\n\n({citation})"

        # Narration streams from /api/tts-stream/{id} so synthesis overlaps playback
        speech_id = narration_id(answer_text, urdu_text)

        return {
            "transcript": transcript,
            "answer": display_answer,
            "audio": None,
            "speech_id": speech_id,
            "urdu_text": urdu_text,
            "sources": sources if context else [],
            "citation": citation,
        }
    except Exception as exc:
        print(f"  [rag-ask-voice] RAG/LLM failed after STT: {type(exc).__name__}")
        return {
            "error": friendly_error(exc),
            "transcript": transcript,
            "answer": "",
            "audio": None,
            "sources": [],
            "citation": None,
        }


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
    question = None
    try:
        question = db.get_question(req.question_id)
    except Exception:
        pass
    question_text = (question or {}).get("question_text") or ""
    q_chapter = (question or {}).get("chapter") or req.concept

    context = req.context_chunk
    sources: list[dict] = []
    citation = None

    try:
        search_q = f"{question_text} {req.correct_option}".strip() or req.concept
        retrieved = rag.retrieve_context(search_q, top_k=3)
        context = context or retrieved.get("context") or ""
        sources = retrieved.get("sources") or []
        citation = rag.format_citation_short(sources)
    except Exception as exc:
        print(f"  [explain] RAG retrieval failed: {type(exc).__name__}: {exc}")

    mnemonic_ctx = ""
    try:
        search_q = f"{question_text} {req.correct_option}".strip() or req.concept
        mnemonic = rag.retrieve_mnemonics(search_q, top_k=1)
        mnemonic_ctx = mnemonic.get("context") or ""
    except Exception:
        pass

    explanation = llm.explain_answer(
        concept=q_chapter,
        selected_option=req.selected_option,
        correct_option=req.correct_option,
        question_text=question_text,
        context_chunk=context or "",
        mnemonic_chunk=mnemonic_ctx,
    )

    # Build citation from question source metadata as fallback
    if not citation and question:
        q_book = (question or {}).get("book") or ""
        q_page = (question or {}).get("page_number")
        q_source = (question or {}).get("source") or ""
        if q_book and q_page:
            from .textbook_rag.chunk import book_display_name
            citation = f"{book_display_name(q_book)}, p. {q_page}"
        elif q_source and q_page:
            citation = f"{q_source}, p. {q_page}"

    audio_b64 = None
    try:
        audio_b64 = await voice.text_to_speech(explanation)
    except Exception:
        pass

    return {
        "explanation": explanation,
        "answer": explanation,
        "audio": audio_b64,
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
