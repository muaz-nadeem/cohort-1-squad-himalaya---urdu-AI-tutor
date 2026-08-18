"""Voice pipeline: STT (speech -> Urdu text) and TTS (text -> MP3).

TTS provider: Uplift Orator (active) / ElevenLabs (commented out, needs paid plan).
STT: Uplift STT first, Groq Whisper fallback.
"""
from __future__ import annotations

import asyncio
import base64
import io
import re
import sys
from typing import Optional

import httpx

from .config import settings
from .llm import get_groq_client


def _safe_print(msg: str) -> None:
    """Print text safely on Windows consoles that cannot encode Urdu (cp1252)."""
    try:
        ascii_msg = msg.encode("ascii", errors="backslashreplace").decode("ascii")
        print(ascii_msg, flush=True)
    except Exception:
        try:
            sys.stderr.write("[stt/tts log suppressed]\n")
        except Exception:
            pass


def _guess_mime(filename: str) -> str:
    name = (filename or "").lower()
    if name.endswith(".wav"):
        return "audio/wav"
    if name.endswith(".mp3"):
        return "audio/mpeg"
    if name.endswith(".ogg"):
        return "audio/ogg"
    if name.endswith(".m4a") or name.endswith(".mp4"):
        return "audio/mp4"
    return "audio/webm"


# ===========================================================================
# STT — Speech-to-Text (Uplift -> Whisper fallback)
# ===========================================================================

