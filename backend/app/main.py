"""MDCAT AI Tutor — FastAPI backend.

Orchestrates the STT -> RAG -> GPT-4o -> TTS pipeline and serves all the
question/attempt/weak-spot/plan endpoints documented in the project spec.
"""
# NOTE: do not enable `from __future__ import annotations` here — it makes
# FastAPI treat Pydantic body models / Depends as query params (422 on req/user).

import asyncio
import hashlib
import json
import os
import re
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from typing import Annotated, Optional

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse
from openai import APIConnectionError, APITimeoutError, RateLimitError
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from . import auth, db, llm, planner, rag, study, voice, weak_spots
from .auth import AuthUser, assert_same_student, get_current_user, public_question_set
from .config import settings


def _rate_limit_key(request: Request) -> str:
    """Prefer authenticated user id; fall back to client IP."""
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        token = header.split(" ", 1)[1].strip()
        try:
            return f"user:{auth._decode_access_token(token).user_id}"
        except Exception:
            pass
    return get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key, default_limits=[])


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

    print(
        f"  [boot] environment={settings.ENVIRONMENT} "
        f"cors={settings.cors_allow_origins}"
    )
    if settings.is_production and not settings.supabase_ready:
        print("  [boot] WARNING: SUPABASE_URL/SERVICE_ROLE_KEY missing in production")
    if settings.is_production and not settings.auth_ready:
        print("  [boot] WARNING: SUPABASE_JWT_SECRET missing — API auth will fail")
    if settings.is_production and not settings.groq_ready:
        print("  [boot] WARNING: GROQ_API_KEY missing in production")

    # Optional: skip warmup when RAM is tight (loads on first RAG request)
    if os.getenv("SKIP_EMBED_WARMUP", "").lower() in {"1", "true", "yes"}:
        print("  [rag] skipping embedding warmup (SKIP_EMBED_WARMUP)")
    else:
        try:
            await asyncio.get_event_loop().run_in_executor(None, rag.warmup)
        except Exception as exc:
            print(f"  [rag] warmup skipped: {type(exc).__name__}: {exc}")

    # Prime the per-chapter MCQ counts so the first /api/chapters request is
    # instant instead of paying the one-time full-bank scan.
    async def _warm_chapter_counts():
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, db.chapter_question_counts
            )
            print("  [chapters] chapter counts warmed up")
        except Exception as exc:
            print(f"  [chapters] count warmup skipped: {type(exc).__name__}: {exc}")

    asyncio.create_task(_warm_chapter_counts())
    yield


app = FastAPI(title="MDCAT AI Tutor API", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins or ["http://localhost:3000"],
    allow_credentials=settings.cors_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.TRUSTED_HOSTS:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=settings.TRUSTED_HOSTS,
    )


def _reject_oversized_audio(audio_bytes: bytes) -> Optional[str]:
    """Return an error message if the mic clip exceeds the configured limit."""
    limit = settings.max_audio_bytes
    if len(audio_bytes) > limit:
        mb = settings.MAX_AUDIO_UPLOAD_MB
        return (
            f"Audio is too large (max {mb:g} MB). "
            "Record a shorter question and try again."
        )
    return None


