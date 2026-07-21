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
    transcript = await _uplift_stt(audio_bytes, filename)
    if transcript:
        return transcript
    return _whisper_stt(audio_bytes, filename)


async def _uplift_stt(audio_bytes: bytes, filename: str) -> str:
    if not settings.uplift_ready:
        return ""
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{settings.UPLIFT_BASE}/transcriptions",
                headers={"Authorization": f"Bearer {settings.UPLIFT_API_KEY}"},
                files={"file": (filename, audio_bytes, "audio/webm")},
                data={"model": "uplift-stt-1"},
            )
        if resp.status_code == 200:
            return resp.json().get("text", "") or ""
    except httpx.HTTPError:
        pass
    return ""


def _whisper_stt(audio_bytes: bytes, filename: str) -> str:
    if not settings.groq_ready:
        return ""
    try:
        client = get_groq_client()
        buffer = io.BytesIO(audio_bytes)
        buffer.name = filename
        result = client.audio.transcriptions.create(
            model=settings.WHISPER_MODEL, file=buffer, language="ur"
        )
        return getattr(result, "text", "") or ""
    except Exception:
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
    except httpx.HTTPError:
        pass
    return None
