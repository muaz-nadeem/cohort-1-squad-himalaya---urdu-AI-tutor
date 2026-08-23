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
    "Please ask a relevant Biology question. I only help with FSc / MDCAT Biology."
)

OFF_TOPIC_URDU = (
    "براہِ کرم ایک relevant Biology question پوچھیں۔ "
    "میں صرف FSc / MDCAT Biology میں مدد دیتا ہوں۔"
)

COURSE_SCOPE = f"""SCOPE (critical):
- You ONLY tutor FSc / MDCAT Biology (Punjab Textbook Board syllabus and related exam practice).
- On-topic includes: Biology concepts, textbook pages, MCQs, diagrams, definitions, comparisons,
  exam tips, and short follow-ups about a Biology question already being discussed
  (e.g. "explain more", "why is B wrong", "in simple words").
- Off-topic includes: greetings and small talk (hi, hello, assalamualaikum, how are you, thanks, bye),
  other subjects (unless tightly Biology), sports, politics, coding, jokes, recipes, celebrity talk,
  personal chat, general knowledge, and anything not Biology course work.
- Never greet the student back. Never chit-chat. If the request is off-topic — including greetings —
  do NOT answer it. Reply with EXACTLY this English sentence and nothing else:
  "{OFF_TOPIC_ENGLISH}"
"""

# Shared by every spoken-Urdu prompt. TTS misreads Urdu translations/transliterations
# of syllabus words (آنت / انٹسٹائن → garbled "testine").
BILINGUAL_CLASSROOM_RULES = """PROPER bilingual classroom Urdu (critical — a TTS voice will read this aloud):
- Urdu script is ONLY sentence glue: ہے، ہیں، میں، کا، کے، کی، سے، اور، لیکن، کیونکہ، ہوتا ہے، بناتا ہے، کرتی ہے، والا، والے.
- Every Biology word stays in ENGLISH Latin letters, spelled exactly as in the textbook/exam. This includes organs and body parts: intestine, large intestine, small intestine, stomach, liver, pancreas, kidney, lung, heart, blood, bile, vitamin, bacteria, enzyme, hormone, cell, nucleus, membrane, absorption, digestion, respiration, energy, molecule, DNA, ATP, and every other FSc/MDCAT term.
- NEVER translate those words into Urdu. Wrong: آنت / آنتیں / امعاء (intestine), معدہ (stomach), جگر (liver), لبلبہ (pancreas), گردہ (kidney), پھیپھڑے (lungs), توانائی (energy), خلیہ (cell), نیم مائع / نیم مادہ (semi-liquid), بلغم (mucus), کیموس (chyme).
- NEVER write English words in Urdu letters (transliteration). Wrong: انٹسٹائن, انٹیسٹائن, وٹامن, بیکٹیریا, انرجی, سیل. TTS then says garbage like "testine". Write intestine, vitamin, bacteria, energy, cell.
- Descriptive science words stay English too: bolus, chyme, mucus, semi-liquid, semi-solid — never نیم مائع, نیم مادہ, بلغم, کیموس, بلوس.
- Right: "Bolus chew ہونے کے بعد chyme ایک semi-liquid mixture بن جاتا ہے، mucus lining کو protect کرتا ہے۔"
- Wrong: "بلوس چبانے کے بعد کیموس نیم مادہ بن جاتا ہے۔"
- Right: "Vitamin K large intestine میں bacteria کی activity سے بنتا ہے۔"
- Wrong: "وٹامن کے بڑی آنت میں بیکٹیریا کی سرگرمی سے بنتا ہے۔"
- Wrong: "Vitamin K بڑی انٹسٹائن میں ..."
- Right: "Hydrogen H2 oxygen O2 کے ساتھ react کر کے H2O بناتا ہے۔"
- Do not write Greek or math symbols (α β γ Δ). Write the English names: alpha, beta, gamma.
- Formulas stay English: write O2, H2O, CO2, n2 — never Urdu digits inside a formula (wrong: O دو / H دو O).
- Never use Roman Urdu or Hindi.
- Never write a fully Urdu explanation. Every sentence must keep its science words in English Latin letters."""

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