async def speech_to_text(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Transcribe audio (Urdu/English). Uplift STT first, Whisper fallback."""
    if not audio_bytes or len(audio_bytes) < 500:
        _safe_print(f"  [stt] audio too small ({len(audio_bytes) if audio_bytes else 0} bytes)")
        return ""

    _safe_print(f"  [stt] starting transcription ({len(audio_bytes)} bytes, {filename})")

    try:
        transcript = await _uplift_stt(audio_bytes, filename)
        if transcript and transcript.strip():
            _safe_print(f"  [stt] Uplift success ({len(transcript)} chars)")
            return transcript.strip()
    except Exception as exc:
        _safe_print(f"  [stt] Uplift unexpected: {type(exc).__name__}: {exc}")

    _safe_print("  [stt] Uplift failed/empty, trying Groq Whisper...")
    try:
        # Whisper via the Groq SDK is synchronous; run it off the event loop so
        # it doesn't block other requests while transcribing.
        transcript = await asyncio.get_event_loop().run_in_executor(
            None, _whisper_stt, audio_bytes, filename
        )
        if transcript and transcript.strip():
            _safe_print(f"  [stt] Whisper success ({len(transcript)} chars)")
            return transcript.strip()
    except Exception as exc:
        _safe_print(f"  [stt] Whisper unexpected: {type(exc).__name__}: {exc}")

    _safe_print("  [stt] Both STT engines returned empty")
    return ""


async def _uplift_stt(audio_bytes: bytes, filename: str) -> str:
    if not settings.uplift_ready:
        _safe_print("  [stt] Uplift not configured (no UPLIFT_API_KEY)")
        return ""
    mime = _guess_mime(filename)
    try:
        # Keep this short: on timeout we fall straight through to Whisper, so a
        # slow Uplift response shouldn't dominate perceived STT latency.
        async with httpx.AsyncClient(timeout=6) as http:
            resp = await http.post(
                f"{settings.UPLIFT_BASE}/transcriptions",
                headers={"Authorization": f"Bearer {settings.UPLIFT_API_KEY}"},
                files={"file": (filename, audio_bytes, mime)},
                data={"model": "uplift-stt-1"},
            )
        if resp.status_code == 200:
            data = resp.json()
            return (data.get("text") or data.get("transcript") or "") or ""
        _safe_print(f"  [stt] Uplift returned {resp.status_code}: {resp.text[:200]}")
    except httpx.TimeoutException:
        _safe_print("  [stt] Uplift STT timed out (6s), falling back to Whisper")
    except httpx.HTTPError as exc:
        _safe_print(f"  [stt] Uplift HTTP error: {type(exc).__name__}: {exc}")
    except Exception as exc:
        _safe_print(f"  [stt] Uplift error: {type(exc).__name__}: {exc}")
    return ""


def _whisper_stt(audio_bytes: bytes, filename: str) -> str:
    if not settings.groq_ready:
        _safe_print("  [stt] Groq not configured (no GROQ_API_KEY)")
        return ""
    try:
        client = get_groq_client()
        buffer = io.BytesIO(audio_bytes)
        buffer.name = filename
        result = client.audio.transcriptions.create(
            model=settings.WHISPER_MODEL,
            file=buffer,
        )
        return getattr(result, "text", "") or ""
    except Exception as exc:
        _safe_print(f"  [stt] Whisper error: {type(exc).__name__}: {exc}")
        return ""


# ===========================================================================
# TTS helpers
# ===========================================================================

_DIGIT_WORDS = {
    "0": "zero",
    "1": "one",
    "2": "two",
    "3": "three",
    "4": "four",
    "5": "five",
    "6": "six",
    "7": "seven",
    "8": "eight",
    "9": "nine",
}

_SUBSCRIPT_MAP = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
# Urdu-Indic + Arabic-Indic digits → ASCII so O۲ / H٢O expand like O2 / H2O.
_URDU_DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

# Longest-first so آٹھ / پانچ match before shorter words.
_URDU_NUM_WORDS = (
    ("صفر", "zero"),
    ("آٹھ", "eight"),
    ("پانچ", "five"),
    ("تین", "three"),
    ("چار", "four"),
    ("سات", "seven"),
    ("ایک", "one"),
    ("چھ", "six"),
    ("نو", "nine"),
    ("دس", "ten"),
    ("دو", "two"),
)
_URDU_NUM_PATTERN = "|".join(re.escape(word) for word, _ in _URDU_NUM_WORDS)
_URDU_NUM_LOOKUP = dict(_URDU_NUM_WORDS)


def _english_digit_words(digits: str) -> str:
    return " ".join(_DIGIT_WORDS.get(ch, ch) for ch in digits)


def _expand_formula_match(match: re.Match[str]) -> str:
    """O2 / H2O / CO2 → spoken English letters/digits so Urdu TTS does not say 'do'."""
    token = match.group(0)
    parts: list[str] = []
    for piece in re.findall(r"[A-Z][a-z]?|\d+|[+\-]", token):
        if piece.isdigit():
            parts.append(_english_digit_words(piece))
        elif piece == "+":
            parts.append("plus")
        elif piece == "-":
            parts.append("minus")
        else:
            parts.append(piece)
    return " ".join(parts)


def _expand_urdu_formula_numbers(speak: str) -> str:
    """O دو / H دو O → O two / H two O (only next to element symbols)."""

    def repl(match: re.Match[str]) -> str:
        left = match.group(1)
        word = _URDU_NUM_LOOKUP.get(match.group(2), match.group(2))
        right = match.group(3) or ""
        return f"{left} {word} {right}".strip()

    return re.sub(
        rf"(?<![A-Za-z])([A-Za-z]{{1,2}})\s*({_URDU_NUM_PATTERN})"
        rf"(?:\s*([A-Za-z]{{1,2}}))?(?![A-Za-z])",
        repl,
        speak,
    )


def prepare_bilingual_tts(text: str) -> str:
    """Keep science formulas in English while the rest of the line stays Urdu."""
    speak = (text or "").strip()
    if not speak:
        return ""
    speak = speak.translate(_SUBSCRIPT_MAP)
    speak = speak.translate(_URDU_DIGIT_MAP)
    speak = _expand_urdu_formula_numbers(speak)
    # Only rewrite tokens that mix letters and digits (O2, H2O, CO2, n2, Fe2+).
    speak = re.sub(
        r"(?<![A-Za-z])(?:[A-Z][a-z]?\d*){1,8}[+\-]?(?![A-Za-z])",
        lambda m: _expand_formula_match(m) if re.search(r"\d", m.group(0)) else m.group(0),
        speak,
    )
    speak = re.sub(
        r"\b([A-Za-z]{1,8})(\d+)\b",
        lambda m: f"{m.group(1)} {_english_digit_words(m.group(2))}",
        speak,
    )
    speak = re.sub(r"\s+", " ", speak).strip()
    return speak


def clean_for_tts(text: str, limit: int = 600) -> str:
    """Prepare bilingual narration, then trim so synthesis stays fast."""
    speak = prepare_bilingual_tts(text)
    if len(speak) > limit:
        speak = speak[:limit].rsplit(" ", 1)[0] + "..."
    return speak


# ===========================================================================
# Uplift Orator TTS (active)
# ===========================================================================

async def stream_tts(text: str, output_format: str = "MP3_22050_32"):
    """Yield MP3 chunks from Uplift's streaming endpoint as they arrive.

    Streaming lets the browser start playing in well under a second instead of
    waiting for the whole file, which is the bulk of perceived voice latency.
    """
    if not settings.uplift_ready or not text:
        return
    speak = clean_for_tts(text)
    try:
        async with httpx.AsyncClient(timeout=60) as http:
            async with http.stream(
                "POST",
                f"{settings.UPLIFT_BASE}/synthesis/text-to-speech/stream",
                headers={
                    "Authorization": f"Bearer {settings.UPLIFT_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "voiceId": settings.UPLIFT_VOICE_ID,
                    "text": speak,
                    "outputFormat": output_format,
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    _safe_print(
                        f"  [tts-stream] Uplift {response.status_code}: {body[:200]!r}"
                    )
                    return
                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk
    except httpx.TimeoutException:
        _safe_print("  [tts-stream] timed out")
    except Exception as exc:
        _safe_print(f"  [tts-stream] error: {type(exc).__name__}: {exc}")


async def text_to_speech(text: str) -> Optional[str]:
    """Synthesise Urdu speech via Uplift Orator, return base64 MP3 (or None)."""
    if not settings.uplift_ready or not text:
        return None
    speak = clean_for_tts(text, limit=800)
    if not speak:
        return None
    try:
        async with httpx.AsyncClient(timeout=45) as http:
            response = await http.post(
                f"{settings.UPLIFT_BASE}/synthesis/text-to-speech",
                headers={
                    "Authorization": f"Bearer {settings.UPLIFT_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "voiceId": settings.UPLIFT_VOICE_ID,
                    "text": speak,
                    "outputFormat": "MP3_22050_64",
                },
            )
        if response.status_code == 200 and response.content:
            return base64.b64encode(response.content).decode("utf-8")
        _safe_print(f"  [tts] Uplift returned {response.status_code}: {response.text[:200]}")
    except httpx.TimeoutException:
        _safe_print("  [tts] Uplift TTS timed out (45s)")
    except httpx.HTTPError as exc:
        _safe_print(f"  [tts] Uplift HTTP error: {type(exc).__name__}: {exc}")
    except Exception as exc:
        _safe_print(f"  [tts] error: {type(exc).__name__}: {exc}")
    return None


# ===========================================================================
# ElevenLabs TTS (commented out — needs paid plan for library voices)
# To switch: uncomment this block, comment out the Uplift block above,
# and set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID in .env
# ===========================================================================
#
# async def stream_tts(text: str, output_format: str = "mp3_22050_32"):
#     """Yield MP3 chunks from ElevenLabs streaming endpoint as they arrive."""
#     if not settings.elevenlabs_ready or not text:
#         return
#     speak = clean_for_tts(text)
#     voice_id = settings.ELEVENLABS_VOICE_ID
#     url = f"{settings.ELEVENLABS_BASE}/text-to-speech/{voice_id}/stream"
#     try:
#         async with httpx.AsyncClient(timeout=60) as http:
#             async with http.stream(
#                 "POST",
#                 url,
#                 headers={
#                     "xi-api-key": settings.ELEVENLABS_API_KEY,
#                     "Content-Type": "application/json",
#                 },
#                 json={
#                     "text": speak,
#                     "model_id": settings.ELEVENLABS_MODEL,
#                     "voice_settings": {
#                         "stability": 0.5,
#                         "similarity_boost": 0.75,
#                     },
#                 },
#                 params={"output_format": output_format},
#             ) as response:
#                 if response.status_code != 200:
#                     body = await response.aread()
#                     _safe_print(
#                         f"  [tts-stream] ElevenLabs {response.status_code}: {body[:200]!r}"
#                     )
#                     return
#                 async for chunk in response.aiter_bytes():
#                     if chunk:
#                         yield chunk
#     except httpx.TimeoutException:
#         _safe_print("  [tts-stream] timed out")
#     except Exception as exc:
#         _safe_print(f"  [tts-stream] error: {type(exc).__name__}: {exc}")
#
#
# async def text_to_speech(text: str) -> Optional[str]:
#     """Synthesise speech via ElevenLabs, return base64 MP3 (or None)."""
#     if not settings.elevenlabs_ready or not text:
#         return None
#     speak = text.strip()
#     if len(speak) > 800:
#         speak = speak[:800].rsplit(" ", 1)[0] + "..."
#     voice_id = settings.ELEVENLABS_VOICE_ID
#     url = f"{settings.ELEVENLABS_BASE}/text-to-speech/{voice_id}"
#     try:
#         async with httpx.AsyncClient(timeout=45) as http:
#             response = await http.post(
#                 url,
#                 headers={
#                     "xi-api-key": settings.ELEVENLABS_API_KEY,
#                     "Content-Type": "application/json",
#                 },
#                 json={
#                     "text": speak,
#                     "model_id": settings.ELEVENLABS_MODEL,
#                     "voice_settings": {
#                         "stability": 0.5,
#                         "similarity_boost": 0.75,
#                     },
#                 },
#                 params={"output_format": "mp3_22050_32"},
#             )
#         if response.status_code == 200 and response.content:
#             return base64.b64encode(response.content).decode("utf-8")
#         _safe_print(f"  [tts] ElevenLabs returned {response.status_code}: {response.text[:200]}")
#     except httpx.TimeoutException:
#         _safe_print("  [tts] ElevenLabs TTS timed out (45s)")
#     except httpx.HTTPError as exc:
#         _safe_print(f"  [tts] ElevenLabs HTTP error: {type(exc).__name__}: {exc}")
#     except Exception as exc:
#         _safe_print(f"  [tts] error: {type(exc).__name__}: {exc}")
#     return None
