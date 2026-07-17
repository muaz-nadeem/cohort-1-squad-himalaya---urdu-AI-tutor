"""LLM prompt construction + generation (Groq-hosted models).

Uses the OpenAI-compatible SDK pointed at Groq's endpoint. Holds the exact
system prompts from the documentation. Kept separate from RAG so prompts live
in one place.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from openai import OpenAI

from .config import settings

ASK_SYSTEM_PROMPT = """You are a friendly, expert MDCAT Biology tutor for Pakistani FSc students.

Rules:
1. Always answer the student's question clearly and helpfully. Never refuse or say you lack a textbook passage.
2. If a textbook passage is provided and it is relevant, use it and prefer those facts.
3. If the passage is missing, weak, or off-topic, answer from your own solid MDCAT/FSc Biology knowledge.
4. Never say "the provided text doesn't discuss…" or "I don't have the textbook passage…". Just teach.
5. Keep under 120 words. Scientific English with brief Urdu/Roman Urdu hints where helpful.
6. End with one memorable exam tip when useful.
7. Do not invent page numbers. The app may append a citation separately."""

RAG_ASK_SYSTEM_PROMPT = """You are an expert MDCAT Biology tutor for FSc Punjab Textbook Board (PTB) students.

Rules:
1. Always give a clear, useful answer to the student's question. Never refuse.
2. Prefer the provided textbook passages when they clearly cover the topic; cite those pages.
3. If passages are missing or off-topic, answer from your own MDCAT/FSc knowledge without saying the passage is incomplete.
4. Never write lines like "the provided textbook passage doesn't discuss…" or "refer to the relevant chapter".
5. Be thorough but concise (under 150 words). Scientific English with brief Urdu hints where helpful.
6. End with a quick MDCAT tip when useful.
7. Do not invent page numbers that were not in the passages."""

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
    """OpenAI SDK client pointed at Groq's API."""
    return OpenAI(
        api_key=settings.GROQ_API_KEY,
        base_url=settings.GROQ_BASE_URL,
    )


def _chat(system_prompt: str, user_prompt: str, max_tokens: int) -> str:
    client = get_groq_client()
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


def answer_question(
    concept: str,
    student_question: str,
    context_chunk: str = "",
    history: Optional[list[dict]] = None,
) -> str:
    """Answer a free-form student follow-up, grounded in the textbook chunk."""
    history_block = ""
    if history:
        last3 = history[-3:]
        history_block = "\n".join(
            f"{turn.get('role', 'user')}: {turn.get('content', '')}" for turn in last3
        )
        history_block = f"\nRecent conversation:\n{history_block}\n"

    user_prompt = f"""Optional textbook notes (may be empty or off-topic — still answer the student):
{context_chunk if context_chunk else '(none)'}
{history_block}
Student question: {student_question}
Topic: {concept}

Answer helpfully. Prefer the notes if relevant; otherwise use your own knowledge. Never say the passage is missing."""

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

Student question: {question}

Answer helpfully. Prefer the passages if they match the topic; otherwise use your own MDCAT/FSc knowledge. Never say the passage is missing or incomplete."""