URDU_SPEECH_SYSTEM_PROMPT = f"""You are an Urdu-speaking MDCAT Biology tutor talking to a Pakistani FSc student on a phone call.

You will be given an English tutoring answer. Re-express THAT SAME answer as natural bilingual classroom Urdu — the way Pakistani teachers actually speak in FSc/MDCAT coaching (Urdu glue + English science words).

{BILINGUAL_CLASSROOM_RULES}

Rewrite rules:
1. Sound like natural speech, warm and clear — as if explaining out loud to a student.
2. Do NOT read out citations, page numbers, book names, brackets, bullet symbols, or markdown.
3. Keep it under 120 words.
4. FAITHFULNESS (critical): Only restate what is in the English answer. Do NOT invent a different topic, extra examples, warm-up chatter, or "related" facts that were not written there.
5. Start immediately with the explanation. No greetings (no السلام علیکم), no "آج ہم بات کریں گے", no preamble about another concept first.
6. Output only the narration — no preamble, no labels, no quotes, no ENGLISH:/URDU: markers."""

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
1. ALWAYS explain the question itself. Why the scientifically correct option is right, and why the student's choice is wrong if it differs.
2. Prefer textbook notes when they match this topic; otherwise use your own knowledge.
3. Never say the textbook/passage/context "doesn't mention" something, or that you lack a passage. Just teach.
4. Never invent a different question or change the topic. Stick to THIS MCQ only.
5. First line MUST be exactly: KEY: A   (or B, C, or D) — the scientifically correct option letter from the given choices. If the stored key looks wrong, use the scientific letter anyway. Do not mention a key error.
6. Then explain THIS MCQ. Do not open with a different concept, warm-up, or unrelated textbook aside.
7. Keep the explanation under 100 words. Scientific English only — no Urdu script, no Roman Urdu.
8. End with one short memory tip if useful.
9. Do not add a source citation in the body — the app appends that separately."""


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
            " If the student is asking about the MCQ above, stay strictly on that MCQ's topic. "
            "If the textbook notes are about a different topic, ignore them "
            "and rely on your own knowledge of THIS MCQ. Never explain a different question or a different concept."
        )
    else:
        focus_block = ""
        focus_rule = ""
    scope_rule = (
        f" If the student is greeting you, making small talk, or asking anything that is NOT "
        f"FSc/MDCAT Biology course material, reply with EXACTLY: {OFF_TOPIC_ENGLISH}"
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
    options_block: str = "",
) -> str:
    support = ""
    if context_chunk.strip():
        support += f"\nHelpful textbook notes (use only if clearly about this same topic):\n{context_chunk}\n"
    if mnemonic_chunk.strip():
        support += f"\nMnemonic tip (use only if it fits this topic):\n{mnemonic_chunk}\n"
    options = f"\nOptions:\n{options_block}\n" if options_block.strip() else ""

    return f"""MCQ:
{question_text or '(see options below)'}
{options}
Topic/chapter: {concept}
Stored key (may be wrong): {correct_option}
Student selected: {selected_option}
{support}
Start with KEY: X then explain the scientifically correct option. Do not mention missing passages or change the subject."""


def explain_answer(
    concept: str,
    selected_option: str,
    correct_option: str,
    question_text: str = "",
    context_chunk: str = "",
    mnemonic_chunk: str = "",
    options_block: str = "",
) -> str:
    """Explain why the correct MCQ option is right and the picked one is wrong."""
    user_prompt = _explain_user_prompt(
        concept,
        selected_option,
        correct_option,
        question_text,
        context_chunk,
        mnemonic_chunk,
        options_block,
    )
    return _chat_openai(EXPLAIN_SYSTEM_PROMPT, user_prompt, max_tokens=240)


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
{BILINGUAL_CLASSROOM_RULES}
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
{BILINGUAL_CLASSROOM_RULES}
- Natural spoken style for a phone-call tutor. No citations, brackets, bullets, or markdown.

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
        "Urdu sentence glue only, English science words left in English Latin letters "
        "(intestine, stomach, liver, vitamin, bacteria, nucleus, electron, energy, "
        "alpha, beta, gamma, electromagnetic, formula, orbit, x-ray, etc.). "
        "Never write آنت, انٹسٹائن, معدہ, or any other translated/transliterated syllabus word."
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
definitions, exam tips, comparisons between biology concepts, or a follow-up about
Biology already being discussed (e.g. "explain more", "why", "in simple words",
"aur detail mein batao", "فرق بتا دیں", "ڈفرنس کیا ہے").

Students often ask in Urdu script, Roman Urdu, or English. Biology terms may appear
in English OR Urdu transliteration (e.g. endoskeleton / اینڈوسکیلیٹن,
exoskeleton / ایگزوسکیلیٹن, cell / خلیہ). These are YES when asking about the concept.

NO = greetings and small talk (hi, hello, hey, assalamualaikum, salam, how are you,
thanks, bye, who are you), other school subjects (Math/Physics/Chemistry unless it
is clearly Biology), sports, politics, coding, jokes, recipes, celebrities, weather,
personal chat, general knowledge, or anything not Biology course work.

A greeting or thanks by itself is always NO — even if an MCQ is on screen.
If a greeting is followed by a real Biology question, answer YES.
If the message asks about a biology/science concept (in any language or script), YES.
If unsure between NO and YES for an academic-looking question, answer YES."""


