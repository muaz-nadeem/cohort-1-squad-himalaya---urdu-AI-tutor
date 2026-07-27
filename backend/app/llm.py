"""LLM prompt construction + generation (Groq-hosted models).

Uses the OpenAI-compatible SDK pointed at Groq's endpoint. Holds the exact
system prompts from the documentation. Kept separate from RAG so prompts live
in one place.
"""
from __future__ import annotations

import re
import time
from functools import lru_cache
from typing import Optional

from openai import OpenAI, RateLimitError

from .config import settings

ASK_SYSTEM_PROMPT = """You are a friendly, expert MDCAT Biology tutor for Pakistani FSc students.

Rules:
1. Always answer the student's question clearly and helpfully. Never refuse or say you lack a textbook passage.
2. If a textbook passage is provided and it is relevant, use it and prefer those facts.
3. If the passage is missing, weak, or off-topic, answer from your own solid MDCAT/FSc Biology knowledge.
4. Never say "the provided text doesn't discuss…" or "I don't have the textbook passage…". Just teach.
5. Write the ENTIRE answer in clear Scientific English only. Do NOT use Urdu script, Roman Urdu, or Hindi — even if the student asked in Urdu.
6. Keep under 120 words.
7. End with one memorable exam tip when useful.
8. Do not invent page numbers. The app may append a citation separately."""

URDU_SPEECH_SYSTEM_PROMPT = """You are an Urdu-speaking MDCAT Biology tutor talking to a Pakistani FSc student on a phone call.

You will be given an English tutoring answer. Re-express it as natural spoken Urdu.

Rules:
1. Output ONLY Urdu script (اردو). No English sentences, no Roman Urdu, no Hindi.
2. Keep standard scientific terms in English where students actually use them (for example: mitochondria, enzyme, glucose, DNA). Write those terms in Urdu script transliteration only if it reads naturally; otherwise keep the English word.
3. Sound like natural speech, warm and clear — as if explaining out loud to a student.
4. Do NOT read out citations, page numbers, book names, brackets, bullet symbols, or markdown.
5. Keep it under 120 words. Do not add new facts that were not in the English answer.
6. Output only the Urdu narration — no preamble, no labels, no quotes."""

RAG_ASK_SYSTEM_PROMPT = """You are an expert MDCAT Biology tutor for FSc Punjab Textbook Board (PTB) students.

Rules:
1. Always give a clear, useful answer to the student's question. Never refuse.
2. Prefer the provided textbook passages when they clearly cover the topic.
3. If passages are missing or off-topic, answer from your own MDCAT/FSc knowledge without saying the passage is incomplete.
4. Never write lines like "the provided textbook passage doesn't discuss…" or "refer to the relevant chapter".
5. Write the ENTIRE answer in clear Scientific English only. Do NOT use Urdu script, Roman Urdu, Hindi, or mixed-language lines — even if the student asked in Urdu.
6. Be thorough but concise (under 150 words).
7. End with a quick MDCAT tip when useful.
8. Do not invent page numbers that were not in the passages. Do not invent citations."""

EXPLAIN_SYSTEM_PROMPT = """You are an MDCAT tutor explaining an MCQ to a Pakistani FSc student.

Rules:
1. ALWAYS explain the question itself. Why the correct option is right, and why the student's choice is wrong.
2. Prefer textbook notes when they match this topic; otherwise use your own knowledge.
3. Never say the textbook/passage/context "doesn't mention" something, or that you lack a passage. Just teach.
4. Never invent a different question or change the topic. Stick to THIS MCQ only.
5. Keep it under 100 words. Simple English with brief Urdu/Roman Urdu hints where helpful.
6. End with one short memory tip if useful.
7. Do not add a source citation in the body — the app appends that separately."""


@lru_cache
def get_groq_client() -> OpenAI:
    """OpenAI SDK client pointed at Groq's API.

    max_retries=0 because we retry once ourselves; the SDK's own retries would
    compound with ours and leave a student waiting a minute on a 429.
    """
    return OpenAI(
        api_key=settings.GROQ_API_KEY,
        base_url=settings.GROQ_BASE_URL,
        max_retries=0,
        timeout=30.0,
    )


@lru_cache
def get_gemini_client() -> OpenAI:
    """OpenAI SDK client pointed at Gemini's OpenAI-compatible endpoint."""
    return OpenAI(
        api_key=settings.GEMINI_API_KEY,
        base_url=settings.GEMINI_BASE_URL,
    )


def _chat(system_prompt: str, user_prompt: str, max_tokens: int) -> str:
    client = get_groq_client()
    # One quick retry rides out a momentary tokens-per-minute spike. Beyond
    # that we fail fast rather than making the student stare at a spinner.
    for attempt in range(2):
        try:
            response = client.chat.completions.create(
                model=settings.LLM_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=max_tokens,
                temperature=0.3,
            )
            return response.choices[0].message.content or ""
        except RateLimitError as exc:
            if attempt == 1:
                raise
            delay = _retry_after_seconds(exc, default=2.0)
            print(f"  [llm] rate limited, retrying once in {delay:.1f}s")
            time.sleep(delay)

    raise RuntimeError("LLM call failed")


