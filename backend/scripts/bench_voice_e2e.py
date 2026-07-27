"""Full voice round trip: synthesize an Urdu question, send it through the
voice endpoints, and time until narration audio starts.

Uses Uplift TTS to fabricate the student's spoken question so we can exercise
STT -> RAG -> LLM -> TTS without a microphone.
"""
from __future__ import annotations

import asyncio
import base64
import time

import httpx

from app import voice

BASE = "http://127.0.0.1:8000"
SPOKEN_QUESTION = "مائٹوکانڈریا کا کام کیا ہے؟ تفصیل سے بتائیں"


async def make_clip() -> bytes:
    b64 = await voice.text_to_speech(SPOKEN_QUESTION)
    if not b64:
        raise SystemExit("could not synthesize the test question")
    return base64.b64decode(b64)


async def run(http: httpx.AsyncClient, path: str, clip: bytes, data: dict) -> None:
    start = time.perf_counter()
    res = await http.post(
        f"{BASE}{path}",
        files={"audio": ("question.mp3", clip, "audio/mpeg")},
        data=data,
    )
    t_text = time.perf_counter() - start
    payload = res.json()

    print(f"--- {path} ---")
    print(f"  status        : {res.status_code}")
    print(f"  text ready    : {t_text:5.2f}s")
    print(f"  transcript    : {(payload.get('transcript') or '')[:70]!r}")
    print(f"  answer        : {(payload.get('answer') or '')[:90]!r}")
    if payload.get("error"):
        print(f"  error         : {payload['error']}")

    urdu = payload.get("urdu_text") or ""
    print(f"  urdu is script: {any(0x0600 <= ord(c) <= 0x06FF for c in urdu)}")

    speech_id = payload.get("speech_id")
    if not speech_id:
        print("  speech_id     : MISSING")
        return
    start = time.perf_counter()
    async with http.stream("GET", f"{BASE}/api/tts-stream/{speech_id}") as resp:
        async for chunk in resp.aiter_bytes():
            if chunk:
                break
    ttfb = time.perf_counter() - start
    print(f"  audio starts  : {t_text + ttfb:5.2f}s  (tts ttfb {ttfb:.2f}s)")


async def main() -> None:
    clip = await make_clip()
    print(f"test clip: {len(clip)} bytes\n")
    async with httpx.AsyncClient(timeout=120) as http:
        await run(http, "/api/rag/ask-voice", clip, {"top_k": "3"})
        print()
        await run(http, "/api/ask-voice", clip, {"concept": "Cell Structure"})


if __name__ == "__main__":
    asyncio.run(main())