_HONORIFIC = r"(?:\s+(?:sir|madam|ma'?am|ji|bhai|doctor|doc|yaar))*"

_SOCIAL_CORE = r"""
    (?:
        hi+|hello+|he+y+|yo+|hiya|howdy|
        (?:ass?alamu?\s*-?\s*(?:o\s+)?(?:alaikum|alikum|alaekum)?)|
        (?:as-?salam)|
        salam+|salaam+|
        aoa|a\.?o\.?a\.?|
        السلام(?:\s*علیکم)?|
        سلام|
        good\s*(?:morning|afternoon|evening|night)|
        how\s+are\s+you(?:\s+doing)?|
        how'?s\s+it\s+going|
        what'?s\s+up|
        (?:kya|kia)\s+haal(?:\s+hai)?|
        k(?:ai|e)se\s+ho|
        کیا\s*حال(?:\s*ہے)?|
        کیسے\s*(?:ہو|ہیں)|
        آپ\s*کیسے\s*ہیں|
        thanks?(?:\s+you)?(?:\s+so\s+much)?|
        thx|
        shukr(?:iya|ia)|
        jazak(?:allah)?|
        شکریہ|
        ok(?:ay)?|
        theek\s*hai|ٹھیک\s*ہے|
        acha+|اچھا|
        bye|goodbye|see\s+you|
        (?:khuda|allah)\s*hafiz|
        (?:خدا|اللہ)\s*حافظ|
        who\s+are\s+you|
        what'?s\s+your\s+name|
        what\s+can\s+you\s+do|
        nice\s+to\s+(?:meet|see)\s+you
    )
"""

_SOCIAL_FULL = re.compile(
    rf"^(?:{_SOCIAL_CORE}{_HONORIFIC}[\s!.?,۔!?-]*)+$",
    re.IGNORECASE | re.VERBOSE | re.UNICODE,
)

_BIO_FOLLOWUP = re.compile(
    r"(?:"
    r"\b(?:explain|detail|more|why|how|wrong|correct|right|option|"
    r"simple|meaning|define|difference|compare|example|"
    r"kyun|kyon|kaise|kese|matlab|samjhao|batao|farq|wazahat)\b|"
    r"کیا\s*ہے|سمجھا|بتا|فرق|ڈفرنس|وضاحت|بتائ|سمجھائ"
    r")",
    re.IGNORECASE | re.UNICODE,
)

_BIO_TERM_EN = re.compile(
    r"\b(?:"
    r"endoskeleton|exoskeleton|hydrostatic|skeleton|axial|appendicular|"
    r"cytoskeleton|cartilage|bone|joint|muscle|ligament|tendon|"
    r"cell|dna|rna|enzyme|mitosis|meiosis|photosynthesis|respiration|"
    r"heart|kidney|liver|blood|hormone|protein|lipid|vitamin|bacteria|"
    r"plant|animal|tissue|organ|nucleus|membrane|chromosome|gene|"
    r"biology|mdcat|fsc|chapter|mcq|diagram|textbook|osmosis|"
    r"diffusion|neuron|alveoli|stomata|chloroplast|ecosystem|species|"
    r"evolution|genetics|embryo|fertilization|virus|fungi|organelle|"
    r"mitochondria|ribosome|vacuole|molecule|glucose|ATP"
    r")\b",
    re.IGNORECASE,
)