def _retry_after_seconds(exc: Exception, default: float) -> float:
    """Honour Groq's Retry-After hint, capped so a student never waits long."""
    headers = getattr(getattr(exc, "response", None), "headers", None) or {}
    raw = headers.get("retry-after") or headers.get("Retry-After")
    try:
        return min(float(raw), 3.0) if raw else default
    except (TypeError, ValueError):
        return default


def _ask_user_prompt(
    concept: str,
    student_question: str,
    context_chunk: str = "",
    history: Optional[list[dict]] = None,
    mcq_block: str = "",
) -> str:
    """Build the Ask-AI user prompt (shared by English-only and bilingual calls)."""
    history_block = ""
    if history:
        last3 = history[-3:]
        history_block = "\n".join(
            f"{turn.get('role', 'user')}: {turn.get('content', '')}" for turn in last3
        )
        history_block = f"\nRecent conversation:\n{history_block}\n"

    if mcq_block:
        focus_block = f"""THE STUDENT IS CURRENTLY LOOKING AT THIS MCQ. Every answer must be about THIS question:
{mcq_block}

"""
        focus_rule = (
            " The student's question is a follow-up about the MCQ above. "
            "Stay strictly on that MCQ's topic. If the textbook notes are about a different topic, ignore them "
            "and rely on your own knowledge of THIS MCQ. Never explain a different question or a different concept."
        )
    else:
        focus_block = ""
        focus_rule = ""

    user_prompt = f"""{focus_block}Optional textbook notes (may be empty or off-topic — still answer the student):
{context_chunk if context_chunk else '(none)'}
{history_block}
Student question (may be in Urdu or English): {student_question}
Topic: {concept}

Answer helpfully in English only. Prefer the notes if relevant; otherwise use your own knowledge. Never say the passage is missing. Never reply in Urdu script or Roman Urdu.{focus_rule}"""

    return user_prompt


def answer_question(
    concept: str,
    student_question: str,
    context_chunk: str = "",
    history: Optional[list[dict]] = None,
    mcq_block: str = "",
) -> str:
    """Answer a free-form student follow-up, grounded in the textbook chunk."""
    user_prompt = _ask_user_prompt(
        concept, student_question, context_chunk, history, mcq_block
    )
    return _chat(ASK_SYSTEM_PROMPT, user_prompt, max_tokens=280)


def explain_answer(
    concept: str,
    selected_option: str,
    correct_option: str,
    question_text: str = "",
    context_chunk: str = "",
    mnemonic_chunk: str = "",
) -> str:
    """Explain why the correct MCQ option is right and the picked one is wrong."""
    support = ""
    if context_chunk.strip():
        support += f"\nHelpful textbook notes (use only if clearly about this same topic):\n{context_chunk}\n"
    if mnemonic_chunk.strip():
        support += f"\nMnemonic tip (use only if it fits this topic):\n{mnemonic_chunk}\n"

    user_prompt = f"""MCQ:
{question_text or '(see options below)'}

Topic/chapter: {concept}
Correct option: {correct_option}
Student selected: {selected_option}
{support}
Explain this MCQ clearly. Do not mention missing passages or change the subject."""

    return _chat(EXPLAIN_SYSTEM_PROMPT, user_prompt, max_tokens=220)


def answer_from_rag(question: str, context: str) -> str:
    """Answer a free-form Biology question grounded in multimodal RAG context."""
    user_prompt = _rag_user_prompt(question, context)
    return _chat(RAG_ASK_SYSTEM_PROMPT, user_prompt, max_tokens=350)


