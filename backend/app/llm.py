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

OFF_TOPIC_ENGLISH = (
    "Please ask me something from your course — FSc / MDCAT Biology. "
    "I only help with your Biology syllabus and textbook topics."
)

OFF_TOPIC_URDU = (
    "براہِ کرم اپنے کورس سے کچھ پوچھیں — FSc / MDCAT Biology۔ "
    "میں صرف آپ کے Biology syllabus اور textbook topics میں مدد دیتا ہوں۔"
)

COURSE_SCOPE = """SCOPE (critical):
- You ONLY tutor FSc / MDCAT Biology (Punjab Textbook Board syllabus and related exam practice).
- On-topic includes: Biology concepts, textbook pages, MCQs, diagrams, definitions, comparisons,
  exam tips, and short follow-ups about a Biology question already being discussed
  (e.g. "explain more", "why is B wrong", "in simple words").
- Off-topic includes: other subjects (unless tightly Biology), sports, politics, coding, jokes,
  recipes, celebrity talk, personal chat, general knowledge, and anything not Biology course work.
- If the request is off-topic, do NOT answer it. Reply with EXACTLY this English sentence and nothing else:
  "Please ask me something from your course — FSc / MDCAT Biology. I only help with your Biology syllabus and textbook topics."
"""

ASK_SYSTEM_PROMPT = f"""You are a friendly, expert MDCAT Biology tutor for Pakistani FSc students.

{COURSE_SCOPE}

Rules:
1. For on-topic Biology questions, answer clearly and helpfully. Never say you lack a textbook passage.
2. If a textbook passage is provided and it is relevant, use it and prefer those facts.
3. If the passage is missing, weak, or off-topic for an otherwise Biology question, answer from your own solid MDCAT/FSc Biology knowledge.
4. Never say "the provided text doesn't discuss…" or "I don't have the textbook passage…". Just teach Biology.
5. Write the ENTIRE answer in clear Scientific English only. Do NOT use Urdu script, Roman Urdu, or Hindi — even if the student asked in Urdu.
6. Keep under 120 words.
7. End with one memorable exam tip when useful.
8. Do not invent page numbers. The app may append a citation separately."""

URDU_SPEECH_SYSTEM_PROMPT = """You are an Urdu-speaking MDCAT Biology tutor talking to a Pakistani FSc student on a phone call.

You will be given an English tutoring answer. Re-express THAT SAME answer as natural bilingual classroom Urdu — the way Pakistani teachers actually speak in FSc/MDCAT coaching (Urdu glue + English science words).

Rules:
1. Write the explanation in Urdu script (اردو) but keep English key terms inline in Latin letters.
2. Keep ALL scientific and technical terms in English — never translate or transliterate them into Urdu. This includes formulas and symbols: write O2, H2O, CO2, n2, ATP exactly like that. NEVER write Urdu numbers inside a formula (wrong: O دو, H دو O).
3. Sentence structure and connecting words in Urdu; science words in English. Example style: "Electron کی total energy nth orbit میں En = -13.6 / n² eV ہوتی ہے." Another example: "Hydrogen H2 oxygen O2 کے ساتھ react کر کے H2O بناتا ہے۔"
4. Sound like natural speech, warm and clear — as if explaining out loud to a student.
5. Do NOT read out citations, page numbers, book names, brackets, bullet symbols, or markdown.
6. Keep it under 120 words.
7. No Roman Urdu, no Hindi. Urdu script for the Urdu parts, English for the technical terms.
8. FAITHFULNESS (critical): Only restate what is in the English answer. Do NOT invent a different topic, extra examples, warm-up chatter, or "related" facts that were not written there.
9. Start immediately with the explanation. No greetings (no السلام علیکم), no "آج ہم بات کریں گے", no preamble about another concept first.
10. Output only the narration — no preamble, no labels, no quotes, no ENGLISH:/URDU: markers.
11. Never write a fully Urdu explanation. Urdu is only sentence glue; science terms and formulas stay English.
12. NEVER write توانائی — always write energy. NEVER write الفا/بیٹا/گاما — write alpha/beta/gamma. NEVER write برقی مقناطیسی — write electromagnetic. NEVER write تابکار/تابکاری — write radioactive/radioactivity. NEVER write شعاعیں — write rays. NEVER write ذرات for science — write particles. NEVER write اخراج — write emission. If it is a syllabus science word, keep the English Latin letters.
13. Do not include Greek or math symbols (α β γ Δ μ λ π $). Write alpha, beta, gamma, and so on."""