# Urdu-script transliterations of common FSc/MDCAT Biology terms.
_BIO_TERM_UR = re.compile(
    r"(?:"
    r"اینڈوسکیلیٹن|ایگزوسکیلیٹن|اینڈو\s*اسکیلیٹن|ایگزو\s*اسکیلیٹن|"
    r"اسکیلیٹن|ہائڈرو\s*اسٹیٹک|خلیہ|خلیوں|کروموسوم|جین|انزائم|"
    r"ہارمون|بیکٹیریا|وائرس|پروٹین|وٹامن|تنفس|حیاتیات|"
    r"مائٹوسس|نیوکلئس|ممبرین|آرگن|ٹشو"
    r")",
    re.UNICODE | re.IGNORECASE,
)

_BIO_HINT = _BIO_TERM_EN


def _has_bio_term(text: str) -> bool:
    q = text or ""
    return bool(_BIO_TERM_EN.search(q) or _BIO_TERM_UR.search(q))


def looks_like_social_talk(question: str) -> bool:
    """True when the whole message is a greeting, thanks, or small talk."""
    q = (question or "").strip()
    if not q:
        return True
    return bool(_SOCIAL_FULL.match(q))


def is_course_related(
    question: str,
    *,
    history: Optional[list[dict]] = None,
    has_mcq: bool = False,
    mcq_context: str = "",
) -> bool:
    """Fast YES/NO gate so off-topic prompts never get a full tutoring answer."""
    q = (question or "").strip()
    if not q:
        return False
    if looks_like_social_talk(q):
        return False

    # Recognized Biology vocabulary (English or Urdu transliteration) → on course.
    if _has_bio_term(q):
        return True

    # Follow-ups during an MCQ or tutoring chat ("why?", "فرق بتا دیں", etc.).
    if (has_mcq or history or mcq_context.strip()) and _BIO_FOLLOWUP.search(q):
        return True

    history_bits = ""
    if history:
        recent = history[-3:]
        history_bits = "\n".join(
            f"{t.get('role', 'user')}: {t.get('content', '')}" for t in recent
        )
        history_bits = f"\nRecent conversation:\n{history_bits}\n"

    mcq_bits = ""
    if mcq_context.strip():
        mcq_bits = f"\nMCQ on screen:\n{mcq_context.strip()}\n"

    user = f"""{mcq_bits}{history_bits}Student message: {q}

Is this about FSc/MDCAT Biology course material? Reply YES or NO only.
Greetings, thanks, and small talk are NO."""

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
        # Greetings/tiny chat stay closed. Substantial Biology-looking
        # questions still fail open so a gate outage does not block tutoring.
        print(f"  [topic-gate] failed: {type(exc).__name__}")
        if _has_bio_term(q) or ((has_mcq or history) and _BIO_FOLLOWUP.search(q)):
            return True
        if len(q.split()) <= 3:
            return False
        return True


