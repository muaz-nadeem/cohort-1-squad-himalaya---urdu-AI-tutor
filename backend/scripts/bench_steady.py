"""Steady-state latency for distinct questions (no cache hits)."""
from __future__ import annotations

import asyncio
import statistics
import time

import httpx

BASE = "http://127.0.0.1:8000"

QUESTIONS = [
    ("Cell Structure", "explain the function of mitochondria"),
    ("Enzymes", "why does temperature affect enzyme activity"),
    ("Bioenergetics", "explain the light dependent reactions"),
    ("Biological Molecules", "what makes a protein denature"),
]


async def one(http: httpx.AsyncClient, concept: str, question: str) -> tuple[float, float]:
    start = time.perf_counter()
    res = await http.post(
        f"{BASE}/api/ask",
        json={"concept": concept, "student_question": question, "speak": True},
    )
    t_text = time.perf_counter() - start
    data = res.json()

    if data.get("error"):
        print(f"  {question[:38]:<40} ERROR: {data['error']}")
        return t_text, t_text

    speech_id = data.get("speech_id")
    ttfb = 0.0
    if speech_id:
        start = time.perf_counter()
        async with http.stream("GET", f"{BASE}/api/tts-stream/{speech_id}") as resp:
            async for chunk in resp.aiter_bytes():
                if chunk:
                    ttfb = time.perf_counter() - start
                    break
    urdu = data.get("urdu_text") or ""
    ok = any(0x0600 <= ord(c) <= 0x06FF for c in urdu)
    print(
        f"  {question[:38]:<40} text {t_text:5.2f}s  audio@ {t_text + ttfb:5.2f}s  "
        f"urdu_ok={ok} speech={'yes' if speech_id else 'MISSING'}"
    )
    return t_text, t_text + ttfb


async def main() -> None:
    async with httpx.AsyncClient(timeout=120) as http:
        texts, audios = [], []
        for concept, question in QUESTIONS:
            t_text, t_audio = await one(http, concept, question)
            texts.append(t_text)
            audios.append(t_audio)
        print()
        print(f"median text ready  : {statistics.median(texts):5.2f}s")
        print(f"median audio start : {statistics.median(audios):5.2f}s")
        print(f"worst  audio start : {max(audios):5.2f}s")


if __name__ == "__main__":
    asyncio.run(main())