RAG_ASK_SYSTEM_PROMPT = f"""You are an expert MDCAT Biology tutor for FSc Punjab Textbook Board (PTB) students.

{COURSE_SCOPE}

Rules:
1. For on-topic Biology questions, give a clear, useful answer.
2. Prefer the provided textbook passages when they clearly cover the topic.
3. If passages are missing or off-topic for an otherwise Biology question, answer from your own MDCAT/FSc knowledge without saying the passage is incomplete.
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
5. Start immediately with THIS MCQ — do not open with a different concept, warm-up, or unrelated textbook aside.
6. Keep it under 100 words. Scientific English only — no Urdu script, no Roman Urdu.
7. End with one short memory tip if useful.
8. Do not add a source citation in the body — the app appends that separately."""


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
def get_openai_client() -> OpenAI:
    """OpenAI SDK client for MCQ ingestion (gpt-4o-mini)."""
    return OpenAI(
        api_key=settings.OPENAI_API_KEY,
        max_retries=2,
        timeout=60.0,
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


def _chat_openai(system_prompt: str, user_prompt: str, max_tokens: int) -> str:
    """Ask Textbook + MCQ explanations via OpenAI (gpt-4o-mini by default)."""
    if not settings.openai_ready:
        raise RuntimeError("OPENAI_API_KEY is not set")
    client = get_openai_client()
    for attempt in range(2):
        try:
            response = client.chat.completions.create(
                model=settings.EXPLAIN_LLM_MODEL,
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
            print(f"  [llm-openai] rate limited, retrying once in {delay:.1f}s")
            time.sleep(delay)

    raise RuntimeError("OpenAI explanation call failed")


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
            " This MCQ discussion is always on-topic course material."
        )
        scope_rule = ""
    else:
        focus_block = ""
        focus_rule = ""
        scope_rule = (
            f" If the student question is NOT about FSc/MDCAT Biology course material, "
            f"reply with EXACTLY: {OFF_TOPIC_ENGLISH}"
        )

    user_prompt = f"""{focus_block}Optional textbook notes (may be empty — only use when relevant to Biology):
{context_chunk if context_chunk else '(none)'}
{history_block}
Student question (may be in Urdu or English): {student_question}
Topic: {concept}

Answer helpfully in English only when the question is about Biology course material. Prefer the notes if relevant; otherwise use your own Biology knowledge. Never say the passage is missing. Never reply in Urdu script or Roman Urdu.{focus_rule}{scope_rule}"""

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


def _explain_user_prompt(
    concept: str,
    selected_option: str,
    correct_option: str,
    question_text: str = "",
    context_chunk: str = "",
    mnemonic_chunk: str = "",
) -> str:
    support = ""
    if context_chunk.strip():
        support += f"\nHelpful textbook notes (use only if clearly about this same topic):\n{context_chunk}\n"
    if mnemonic_chunk.strip():
        support += f"\nMnemonic tip (use only if it fits this topic):\n{mnemonic_chunk}\n"

    return f"""MCQ:
{question_text or '(see options below)'}

Topic/chapter: {concept}
Correct option: {correct_option}
Student selected: {selected_option}
{support}
Explain this MCQ clearly. Do not mention missing passages or change the subject."""


def explain_answer(
    concept: str,
    selected_option: str,
    correct_option: str,
    question_text: str = "",
    context_chunk: str = "",
    mnemonic_chunk: str = "",
) -> str:
    """Explain why the correct MCQ option is right and the picked one is wrong."""
    user_prompt = _explain_user_prompt(
        concept,
        selected_option,
        correct_option,
        question_text,
        context_chunk,
        mnemonic_chunk,
    )
    return _chat_openai(EXPLAIN_SYSTEM_PROMPT, user_prompt, max_tokens=220)


def answer_from_rag(
    question: str,
    context: str,
    history: Optional[list[dict]] = None,
) -> str:
    """Answer a free-form Biology question grounded in multimodal RAG context."""
    user_prompt = _rag_user_prompt(question, context, history)
    return _chat_openai(RAG_ASK_SYSTEM_PROMPT, user_prompt, max_tokens=350)


def stream_answer_from_rag(
    question: str,
    context: str,
    history: Optional[list[dict]] = None,
):
    """Streaming version — yields text chunks from OpenAI gpt-4o-mini."""
    if not settings.openai_ready:
        raise RuntimeError("OPENAI_API_KEY is not set")
    client = get_openai_client()
    user_prompt = _rag_user_prompt(question, context, history)
    last_exc: Exception | None = None
    for attempt in range(2):
        try:
            stream = client.chat.completions.create(
                model=settings.EXPLAIN_LLM_MODEL,
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
                if delta and delta.content:
                    yield delta.content
            return
        except RateLimitError as exc:
            last_exc = exc
            if attempt == 1:
                raise
            delay = _retry_after_seconds(exc, default=2.0)
            print(f"  [llm-stream] rate limited, retrying once in {delay:.1f}s")
            time.sleep(delay)
    if last_exc:
        raise last_exc
    raise RuntimeError("LLM stream failed")


def _rag_user_prompt(
    question: str,
    context: str,
    history: Optional[list[dict]] = None,
) -> str:
    history_block = ""
    if history:
        lines: list[str] = []
        for turn in history[-8:]:
            role = (turn.get("role") or "user").strip()
            content = (turn.get("content") or "").strip()
            if not content:
                continue
            label = "Student" if role == "user" else "Tutor"
            lines.append(f"{label}: {content}")
        if lines:
            history_block = (
                "Recent conversation (use for follow-ups; stay on Biology):\n"
                + "\n".join(lines)
                + "\n\n"
            )

    return f"""Optional textbook passages (each tagged with [Book - page - type]):
{context if context else '(none retrieved)'}

{history_block}Student question (may be in Urdu or English): {question}

If this is NOT about FSc/MDCAT Biology course material, reply with EXACTLY:
{OFF_TOPIC_ENGLISH}

Otherwise answer helpfully in English only. Prefer the passages if they match the topic; otherwise use your own MDCAT/FSc Biology knowledge. Never say the passage is missing or incomplete. Never reply in Urdu or Roman Urdu. If this is a short follow-up (e.g. "explain more", "why"), continue from the recent conversation."""


def _bilingual_prompt(role_line: str, source_line: str) -> str:
    """Build a two-section prompt.

    Language rules are scoped per section on purpose: a single global
    "English only" rule makes the model write the Urdu section in Roman Urdu.
    """
    return f"""{role_line}

{COURSE_SCOPE}

You produce every reply in TWO sections, in this exact order and format:

ENGLISH:
<the explanation in clear Scientific English>
URDU:
<the same explanation as natural spoken Urdu>

Tutoring rules (apply to both sections):
1. For on-topic Biology questions, answer clearly. Never stall about missing passages.
2. {source_line}
3. Never write lines like "the passage doesn't mention" or "refer to the chapter". Just teach Biology.
4. Never change the topic or invent a different question.
5. Do not invent page numbers or citations — the app appends those separately.
6. The question may arrive from speech recognition and contain garbled or
   misspelled Biology terms. Silently infer the intended Biology term and answer that.
   Never remark on spelling/transcription, never say a term is unclear, and
   never quote the student's raw wording back to them.
7. If the request is off-topic (not FSc/MDCAT Biology), put EXACTLY this in ENGLISH
   and the matching Urdu redirect in URDU — do not teach the off-topic subject:
   ENGLISH: {OFF_TOPIC_ENGLISH}
   URDU: {OFF_TOPIC_URDU}

ENGLISH section rules:
- Scientific English only. No Urdu script, no Roman Urdu, no Hindi, even if the student asked in Urdu.
- Under 120 words. End with one short exam tip when useful.

URDU section rules:
- Write in Urdu script (اردو) with English key terms kept inline — natural Pakistani classroom bilingual style (Urdu glue + English science words).
- Keep ALL scientific/technical terms in English Latin letters. Never translate or transliterate them into Urdu. This includes energy (never توانائی), alpha/beta/gamma (never الفا/بیٹا/گاما), electromagnetic (never برقی مقناطیسی), radioactive, emission, particle, nucleus, atom, molecule, cell, membrane, DNA, RNA, ATP, enzyme, mitochondria, photosynthesis, osmosis, wavelength, frequency, hydrogen, glucose, virus, bacteria, and every other FSc/MDCAT syllabus term.
- Do not write Greek or math symbols (α β γ Δ). Write the English names: alpha, beta, gamma.
- Formulas stay English: write O2, H2O, CO2, n2 — never Urdu digits inside a formula (wrong: O دو / H دو O).
- Sentence structure and connecting words in Urdu, key terms in English. Example: "Hydrogen H2 oxygen O2 کے ساتھ react کر کے H2O بناتا ہے۔"
- Never use Roman Urdu or Hindi.
- Never write a fully Urdu explanation. Science words stay English in every sentence.
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

EXPLAIN_BILINGUAL_SYSTEM_PROMPT = f"""You are an MDCAT tutor explaining an MCQ to a Pakistani FSc student.

{COURSE_SCOPE}

You produce every reply in TWO sections, in this exact order and format:

ENGLISH:
<the explanation in clear Scientific English>
URDU:
<the same explanation as natural spoken classroom Urdu>

MCQ tutoring rules (both sections):
1. ALWAYS explain THIS MCQ: why the correct option is right, and why the student's choice is wrong when it differs.
2. Prefer textbook notes when they match this topic; otherwise use your own MDCAT/FSc knowledge. Never stall about missing passages.
3. Never invent a different question or change the topic. Stick to THIS MCQ only.
4. Do not invent page numbers or citations — the app appends those separately.
5. Keep each section under 100 words. End ENGLISH with one short memory tip when useful.

ENGLISH section rules:
- Scientific English only. No Urdu script, no Roman Urdu, no Hindi.
- Clear, exam-friendly wording.

URDU section rules:
- Pakistani coaching-classroom bilingual: Urdu script for sentence glue, English Latin letters for science terms.
- Keep ALL scientific/technical terms in English. Never translate or transliterate them into Urdu. energy stays energy (never توانائی). alpha, beta, gamma, electromagnetic, radioactive, emission, particle, nucleus, atom, molecule, cell, DNA, RNA, ATP, enzyme, and every other FSc/MDCAT syllabus term stay English Latin letters.
- Do not write Greek or math symbols. Write alpha, beta, gamma as English words.
- Formulas stay English (O2, H2O). Never write Urdu numbers inside them.
- Example style: "Hydrogen H2 oxygen O2 کے ساتھ react کر کے H2O بناتا ہے۔"
- Natural spoken style for a phone-call tutor. No citations, brackets, bullets, or markdown.
- No Roman Urdu, no Hindi.
- Never write a fully Urdu explanation. Science words stay English in every sentence.

Output nothing except the two labelled sections."""


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
    raw = _chat_openai(ASK_BILINGUAL_SYSTEM_PROMPT, user_prompt, max_tokens=600)
    return normalize_course_answer(*_split_bilingual(raw))


def answer_from_rag_bilingual(
    question: str,
    context: str,
    history: Optional[list[dict]] = None,
) -> tuple[str, str]:
    """Textbook RAG answer as (english, urdu_narration) in one LLM round-trip."""
    raw = _chat_openai(
        RAG_BILINGUAL_SYSTEM_PROMPT,
        _rag_user_prompt(question, context, history),
        max_tokens=700,
    )
    return normalize_course_answer(*_split_bilingual(raw))


def explain_answer_bilingual(
    concept: str,
    selected_option: str,
    correct_option: str,
    question_text: str = "",
    context_chunk: str = "",
    mnemonic_chunk: str = "",
) -> tuple[str, str]:
    """MCQ explain as (english_for_ui, bilingual_urdu_for_tts)."""
    user_prompt = _explain_user_prompt(
        concept,
        selected_option,
        correct_option,
        question_text,
        context_chunk,
        mnemonic_chunk,
    )
    user_prompt += (
        "\n\nFor the URDU section: speak like a Pakistani coaching teacher — "
        "Urdu sentences with English science words left in English "
        "(nucleus, electron, energy, alpha, beta, gamma, electromagnetic, formula, orbit, x-ray, etc.)."
    )
    raw = _chat_openai(EXPLAIN_BILINGUAL_SYSTEM_PROMPT, user_prompt, max_tokens=600)
    return normalize_course_answer(*_split_bilingual(raw))


def looks_like_urdu(text: str, min_ratio: float = 0.3) -> bool:
    """True when the text contains meaningful Urdu script (bilingual is fine)."""
    letters = [c for c in (text or "") if c.isalpha()]
    if len(letters) < 10:
        return False
    urdu = sum(1 for c in letters if 0x0600 <= ord(c) <= 0x06FF)
    return urdu / len(letters) >= min_ratio


# Element symbol + Urdu digit/word (O دو, H۲O) — not classroom bilingual.
_FORMULA_URDU_NUMBER = re.compile(
    r"(?<![A-Za-z])[A-Za-z]{1,2}\s*(?:[۰-۹٠-٩]+|دو|تین|چار|پانچ|چھ|سات|آٹھ|نو|ایک|صفر)"
)


def looks_like_classroom_bilingual(text: str) -> bool:
    """Urdu narration that still keeps English science terms in Latin letters.

    Pure Urdu (everything transliterated) fails this check so we can re-translate
    into the Pakistani coaching mix students expect.

    Note: do NOT reuse looks_like_urdu()'s 30% ratio here — real classroom
    bilingual often has more Latin science letters than Urdu glue letters.
    """
    raw = (text or "").strip()
    if not raw:
        return False
    if is_off_topic_answer(raw):
        return any(0x0600 <= ord(c) <= 0x06FF for c in raw)
    if _FORMULA_URDU_NUMBER.search(raw):
        return False
    if _SCIENCE_LEAK_RE.search(raw):
        return False
    urdu_chars = sum(1 for c in raw if 0x0600 <= ord(c) <= 0x06FF)
    if urdu_chars < 8:
        return False
    return bool(re.search(r"[A-Za-z]{3,}", raw))


TOPIC_GATE_SYSTEM = """You classify student messages for an FSc/MDCAT Biology tutor app.
Reply with only YES or NO.

YES = about Biology, FSc/MDCAT Biology syllabus, textbook content, MCQs, diagrams,
definitions, exam tips, or a short follow-up about Biology already being discussed
(e.g. "explain more", "why", "in simple words", "aur detail mein batao").

NO = other school subjects (Math/Physics/Chemistry unless it is clearly Biology),
sports, politics, coding, jokes, recipes, celebrities, weather, personal chat,
general knowledge, or anything not Biology course work.

If unsure but it could be Biology, answer YES."""


def is_course_related(
    question: str,
    *,
    history: Optional[list[dict]] = None,
    has_mcq: bool = False,
) -> bool:
    """Fast YES/NO gate so off-topic prompts never get a full tutoring answer."""
    if has_mcq:
        return True
    q = (question or "").strip()
    if not q:
        return False

    history_bits = ""
    if history:
        recent = history[-3:]
        history_bits = "\n".join(
            f"{t.get('role', 'user')}: {t.get('content', '')}" for t in recent
        )
        history_bits = f"\nRecent conversation:\n{history_bits}\n"

    user = f"""{history_bits}Student message: {q}

Is this about FSc/MDCAT Biology course material? Reply YES or NO only."""

    try:
        client = get_groq_client()
        response = client.chat.completions.create(
            model=settings.TOPIC_GATE_MODEL,
            messages=[
                {"role": "system", "content": TOPIC_GATE_SYSTEM},
                {"role": "user", "content": user},
            ],
            max_tokens=3,
            temperature=0,
        )
        verdict = (response.choices[0].message.content or "").strip().upper()
        return verdict.startswith("Y")
    except Exception as exc:
        # Fail open on gate errors so a rate-limit on the tiny model does not
        # block real Biology questions; the main prompt still enforces scope.
        print(f"  [topic-gate] failed open: {type(exc).__name__}")
        return True


def is_off_topic_answer(text: str) -> bool:
    """Detect the fixed redirect phrase (or close variants) in a model reply."""
    t = (text or "").lower()
    return "ask me something from your course" in t or "اپنے کورس سے کچھ پوچھ" in (text or "")


def off_topic_reply() -> tuple[str, str]:
    return OFF_TOPIC_ENGLISH, OFF_TOPIC_URDU


def normalize_course_answer(english: str, urdu: str = "") -> tuple[str, str]:
    """Force the canonical redirect if the model drifted while refusing."""
    if is_off_topic_answer(english) or is_off_topic_answer(urdu):
        return OFF_TOPIC_ENGLISH, OFF_TOPIC_URDU
    if urdu:
        urdu = sanitize_speech_narration(urdu)
    return english, urdu


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


def to_urdu_speech(english_answer: str, *, strict: bool = False) -> str:
    """Turn an English tutoring answer into natural spoken Urdu for TTS."""
    text = _strip_for_speech(english_answer)
    if not text:
        return ""
    extra = (
        "CRITICAL: Do not write a fully Urdu explanation. Every science word "
        "(nucleus, electron, energy, alpha, beta, gamma, electromagnetic, "
        "hydrogen, oxygen, molecule, DNA, ATP, and so on) MUST stay English "
        "Latin letters. Never write توانائی, الفا, بیٹا, گاما, or برقی مقناطیسی. "
        "Formulas MUST be O2, H2O, CO2 — never O دو or H دو O. "
        "Never include Greek symbols — write alpha, beta, gamma."
        if strict
        else ""
    )
    try:
        urdu = _chat_openai(
            URDU_SPEECH_SYSTEM_PROMPT,
            (
                "English tutoring answer (speak ONLY this — do not add other topics):\n"
                f"{text}\n\n"
                "Now restate this exact answer in natural bilingual classroom Urdu "
                "(Urdu script + English science terms). Keep formulas as O2, H2O, CO2 — "
                "never Urdu digits inside a formula. Start immediately. No greeting.\n"
                f"{extra}"
            ).strip(),
            max_tokens=400,
        )
        return sanitize_speech_narration(urdu)
    except Exception:
        return ""


# Longest-first: swap leaked Urdu science translations back to English for TTS.
_SCIENCE_URDU_TO_EN: tuple[tuple[str, str], ...] = (
    ("برقی مقناطیسی امواج", "electromagnetic waves"),
    ("برقی مقناطیسی شعاعیں", "electromagnetic rays"),
    ("برقی مقناطیسی", "electromagnetic"),
    ("تابکار مادے", "radioactive substances"),
    ("تابکار مادہ", "radioactive substance"),
    ("الفا ذرات", "alpha particles"),
    ("بیٹا ذرات", "beta particles"),
    ("گاما شعاعیں", "gamma rays"),
    ("گاما ریز", "gamma rays"),
    ("ہیلیم مرکزے", "helium nuclei"),
    ("ایٹمی مرکزے", "atomic nuclei"),
    ("ایٹمی مرکزہ", "atomic nucleus"),
    ("ضیائی تالیف", "photosynthesis"),
    ("طول موج", "wavelength"),
    ("نیوکلیائی", "nuclear"),
    ("تابکاری", "radioactivity"),
    ("تابکار", "radioactive"),
    ("توانائی", "energy"),
    ("شعاعیں", "rays"),
    ("اخراج", "emission"),
    ("انبعاث", "emission"),
    ("مرکزے", "nuclei"),
    ("مرکزہ", "nucleus"),
    ("ذرات", "particles"),
    ("الفا", "alpha"),
    ("بیٹا", "beta"),
    ("بیتا", "beta"),
    ("گاما", "gamma"),
    ("مالیکیولز", "molecules"),
    ("مالیکیول", "molecule"),
    ("ایٹم", "atom"),
    ("خلیے", "cells"),
    ("خلیہ", "cell"),
    ("جھلی", "membrane"),
    ("خمیر", "enzyme"),
    ("وراثہ", "gene"),
    ("کروموسوم", "chromosome"),
    ("ہائیڈروجن", "hydrogen"),
    ("آکسیجن", "oxygen"),
    ("نائٹروجن", "nitrogen"),
    ("گلوکوز", "glucose"),
    ("پروٹین", "protein"),
    ("ہارمون", "hormone"),
    ("وائرس", "virus"),
    ("بیکٹیریا", "bacteria"),
    ("مائٹوکونڈریا", "mitochondria"),
    ("کلوروفل", "chlorophyll"),
    ("کلوروپلاسٹ", "chloroplast"),
    ("ڈی این اے", "DNA"),
    ("آر این اے", "RNA"),
    ("اے ٹی پی", "ATP"),
    ("تعدد", "frequency"),
    ("انحطاط", "decay"),
)

_SCIENCE_LEAK_RE = re.compile(
    "|".join(
        re.escape(w)
        for w in (
            "توانائی",
            "برقی مقناطیسی",
            "تابکار",
            "تابکاری",
            "الفا",
            "بیٹا",
            "بیتا",
            "گاما",
            "ضیائی تالیف",
            "اخراج",
            "انبعاث",
            "مائٹوکونڈریا",
            "کلوروفل",
            "طول موج",
        )
    )
)

_GREEK_TO_EN = str.maketrans({
    "α": " alpha ",
    "β": " beta ",
    "γ": " gamma ",
    "δ": " delta ",
    "Δ": " delta ",
    "μ": " micro ",
    "λ": " lambda ",
    "ω": " omega ",
    "π": " pi ",
    "σ": " sigma ",
    "θ": " theta ",
    "φ": " phi ",
    "ν": " nu ",
    "Σ": " sigma ",
    "Ω": " ohm ",
})

_SYMBOL_STRIP = re.compile(
    r"[\$\\{}\^_|~`•·×÷√∑∫≈≠≤≥±∞°′″†‡※←→↔↑↓⟶⟹]+"
)


def strip_speech_symbols(text: str) -> str:
    """Greek letters become English names; other symbols are dropped so TTS stays clean."""
    cleaned = (text or "").translate(_GREEK_TO_EN)
    cleaned = re.sub(r"\$[^$]*\$", " ", cleaned)
    cleaned = _SYMBOL_STRIP.sub(" ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def restore_english_science_terms(text: str) -> str:
    """If the model slipped Urdu translations, put the English syllabus words back."""
    out = text or ""
    for urdu, english in _SCIENCE_URDU_TO_EN:
        if urdu in out:
            out = out.replace(urdu, f" {english} ")
    return re.sub(r"\s+", " ", out).strip()


def sanitize_speech_narration(text: str) -> str:
    """Strip labels/greetings so TTS does not speak hallucinated warm-up first."""
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    cleaned = re.sub(r"(?i)\b(?:ENGLISH|URDU)\s*:\s*", " ", cleaned)
    # Common spoken openings that are not part of the written explanation.
    cleaned = re.sub(
        r"^(?:السلام[\s\u0600-\u06FF]*[.!۔]?\s*|"
        r"Assalamu?\s*alaikum[.!]?\s*|"
        r"(?:Hello|Hi|Hey)[.!,]?\s*)+",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"^(?:آئیے|چلیے|آج ہم|سب سے پہلے)[^۔.!?]*[۔.!?]\s*",
        "",
        cleaned,
    )
    cleaned = restore_english_science_terms(cleaned)
    cleaned = strip_speech_symbols(cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _strip_for_speech(text: str) -> str:
    """Remove citations/markdown so the spoken version stays clean."""
    cleaned = text or ""
    # Drop trailing citation blocks like (FSc Biology Part 1, p. 8 | PTB)
    cleaned = re.sub(r"\((?:[^()]*(?:p\.|page|PTB)[^()]*)\)", " ", cleaned)
    cleaned = re.sub(r"[*_#`>\[\]]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()