def is_off_topic_answer(text: str) -> bool:
    """Detect the fixed redirect phrase (or close variants) in a model reply."""
    raw = text or ""
    t = raw.lower()
    return (
        "ask a relevant" in t
        or "ask me something from your course" in t
        or "relevant biology question" in t
        or "اپنے کورس سے کچھ پوچھ" in raw
        or "relevant Biology question پوچھ" in raw
    )


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
        "CRITICAL: Proper bilingual only. Urdu is glue words. Every science word "
        "(intestine, large intestine, stomach, liver, pancreas, vitamin, bacteria, "
        "nucleus, electron, energy, alpha, beta, gamma, electromagnetic, "
        "hydrogen, oxygen, molecule, DNA, ATP, and so on) MUST stay English "
        "Latin letters. Never write آنت, آنتیں, امعاء, انٹسٹائن, انٹیسٹائن, "
        "معدہ, جگر, لبلبہ, وٹامن, بیکٹیریا, توانائی, الفا, بیٹا, گاما, "
        "or برقی مقناطیسی. Formulas MUST be O2, H2O, CO2 — never O دو or H دو O. "
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
                "Now restate this exact answer in PROPER bilingual classroom Urdu "
                "(Urdu glue + English Latin science words). Write intestine, vitamin, "
                "bacteria — never آنت, انٹسٹائن, وٹامن, or بیکٹیریا. Keep formulas as "
                "O2, H2O, CO2 — never Urdu digits inside a formula. Start immediately. "
                "No greeting.\n"
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
    ("امعاے صغریٰ", "small intestine"),
    ("امعاے کبریٰ", "large intestine"),
    ("امعاء صغری", "small intestine"),
    ("امعاء کبری", "large intestine"),
    ("چھوٹی آنت", "small intestine"),
    ("بڑی آنت", "large intestine"),
    ("غذائی نالی", "oesophagus"),
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
    ("بیکٹیریا", "bacteria"),
    ("وائرس", "virus"),
    ("مائٹوکونڈریا", "mitochondria"),
    ("کلوروفل", "chlorophyll"),
    ("کلوروپلاسٹ", "chloroplast"),
    ("ڈی این اے", "DNA"),
    ("آر این اے", "RNA"),
    ("اے ٹی پی", "ATP"),
    ("انٹیسٹائن", "intestine"),
    ("انٹسٹائن", "intestine"),
    ("انٹیسٹین", "intestine"),
    ("انٹسٹین", "intestine"),
    ("آنتیں", "intestines"),
    ("آنت", "intestine"),
    ("امعاے", "intestine"),
    ("امعاء", "intestine"),
    ("امعہ", "intestine"),
    ("معدہ", "stomach"),
    ("لبلبہ", "pancreas"),
    ("پتتاشے", "gallbladder"),
    ("پھیپھڑے", "lungs"),
    ("پھیپھڑا", "lung"),
    ("گردے", "kidneys"),
    ("گردہ", "kidney"),
    ("ہاضمہ", "digestion"),
    ("تنفس", "respiration"),
    ("صفرا", "bile"),
    ("وٹامن", "vitamin"),
    ("جگر", "liver"),
    ("تعدد", "frequency"),
    ("انحطاط", "decay"),
    ("نیم مائعہ", "semi-liquid"),
    ("نیم مائع", "semi-liquid"),
    ("نیم مادہ", "semi-liquid"),
    ("نیم مادی", "semi-solid"),
    ("کیموس", "chyme"),
    ("کائم", "chyme"),
    ("بلغم", "mucus"),
    ("میوکس", "mucus"),
    ("میوکوس", "mucus"),
    ("بلوس", "bolus"),
    ("لقمہ", "bolus"),
    ("مائع", "liquid"),
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
            "آنت",
            "امعاء",
            "امعہ",
            "امعاے",
            "انٹسٹائن",
            "انٹیسٹائن",
            "انٹسٹین",
            "انٹیسٹین",
            "معدہ",
            "لبلبہ",
            "غذائی نالی",
            "ہاضمہ",
            "وٹامن",
            "نیم مائع",
            "نیم مادہ",
            "کیموس",
            "بلغم",
            "بلوس",
            "میوکس",
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


def strip_brackets_for_speech(text: str) -> str:
    """Drop parenthetical asides so TTS does not speak (NK) or (second line)."""
    cleaned = text or ""
    for _ in range(3):
        nxt = re.sub(r"[\(\（][^()（）]*[\)\）]", " ", cleaned)
        if nxt == cleaned:
            break
        cleaned = nxt
    cleaned = re.sub(r"\[[^\[\]]*\]", " ", cleaned)
    cleaned = re.sub(r"\s+([,.!?;:۔])", r"\1", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def sanitize_speech_narration(text: str) -> str:
    """Strip labels/greetings so TTS does not speak hallucinated warm-up first."""
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    cleaned = strip_brackets_for_speech(cleaned)
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
    cleaned = strip_brackets_for_speech(text or "")
    cleaned = re.sub(r"[*_#`>]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()
