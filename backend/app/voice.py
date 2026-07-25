"""Uplift AI voice pipeline: STT (speech -> Urdu text) and Orator TTS (text -> MP3).

Groq Whisper is used as the STT fallback when Uplift STT fails.
"""
from __future__ import annotations

import base64
import io
from typing import Optional

import httpx

from .config import settings
from .llm import get_groq_client


async def speech_to_text(audio_bytes: bytes, filename: str = "audio.webm") -> str:
    """Transcribe Urdu audio. Uplift STT first, Whisper fallback."""
    print(f"  [stt] starting transcription ({len(audio_bytes)} bytes, {filename})")

    transcript = await _uplift_stt(audio_bytes, filename)
    if transcript:
        print(f"  [stt] Uplift success: '{transcript[:60]}...'")
        return transcript

    print("  [stt] Uplift failed/empty, trying Groq Whisper...")
    transcript = _whisper_stt(audio_bytes, filename)
    if transcript:
        print(f"  [stt] Whisper success: '{transcript[:60]}...'")
    else:
        print("  [stt] Both STT engines returned empty")
    return transcript


async def _uplift_stt(audio_bytes: bytes, filename: str) -> str:
    if not settings.uplift_ready:
        print("  [stt] Uplift not configured (no UPLIFT_API_KEY)")
        return ""
    try:
        async with httpx.AsyncClient(timeout=45) as http:
            resp = await http.post(
                f"{settings.UPLIFT_BASE}/transcriptions",
                headers={"Authorization": f"Bearer {settings.UPLIFT_API_KEY}"},
                files={"file": (filename, audio_bytes, "audio/webm")},
                data={"model": "uplift-stt-1"},
            )
        if resp.status_code == 200:
            return resp.json().get("text", "") or ""
        print(f"  [stt] Uplift returned {resp.status_code}: {resp.text[:200]}")
    except httpx.TimeoutException:
        print("  [stt] Uplift STT timed out (45s)")
    except httpx.HTTPError as exc:
        print(f"  [stt] Uplift HTTP error: {type(exc).__name__}: {exc}")
    except Exception as exc:
        print(f"  [stt] Uplift error: {type(exc).__name__}: {exc}")
    return ""


def _whisper_stt(audio_bytes: bytes, filename: str) -> str:
    if not settings.groq_ready:
        print("  [stt] Groq not configured (no GROQ_API_KEY)")
        return ""
    try:
        client = get_groq_client()
        buffer = io.BytesIO(audio_bytes)
        buffer.name = filename
        result = client.audio.transcriptions.create(
            model=settings.WHISPER_MODEL, file=buffer, language="ur"
        )
        return getattr(result, "text", "") or ""
    except Exception as exc:
        print(f"  [stt] Whisper error: {type(exc).__name__}: {exc}")
        return ""


async def text_to_speech(text: str) -> Optional[str]:
    """Synthesise Urdu speech via Uplift Orator, return base64 MP3 (or None)."""
    if not settings.uplift_ready:
        return None
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            response = await http.post(
                f"{settings.UPLIFT_BASE}/synthesis/text-to-speech",
                headers={
                    "Authorization": f"Bearer {settings.UPLIFT_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={"text": text, "voice_id": settings.UPLIFT_VOICE_ID},
            )
        if response.status_code == 200:
            return base64.b64encode(response.content).decode("utf-8")
        print(f"  [tts] Uplift returned {response.status_code}")
    except httpx.TimeoutException:
        print("  [tts] Uplift TTS timed out (30s)")
    except httpx.HTTPError as exc:
        print(f"  [tts] Uplift HTTP error: {type(exc).__name__}: {exc}")
    except Exception as exc:
        print(f"  [tts] error: {type(exc).__name__}: {exc}")
    return None