def stream_answer_from_rag(question: str, context: str):
    """Streaming version — yields text chunks as they arrive from Groq."""
    client = get_groq_client()
    user_prompt = _rag_user_prompt(question, context)
    stream = client.chat.completions.create(
        model=settings.LLM_MODEL,
        messages=[
            {"role": "system", "content": RAG_ASK_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=350,
        temperature=0.3,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta
        if delta.content:
            yield delta.content


def _rag_user_prompt(question: str, context: str) -> str:
    return f"""Optional textbook passages (each tagged with [Book - page - type]):
{context if context else '(none retrieved)'}

Student question (may be in Urdu or English): {question}

Answer helpfully in English only. Prefer the passages if they match the topic; otherwise use your own MDCAT/FSc knowledge. Never say the passage is missing or incomplete. Never reply in Urdu or Roman Urdu."""


def _bilingual_prompt(role_line: str, source_line: str) -> str:
    """Build a two-section prompt.

    Language rules are scoped per section on purpose: a single global
    "English only" rule makes the model write the Urdu section in Roman Urdu.
    """
    return f"""{role_line}

You produce every reply in TWO sections, in this exact order and format:

ENGLISH:
<the explanation in clear Scientific English>
URDU:
<the same explanation as natural spoken Urdu>

Tutoring rules (apply to both sections):
1. Always answer the student's question. Never refuse, never stall.
2. {source_line}
3. Never write lines like "the passage doesn't mention" or "refer to the chapter". Just teach.
4. Never change the topic or invent a different question.
5. Do not invent page numbers or citations — the app appends those separately.
6. The question may arrive from speech recognition and contain garbled or
   misspelled terms. Silently infer the intended Biology term and answer that.
   Never remark on spelling/transcription, never say a term is unclear, and
   never quote the student's raw wording back to them.

ENGLISH section rules:
- Scientific English only. No Urdu script, no Roman Urdu, no Hindi, even if the student asked in Urdu.
- Under 120 words. End with one short exam tip when useful.

URDU section rules:
- Write in Urdu script (اردو) ONLY. This section MUST be Urdu script — never Roman Urdu, never English sentences.
- Keep scientific terms students actually say in English (mitochondria, enzyme, glucose, DNA, ATP) as those English words.
- Natural spoken style, as if explaining out loud on a phone call.
- No citations, page numbers, brackets, bullets or markdown — it will be read aloud.
- Under 110 words. Add no facts that are absent from the ENGLISH section.

Output nothing except the two labelled sections."""


ASK_BILINGUAL_SYSTEM_PROMPT = _bilingual_prompt(
    "You are a friendly, expert MDCAT Biology tutor for Pakistani FSc students.",
    "Use the provided textbook notes when they are relevant; otherwise rely on your own solid MDCAT/FSc Biology knowledge.",
)

RAG_BILINGUAL_SYSTEM_PROMPT = _bilingual_prompt(
    "You are an expert MDCAT Biology tutor for FSc Punjab Textbook Board (PTB) students.",
    "Prefer the provided textbook passages when they clearly cover the topic; otherwise use your own MDCAT/FSc knowledge.",
)


def answer_question_bilingual(
    concept: str,
    student_question: str,
    context_chunk: str = "",
    history: Optional[list[dict]] = None,
    mcq_block: str = "",
) -> tuple[str, str]:
    """Ask-AI answer as (english, urdu_narration) in a single LLM round-trip."""
    user_prompt = _ask_user_prompt(
        concept, student_question, context_chunk, history, mcq_block
    )
    raw = _chat(ASK_BILINGUAL_SYSTEM_PROMPT, user_prompt, max_tokens=600)
    return _split_bilingual(raw)


def answer_from_rag_bilingual(question: str, context: str) -> tuple[str, str]:
    """Textbook RAG answer as (english, urdu_narration) in one LLM round-trip."""
    raw = _chat(RAG_BILINGUAL_SYSTEM_PROMPT, _rag_user_prompt(question, context), max_tokens=700)
    return _split_bilingual(raw)


def looks_like_urdu(text: str, min_ratio: float = 0.5) -> bool:
    """True when the text is genuinely Urdu script rather than Roman Urdu."""
    letters = [c for c in (text or "") if c.isalpha()]
    if len(letters) < 10:
        return False
    urdu = sum(1 for c in letters if 0x0600 <= ord(c) <= 0x06FF)
    return urdu / len(letters) >= min_ratio


def _split_bilingual(raw: str) -> tuple[str, str]:
    """Parse the ENGLISH:/URDU: envelope, tolerating model drift."""
    text = (raw or "").strip()
    if not text:
        return "", ""

    match = re.search(
        r"ENGLISH\s*:\s*(.*?)\s*URDU\s*:\s*(.*)\Z", text, re.IGNORECASE | re.DOTALL
    )
    if match:
        return match.group(1).strip(), match.group(2).strip()

    # Fallback: split on the first Urdu-script character
    idx = next((i for i, ch in enumerate(text) if 0x0600 <= ord(ch) <= 0x06FF), -1)
    if idx > 0:
        english = re.sub(r"(ENGLISH|URDU)\s*:\s*", "", text[:idx], flags=re.IGNORECASE)
        return english.strip(), text[idx:].strip()
    return re.sub(r"(ENGLISH|URDU)\s*:\s*", "", text, flags=re.IGNORECASE).strip(), ""


def to_urdu_speech(english_answer: str) -> str:
    """Turn an English tutoring answer into natural spoken Urdu for TTS."""
    text = _strip_for_speech(english_answer)
    if not text:
        return ""
    try:
        urdu = _chat(
            URDU_SPEECH_SYSTEM_PROMPT,
            f"English tutoring answer:\n{text}\n\nNow speak this to the student in natural Urdu.",
            max_tokens=400,
        )
        return urdu.strip()
    except Exception:
        return ""


def _strip_for_speech(text: str) -> str:
    """Remove citations/markdown so the spoken version stays clean."""
    import re

    cleaned = text or ""
    # Drop trailing citation blocks like (FSc Biology Part 1, p. 8 | PTB)
    cleaned = re.sub(r"\((?:[^()]*(?:p\.|page|PTB)[^()]*)\)", " ", cleaned)
    cleaned = re.sub(r"[*_#`>\[\]]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()