# ===========================================================================
# Auth — credential checks go through this API (not the browser → Supabase)
# ===========================================================================
class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
@limiter.limit("10/minute")
async def login(request: Request, req: Annotated[LoginRequest, Body()]):
    """Validate credentials on the backend so login fails if this API is down."""
    return await auth.login_with_password(req.email, req.password)


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
@limiter.limit("60/minute")
async def tts_stream(
    request: Request,
    speech_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
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
@limiter.limit("30/minute")
async def tts_stream_direct(
    request: Request,
    req: Annotated[TtsRequest, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
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
    """Guarantee classroom-bilingual Urdu for TTS (same path for Listen + doctor call).

    Accepts only Urdu-script narration that still keeps English science terms.
    Pure Urdu is never kept — re-translate from the English answer instead.
    """
    if llm.looks_like_classroom_bilingual(urdu_text):
        return urdu_text
    if not english_answer.strip():
        return urdu_text
    reason = (
        "pure Urdu / missing English science terms"
        if llm.looks_like_urdu(urdu_text)
        else "not Urdu script"
    )
    print(f"  [speak] bilingual narration rejected ({reason}); re-translating")
    try:
        loop = asyncio.get_event_loop()
        rewritten = await loop.run_in_executor(
            None, llm.to_urdu_speech, english_answer
        )
        if llm.looks_like_classroom_bilingual(rewritten):
            return rewritten
        print("  [speak] rewrite still not bilingual; retrying stricter")
        rewritten = await loop.run_in_executor(
            None, lambda: llm.to_urdu_speech(english_answer, strict=True)
        )
        if llm.looks_like_classroom_bilingual(rewritten):
            return rewritten
        # Never fall back to accepting a fully Urdu narration as "good enough".
        return rewritten or urdu_text
    except Exception as exc:
        print(f"  [speak] Urdu fallback failed: {type(exc).__name__}")
        return urdu_text


def narration_id(english_answer: str, urdu_text: str) -> Optional[str]:
    """Register narration for streaming instead of synthesising inline.

    Synthesis (~2-3s) then happens while the client is already playing, rather
    than blocking the JSON response.
    """
    speak_text = llm.sanitize_speech_narration(
        urdu_text or llm._strip_for_speech(english_answer)
    )
    return cache_speech(speak_text)


# Repeat "explain this MCQ" requests are identical, so memoise the whole
# retrieve + generate pipeline.
_ANSWER_CACHE: "OrderedDict[str, tuple]" = OrderedDict()
_ANSWER_CACHE_MAX = 128
_EXPLAIN_CACHE: "OrderedDict[str, dict]" = OrderedDict()
_EXPLAIN_CACHE_MAX = 128


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


def _explain_cache_put(key: str, value: dict) -> None:
    _EXPLAIN_CACHE[key] = value
    while len(_EXPLAIN_CACHE) > _EXPLAIN_CACHE_MAX:
        _EXPLAIN_CACHE.popitem(last=False)


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
@limiter.limit("30/minute")
async def ask_ai(
    request: Request,
    req: Annotated[AskRequest, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    """Text question -> RAG -> LLM -> English answer + spoken Urdu audio."""
    return await _ask_ai_impl(req)


async def _ask_ai_impl(req: AskRequest):
    """Shared ask pipeline (also used by ask-voice after STT)."""
    mcq_block = req.mcq.summary() if req.mcq else ""
    cache_key = _answer_key(
        "ask_v2",
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
        # Hard gate: off-course questions never reach RAG/LLM tutoring.
        on_course = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: llm.is_course_related(
                req.student_question,
                history=req.history,
                has_mcq=bool(mcq_block),
            ),
        )
        if not on_course:
            answer_text, urdu_text = llm.off_topic_reply()
            sources = []
            if not req.history:
                _answer_cache_put(cache_key, (answer_text, urdu_text, sources))
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
            answer_text, urdu_text = llm.normalize_course_answer(answer_text, urdu_text)
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
            if llm.is_off_topic_answer(answer_text):
                answer_text, urdu_text = llm.off_topic_reply()
                sources = []
            if not req.history:
                _answer_cache_put(cache_key, (answer_text, urdu_text, sources))

    # Off-topic replies must not carry textbook citations
    if llm.is_off_topic_answer(answer_text):
        sources = []
        answer_text, urdu_text = llm.off_topic_reply()
    elif req.speak:
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


@app.post("/api/ask-voice", response_model=None)
@limiter.limit("20/minute")
async def ask_voice(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    audio=File(...),
    concept: str = Form(...),
    context_chunk: str = Form(""),
    mcq: str = Form(""),
):
    """Audio -> STT -> RAG (anchored on the MCQ) -> English answer + Urdu audio."""
    # `audio` is a Starlette UploadFile; avoid annotating UploadFile (breaks under
    # some FastAPI/Pydantic combos used on Render).
    audio_bytes = await audio.read()
    oversized = _reject_oversized_audio(audio_bytes)
    if oversized:
        return {
            "error": oversized,
            "transcript": "",
            "answer": "",
            "audio": None,
        }
    if not audio_bytes or len(audio_bytes) < 500:
        return {
            "error": "No usable audio received. Speak for at least 1–2 seconds.",
            "transcript": "",
            "answer": "",
            "audio": None,
        }

    transcript = await voice.speech_to_text(
        audio_bytes, filename=getattr(audio, "filename", None) or "audio.webm"
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
        result = await _ask_ai_impl(
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
    history: Optional[list[dict]] = None  # prior turns [{role, content}]


@app.post("/api/rag/ask")
@limiter.limit("30/minute")
async def rag_ask(
    request: Request,
    req: Annotated[RagAskRequest, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    """Question -> vector search over FSc Biology chunks -> grounded answer + pages."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    loop = asyncio.get_event_loop()
    on_course = await loop.run_in_executor(
        None,
        lambda: llm.is_course_related(
            req.question.strip(), history=req.history
        ),
    )
    if not on_course:
        answer_text, _ = llm.off_topic_reply()
        return {"answer": answer_text, "sources": [], "citation": None}

    retrieved = rag.retrieve_context(
        req.question.strip(),
        top_k=max(1, min(req.top_k, 10)),
        book=req.book,
    )
    context = retrieved["context"]
    sources = retrieved["sources"]

    # Always answer Biology questions — even when retrieval is empty on slim
    # deploys (no local fastembed). Prefer passages when present.
    answer_text = llm.answer_from_rag(
        req.question.strip(), context, history=req.history
    )
    answer_text, _ = llm.normalize_course_answer(answer_text, "")
    if llm.is_off_topic_answer(answer_text):
        return {"answer": answer_text, "sources": [], "citation": None}

    citation = rag.format_citation(sources) if context else None
    if citation and citation not in answer_text:
        answer_text = f"{answer_text}\n\n({citation})"

    return {
        "answer": answer_text,
        "sources": sources if context else [],
        "citation": citation,
    }


@app.post("/api/rag/ask-stream")
@limiter.limit("30/minute")
async def rag_ask_stream(
    request: Request,
    req: Annotated[RagAskRequest, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    """Streaming version: sends sources first, then LLM tokens as SSE."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    loop = asyncio.get_event_loop()
    on_course = await loop.run_in_executor(
        None,
        lambda: llm.is_course_related(
            req.question.strip(), history=req.history
        ),
    )
    if not on_course:
        answer_text, _ = llm.off_topic_reply()

        async def off_topic_stream():
            yield f"data: {json.dumps({'type': 'sources', 'sources': [], 'citation': None})}\n\n"
            yield f"data: {json.dumps({'type': 'text', 'content': answer_text})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(off_topic_stream(), media_type="text/event-stream")

    retrieved = rag.retrieve_context(
        req.question.strip(),
        top_k=max(1, min(req.top_k, 10)),
        book=req.book,
    )
    context = retrieved["context"]
    sources = retrieved["sources"]
    citation = rag.format_citation(sources) if context else None

    async def generate():
        yield f"data: {json.dumps({'type': 'sources', 'sources': sources if context else [], 'citation': citation})}\n\n"
        produced = False
        try:
            for token in llm.stream_answer_from_rag(
                req.question.strip(), context, history=req.history
            ):
                produced = True
                yield f"data: {json.dumps({'type': 'text', 'content': token})}\n\n"
        except Exception as exc:
            print(f"  [rag-ask-stream] Groq stream failed: {type(exc).__name__}: {exc}")
            fallback = ""
            try:
                fallback = llm.answer_from_rag(
                    req.question.strip(), context, history=req.history
                )
            except Exception as fallback_exc:
                print(
                    f"  [rag-ask-stream] fallback failed: {type(fallback_exc).__name__}"
                )
                yield f"data: {json.dumps({'type': 'text', 'content': friendly_error(exc)})}\n\n"
                yield "data: [DONE]\n\n"
                return
            if fallback.strip():
                produced = True
                yield f"data: {json.dumps({'type': 'text', 'content': fallback})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'text', 'content': friendly_error(exc)})}\n\n"
                yield "data: [DONE]\n\n"
                return
        if not produced:
            print("  [rag-ask-stream] Groq returned no tokens; using non-stream fallback")
            try:
                fallback = llm.answer_from_rag(
                    req.question.strip(), context, history=req.history
                )
                if fallback.strip():
                    yield f"data: {json.dumps({'type': 'text', 'content': fallback})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'text', 'content': 'I found the textbook pages but could not generate an explanation. Please ask again.'})}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'type': 'text', 'content': friendly_error(exc)})}\n\n"
        elif citation:
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


@app.post("/api/rag/ask-voice", response_model=None)
@limiter.limit("20/minute")
async def rag_ask_voice(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    audio=File(...),
    book: Optional[str] = Form(None),
    top_k: int = Form(5),
):
    """Audio -> STT -> textbook RAG search -> English answer + TTS audio."""
    audio_bytes = await audio.read()
    filename = getattr(audio, "filename", None) or "audio.webm"
    oversized = _reject_oversized_audio(audio_bytes)
    if oversized:
        return {
            "error": oversized,
            "transcript": "",
            "answer": "",
            "audio": None,
            "sources": [],
            "citation": None,
        }
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
        on_course = await loop.run_in_executor(
            None, lambda: llm.is_course_related(transcript.strip())
        )
        if not on_course:
            answer_text, urdu_text = llm.off_topic_reply()
            speech_id = narration_id(answer_text, urdu_text)
            return {
                "transcript": transcript,
                "answer": answer_text,
                "audio": None,
                "speech_id": speech_id,
                "urdu_text": urdu_text,
                "sources": [],
                "citation": None,
            }

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
        answer_text, urdu_text = llm.normalize_course_answer(answer_text, urdu_text)
        if llm.is_off_topic_answer(answer_text):
            answer_text, urdu_text = llm.off_topic_reply()
            speech_id = narration_id(answer_text, urdu_text)
            return {
                "transcript": transcript,
                "answer": answer_text,
                "audio": None,
                "speech_id": speech_id,
                "urdu_text": urdu_text,
                "sources": [],
                "citation": None,
            }
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
# Ask Textbook — saved conversations
# ===========================================================================
class TextbookChatCreate(BaseModel):
    title: Optional[str] = None
    book_filter: Optional[str] = None


class TextbookChatAppend(BaseModel):
    messages: list[dict]
    title: Optional[str] = None


def _chat_title_from_question(question: str) -> str:
    cleaned = " ".join((question or "").strip().split())
    if not cleaned:
        return "New chat"
    return cleaned if len(cleaned) <= 72 else cleaned[:69].rstrip() + "…"


@app.get("/api/textbook-chats")
@limiter.limit("60/minute")
async def list_textbook_chats(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    try:
        chats = await asyncio.get_event_loop().run_in_executor(
            None, lambda: db.list_textbook_chats(user.user_id)
        )
        return {"chats": chats}
    except Exception as exc:
        detail = str(exc)
        print(f"  [textbook-chats] list failed: {type(exc).__name__}: {detail}")
        hint = (
            "Chat history DB error. In Supabase SQL editor run "
            "migrations/004_textbook_chats_api_grants.sql "
            "(or: NOTIFY pgrst, 'reload schema';). "
            f"Detail: {detail[:240]}"
        )
        raise HTTPException(status_code=503, detail=hint)


@app.post("/api/textbook-chats")
@limiter.limit("30/minute")
async def create_textbook_chat(
    request: Request,
    req: Annotated[TextbookChatCreate, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    try:
        chat = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: db.create_textbook_chat(
                user.user_id,
                title=(req.title or "New chat"),
                book_filter=req.book_filter,
            ),
        )
        return chat
    except Exception as exc:
        detail = str(exc)
        print(f"  [textbook-chats] create failed: {type(exc).__name__}: {detail}")
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not create chat. Run 004_textbook_chats_api_grants.sql "
                f"in Supabase. Detail: {detail[:240]}"
            ),
        )


@app.get("/api/textbook-chats/{chat_id}")
@limiter.limit("60/minute")
async def get_textbook_chat(
    request: Request,
    chat_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    chat = await asyncio.get_event_loop().run_in_executor(
        None, lambda: db.get_textbook_chat(chat_id, user.user_id)
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    messages = await asyncio.get_event_loop().run_in_executor(
        None, lambda: db.list_textbook_chat_messages(chat_id)
    )
    return {**chat, "messages": messages}


class TextbookChatUpdate(BaseModel):
    title: Optional[str] = None
    book_filter: Optional[str] = None


@app.patch("/api/textbook-chats/{chat_id}")
@limiter.limit("30/minute")
async def patch_textbook_chat(
    request: Request,
    chat_id: str,
    req: Annotated[TextbookChatUpdate, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    title = (req.title or "").strip() if req.title is not None else None
    if req.title is not None and not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    updated = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: db.update_textbook_chat(
            chat_id,
            user.user_id,
            title=title,
            book_filter=req.book_filter,
            touch=True,
        ),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Chat not found")
    return updated


@app.delete("/api/textbook-chats/{chat_id}")
@limiter.limit("30/minute")
async def delete_textbook_chat(
    request: Request,
    chat_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    chat = await asyncio.get_event_loop().run_in_executor(
        None, lambda: db.get_textbook_chat(chat_id, user.user_id)
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await asyncio.get_event_loop().run_in_executor(
        None, lambda: db.delete_textbook_chat(chat_id, user.user_id)
    )
    return {"ok": True}


@app.post("/api/textbook-chats/{chat_id}/messages")
@limiter.limit("60/minute")
async def append_textbook_chat_messages(
    request: Request,
    chat_id: str,
    req: Annotated[TextbookChatAppend, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    chat = await asyncio.get_event_loop().run_in_executor(
        None, lambda: db.get_textbook_chat(chat_id, user.user_id)
    )
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    cleaned = []
    for m in req.messages or []:
        role = (m.get("role") or "").strip()
        content = (m.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        cleaned.append(
            {
                "role": role,
                "content": content,
                "sources": m.get("sources") or [],
                "citation": m.get("citation"),
            }
        )
    if not cleaned:
        raise HTTPException(status_code=400, detail="No valid messages")

    saved = await asyncio.get_event_loop().run_in_executor(
        None, lambda: db.append_textbook_chat_messages(chat_id, cleaned)
    )

    title = req.title
    if not title:
        first_user = next((m["content"] for m in cleaned if m["role"] == "user"), "")
        if chat.get("title") in {None, "", "New chat"} and first_user:
            title = _chat_title_from_question(first_user)

    updated = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: db.update_textbook_chat(
            chat_id, user.user_id, title=title, touch=True
        ),
    )
    return {"messages": saved, "chat": updated or chat}


# ===========================================================================
# Explain a wrong/right answer
# ===========================================================================
class ExplainRequest(BaseModel):
    question_id: str
    concept: str
    selected_option: str
    correct_option: str
    context_chunk: str = ""
    speak: bool = False
    stream_audio: bool = True


@app.post("/api/explain")
@limiter.limit("30/minute")
async def explain(
    request: Request,
    req: Annotated[ExplainRequest, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    """MCQ explanation — English on screen; same bilingual Urdu TTS as doctor call."""
    loop = asyncio.get_event_loop()
    question = None
    try:
        question = await loop.run_in_executor(None, db.get_question, req.question_id)
    except Exception:
        pass

    # Prefer server-side answer key; never trust the client alone.
    correct_option = (question or {}).get("correct_option") or req.correct_option

    cache_key = _answer_key(
        "explain_v4",
        req.question_id,
        req.concept,
        req.selected_option,
        correct_option,
        req.context_chunk,
        "speak" if req.speak else "silent",
    )
    cached = _EXPLAIN_CACHE.get(cache_key)
    if cached:
        response = dict(cached)
        if req.speak:
            urdu = await ensure_urdu(
                response.get("explanation") or "",
                response.get("urdu_text") or "",
            )
            response["urdu_text"] = urdu
            # Refresh cache so later Listen hits keep the repaired narration.
            repaired = dict(response)
            repaired["audio"] = None
            repaired["speech_id"] = None
            _explain_cache_put(cache_key, repaired)
            if req.stream_audio:
                response["speech_id"] = narration_id(
                    response["explanation"], urdu
                )
            else:
                try:
                    response["audio"] = await voice.text_to_speech(
                        urdu or llm._strip_for_speech(response["explanation"])
                    )
                except Exception:
                    response["audio"] = None
        return response

    question_text = (question or {}).get("question_text") or ""
    q_chapter = (question or {}).get("chapter") or req.concept

    context = req.context_chunk
    sources: list[dict] = []
    citation = None

    search_q = f"{question_text} {correct_option}".strip() or req.concept
    retrieved_task = loop.run_in_executor(
        None, lambda: rag.retrieve_context(search_q, top_k=3)
    )
    mnemonic_task = loop.run_in_executor(
        None, lambda: rag.retrieve_mnemonics(search_q, top_k=1)
    )
    retrieved, mnemonic = await asyncio.gather(
        retrieved_task, mnemonic_task, return_exceptions=True
    )

    if isinstance(retrieved, Exception):
        print(f"  [explain] RAG retrieval failed: {type(retrieved).__name__}: {retrieved}")
    else:
        context = context or retrieved.get("context") or ""
        sources = retrieved.get("sources") or []
        citation = rag.format_citation_short(sources)

    mnemonic_ctx = "" if isinstance(mnemonic, Exception) else mnemonic.get("context") or ""

    # English on screen first (MCQ-faithful). Speech is derived FROM that English
    # so Listen cannot invent a different warm-up topic before the real explanation.
    explanation = await loop.run_in_executor(
        None,
        lambda: llm.explain_answer(
            concept=q_chapter,
            selected_option=req.selected_option,
            correct_option=correct_option,
            question_text=question_text,
            context_chunk=context or "",
            mnemonic_chunk=mnemonic_ctx,
        ),
    )

    # Build citation from question source metadata as fallback so an explanation
    # always cites *something* correct, even when no textbook chunk matched.
    if not citation and question:
        q_book = (question or {}).get("book") or ""
        q_page = (question or {}).get("page_number")
        q_source = (question or {}).get("source") or ""
        q_year = (question or {}).get("year")
        if q_book and q_page:
            from .textbook_rag.chunk import book_display_name
            citation = f"{book_display_name(q_book)}, p. {q_page}"
        elif q_source and q_page:
            citation = f"{q_source}, p. {q_page}"
        elif q_source:
            # e.g. "MDCAT 2018" or "KIPS FLP 3" — the paper the MCQ came from.
            citation = f"{q_source}{f' ({q_year})' if q_year and str(q_year) not in q_source else ''}"
        elif q_year:
            citation = f"Past paper {q_year}"

    audio_b64 = None
    speech_id = None
    urdu_text = ""
    if req.speak:
        # Ground TTS in the on-screen English only (same voice path as doctor call).
        urdu_text = await ensure_urdu(explanation, "")
        urdu_text = llm.sanitize_speech_narration(urdu_text)
        if req.stream_audio:
            speech_id = narration_id(explanation, urdu_text)
        else:
            try:
                audio_b64 = await voice.text_to_speech(
                    urdu_text or llm._strip_for_speech(explanation)
                )
            except Exception:
                pass

    response = {
        "explanation": explanation,
        "answer": explanation,
        "urdu_text": urdu_text,
        "audio": audio_b64,
        "speech_id": speech_id,
        "concept": q_chapter,
        "citation": citation,
        "sources": sources,
        "mnemonics": [],
    }
    cacheable = dict(response)
    cacheable["audio"] = None
    cacheable["speech_id"] = None
    # Keep urdu_text in cache so Listen reuses the same doctor-call narration.
    _explain_cache_put(cache_key, cacheable)
    return response


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


@app.post("/api/students")
@limiter.limit("20/minute")
async def create_student(
    request: Request,
    req: Annotated[StudentCreate, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    """Create or update the profile for the authenticated user (id = auth.uid())."""
    email = (req.email or user.email or "").strip() or None
    name = (req.name or (user.email or "Student").split("@")[0]).strip()
    try:
        return db.upsert_student_profile(
            user.user_id,
            {
                "name": name,
                "email": email,
                "level": req.level,
                "daily_time": req.daily_time,
                "exam": req.exam,
                "subject": req.subject,
            },
        )
    except Exception as exc:
        # Always return JSON + CORS (never drop the connection).
        raise HTTPException(
            status_code=500,
            detail=f"Could not create student profile: {type(exc).__name__}: {exc}",
        ) from exc


@app.get("/api/students/me")
@limiter.limit("60/minute")
async def get_my_student(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    student = db.get_student(user.user_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


@app.get("/api/students/{student_id}")
@limiter.limit("60/minute")
async def get_student(
    request: Request,
    student_id: str,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    assert_same_student(user, student_id)
    student = db.get_student(user.user_id)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student


# ===========================================================================
# Concepts + chapters
# ===========================================================================
@app.get("/api/concepts")
@limiter.limit("60/minute")
async def list_concepts(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    return db.list_concepts()


@app.get("/api/chapters")
@limiter.limit("60/minute")
async def list_chapters(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    """Catalog + which chapters already have MCQs in the mixed bank."""
    return study.available_chapters()


# ===========================================================================
# Questions — diagnostic / chapter / custom / platform FLP
# ===========================================================================
@app.get("/api/questions")
@limiter.limit("60/minute")
async def get_questions(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    chapter: Optional[str] = None,
    concept_id: Optional[str] = None,
    student_id: Optional[str] = None,
):
    """Next questions for a student based on mode + weak-spot profile."""
    sid = assert_same_student(user, student_id)
    payload = study.next_questions_for_student(
        sid, chapter=chapter, concept_id=concept_id
    )
    return public_question_set(payload)


@app.get("/api/questions/diagnostic")
@limiter.limit("30/minute")
async def questions_diagnostic(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    count: int = 25,
    student_id: Optional[str] = None,
):
    sid = assert_same_student(user, student_id)
    qs = study.build_diagnostic(count=max(10, min(count, 40)))
    return public_question_set(
        {
            "mode": "diagnostic",
            "student_id": sid,
            "questions": qs,
            "timed_seconds": None,
        }
    )


@app.get("/api/questions/chapter")
@limiter.limit("30/minute")
async def questions_chapter(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    chapter: str,
    count: int = 100,
    student_id: Optional[str] = None,
):
    """Chapter practice: mix from ALL sources (tests, FLPs, past papers, repeated)."""
    sid = assert_same_student(user, student_id)
    n = max(1, min(count, 100))
    try:
        qs = await asyncio.get_event_loop().run_in_executor(
            None, lambda: study.build_chapter_practice(chapter, count=n, student_id=sid)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not load chapter questions: {type(exc).__name__}: {exc}",
        ) from exc
    return public_question_set(
        {
            "mode": "chapter_practice",
            "chapter": chapter,
            "questions": qs,
            "timed_seconds": None,
        }
    )


class CustomQuizRequest(BaseModel):
    selections: list[dict]  # [{ chapter, book?, count }]
    student_id: Optional[str] = None


@app.post("/api/questions/custom")
@limiter.limit("30/minute")
async def questions_custom(
    request: Request,
    req: Annotated[CustomQuizRequest, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    sid = assert_same_student(user, req.student_id)
    qs = await asyncio.get_event_loop().run_in_executor(
        None, lambda: study.build_custom(req.selections, student_id=sid)
    )
    return public_question_set(
        {
            "mode": "custom",
            "questions": qs,
            "selections": req.selections,
            "timed_seconds": None,
        }
    )


@app.get("/api/questions/full-length")
@limiter.limit("20/minute")
async def questions_full_length(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    mode: str = "practice",
    student_id: Optional[str] = None,
):
    """Our own Biology FLP: 81 MCQs mixed from the entire bank — not one FLP PDF."""
    if mode not in ("practice", "timed"):
        raise HTTPException(status_code=400, detail="mode must be practice or timed")
    sid = assert_same_student(user, student_id)
    qs = await asyncio.get_event_loop().run_in_executor(
        None, lambda: study.build_platform_flp(student_id=sid)
    )
    session_mode = (
        "full_length_timed" if mode == "timed" else "full_length_practice"
    )
    return public_question_set(
        {
            "mode": session_mode,
            "questions": qs,
            "timed_seconds": study.FULL_LENGTH_TIMED_SEC if mode == "timed" else None,
            "note": "Platform FLP — mixed from academy tests, FLPs, past papers & most-repeated",
        }
    )


# ===========================================================================
# Sessions
# ===========================================================================
class SessionStart(BaseModel):
    student_id: Optional[str] = None
    mode: str
    concept_id: Optional[str] = None
    chapter: Optional[str] = None


@app.post("/api/sessions")
@limiter.limit("30/minute")
async def start_session(
    request: Request,
    req: Annotated[SessionStart, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    sid = assert_same_student(user, req.student_id)
    # Sessions FK → students(id). Auto-create a minimal profile if signup
    # never wrote one (e.g. email-confirm then sign-in without /api/students).
    if not db.get_student(sid):
        db.upsert_student_profile(
            sid,
            {
                "name": (user.email or "Student").split("@")[0],
                "email": user.email,
                "level": "just_starting",
                "daily_time": "1hr",
                "exam": "MDCAT 2026",
                "subject": "Biology",
            },
        )
    payload = req.model_dump(exclude_none=True)
    payload["student_id"] = sid
    try:
        return db.create_session(payload)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Could not start session: {type(exc).__name__}: {exc}",
        ) from exc


class SessionEnd(BaseModel):
    score: Optional[int] = None
    total: Optional[int] = None


@app.post("/api/sessions/{session_id}/end")
@limiter.limit("30/minute")
async def finish_session(
    request: Request,
    session_id: str,
    req: Annotated[SessionEnd, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    import datetime as dt

    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.get("student_id") != user.user_id:
        raise HTTPException(status_code=403, detail="Not your session")

    score, total = db.session_attempt_score(user.user_id, session_id)

    db.end_session(
        session_id,
        {
            "ended_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "score": score,
            "total": total,
        },
    )
    weak_spots.recompute_for_session(user.user_id, session_id)

    if session.get("mode") == "diagnostic":
        db.update_student(user.user_id, {"diagnostic_done": True})

    # Refresh daily plan after every completed session
    try:
        planner.generate_daily_plan(user.user_id)
    except Exception:
        pass

    return study.session_summary(user.user_id, session_id)


@app.get("/api/session-summary")
@limiter.limit("60/minute")
async def session_summary(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    session_id: str,
    student_id: Optional[str] = None,
):
    sid = assert_same_student(user, student_id)
    session = db.get_session(session_id)
    if not session or session.get("student_id") != sid:
        raise HTTPException(status_code=404, detail="Session not found")
    return study.session_summary(sid, session_id)


# ===========================================================================
# Attempts
# ===========================================================================
class AttemptCreate(BaseModel):
    student_id: Optional[str] = None
    question_id: str
    selected_option: str
    session_id: Optional[str] = None


@app.post("/api/attempt")
@limiter.limit("120/minute")
async def log_attempt(
    request: Request,
    req: Annotated[AttemptCreate, Body()],
    user: Annotated[AuthUser, Depends(get_current_user)],
):
    sid = assert_same_student(user, req.student_id)
    if req.session_id:
        session = db.get_session(req.session_id)
        if not session or session.get("student_id") != sid:
            raise HTTPException(status_code=403, detail="Not your session")

    question = db.get_question(req.question_id)
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    is_correct = req.selected_option == question["correct_option"]
    attempt = db.log_attempt(
        {
            "student_id": sid,
            "question_id": req.question_id,
            "concept_id": question.get("concept_id"),
            "session_id": req.session_id,
            "selected_option": req.selected_option,
            "is_correct": is_correct,
        }
    )
    if question.get("concept_id"):
        weak_spots.recompute_for_concept(sid, question["concept_id"])

    return {
        "is_correct": is_correct,
        "correct_option": question["correct_option"],
        "attempt": attempt,
    }


# ===========================================================================
# Weak spots + dashboard + plans
# ===========================================================================
@app.get("/api/weak-spots")
@limiter.limit("60/minute")
async def get_weak_spots(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    student_id: Optional[str] = None,
):
    sid = assert_same_student(user, student_id)
    return weak_spots.ranked_report(sid)


@app.get("/api/dashboard")
@limiter.limit("60/minute")
async def dashboard(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    student_id: Optional[str] = None,
):
    student_id = assert_same_student(user, student_id)
    loop = asyncio.get_event_loop()

    # These reads are independent — run them concurrently instead of paying a
    # sequential Supabase round-trip for each (kept the dashboard ~3.5s).
    student, attempts, focus, daily = await asyncio.gather(
        loop.run_in_executor(None, db.get_student, student_id),
        loop.run_in_executor(None, db.get_attempts, student_id),
        loop.run_in_executor(None, weak_spots.recommended_focus, student_id),
        loop.run_in_executor(None, planner.get_or_create_daily_plan, student_id),
        return_exceptions=True,
    )
    if isinstance(student, Exception):
        student = None
    if isinstance(attempts, Exception) or attempts is None:
        attempts = []
    if isinstance(focus, Exception):
        focus = None
    if isinstance(daily, Exception):
        daily = None

    total = len(attempts)
    correct = sum(1 for a in attempts if a.get("is_correct"))

    concepts = {c["id"]: c for c in db.list_concepts()}

    # Batch-fetch every question referenced by attempts in one round-trip
    # (previously an N+1 get_question per attempt made the dashboard ~4s).
    needed_qids = [
        a["question_id"]
        for a in attempts
        if a.get("question_id") and not concepts.get(a.get("concept_id"))
    ]
    q_map = (
        await loop.run_in_executor(
            None, lambda: db.get_questions_by_ids(needed_qids, columns="id,chapter")
        )
        if needed_qids
        else {}
    )

    chapters: dict[str, dict] = {}
    for a in attempts:
        concept = concepts.get(a.get("concept_id"))
        chapter = None
        if concept:
            chapter = concept.get("chapter", "Unknown")
        else:
            q = q_map.get(a.get("question_id"))
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

    return {
        "accuracy_pct": round(correct / total * 100, 1) if total else 0,
        "total_attempted": total,
        "streak": streak,
        "chapters": list(chapters.values()),
        "focus": focus,
        "diagnostic_done": bool(student and student.get("diagnostic_done")),
        "daily_plan": daily,
    }


@app.get("/api/weekly-plan")
@limiter.limit("30/minute")
async def get_weekly_plan(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    student_id: Optional[str] = None,
):
    sid = assert_same_student(user, student_id)
    plan = db.get_latest_weekly_plan(sid)
    if not plan:
        plan = planner.generate_plan(sid)
    return plan


@app.post("/api/weekly-plan/generate")
@limiter.limit("10/minute")
async def make_weekly_plan(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    student_id: Optional[str] = None,
):
    sid = assert_same_student(user, student_id)
    return planner.generate_plan(sid)


@app.get("/api/daily-plan")
@limiter.limit("30/minute")
async def get_daily_plan(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    student_id: Optional[str] = None,
):
    sid = assert_same_student(user, student_id)
    return planner.get_or_create_daily_plan(sid)


@app.post("/api/daily-plan/generate")
@limiter.limit("10/minute")
async def make_daily_plan(
    request: Request,
    user: Annotated[AuthUser, Depends(get_current_user)],
    student_id: Optional[str] = None,
):
    sid = assert_same_student(user, student_id)
    return planner.generate_daily_plan(sid)


# ===========================================================================
# Health
# ===========================================================================
@app.api_route("/", methods=["GET", "HEAD"])
async def root():
    """Lightweight root ping for load balancers / App Runner / uptime monitors."""
    return {"service": "mdcat-ai-tutor", "status": "ok"}


@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    """Liveness + integration flags (no heavy work — safe for health checks).

    HEAD is required: UptimeRobot and similar monitors often probe with HEAD;
    GET-only routes return 405 and show as permanently Down.
    """
    if settings.is_production:
        return {"status": "ok"}
    return {
        "status": "ok",
        "environment": settings.ENVIRONMENT,
        "groq": settings.groq_ready,
        "elevenlabs": settings.elevenlabs_ready,
        "uplift": settings.uplift_ready,
        "tts": settings.tts_ready,
        "supabase": settings.supabase_ready,
        "auth": settings.auth_ready,
    }
