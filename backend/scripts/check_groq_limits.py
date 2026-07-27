"""Show the Groq quota picture for the configured model.

Per-minute limits come back in headers; the per-DAY token limit only appears in
the body of a 429, so this sends a realistically sized request to surface it.
"""
from __future__ import annotations

import httpx

from app import llm, rag
from app.config import settings

INTERESTING = (
    "x-ratelimit-limit-requests",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-reset-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-tokens",
    "retry-after",
)

QUERY = "explain the function of mitochondria in detail"


def main() -> None:
    context = rag.retrieve_context(QUERY, top_k=3)["context"]
    user_prompt = llm._ask_user_prompt("Cell Structure", QUERY, context)
    system_prompt = llm.ASK_BILINGUAL_SYSTEM_PROMPT

    print(f"model            : {settings.LLM_MODEL}")
    print(f"context chars    : {len(context)}")
    print(f"approx in-tokens : ~{(len(system_prompt) + len(user_prompt)) // 4}")

    res = httpx.post(
        f"{settings.GROQ_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
        json={
            "model": settings.LLM_MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": 600,
            "temperature": 0.3,
        },
        timeout=60,
    )
    print(f"status           : {res.status_code}\n")
    for key in INTERESTING:
        if key in res.headers:
            print(f"  {key:<34}{res.headers[key]}")

    if res.status_code == 200:
        usage = res.json().get("usage", {})
        total = usage.get("total_tokens")
        print(f"\nusage: {usage}")
        if total:
            print(f"~{100_000 // total} questions/day against a 100k token/day cap")
    else:
        print(f"\nbody: {res.text[:900]}")


if __name__ == "__main__":
    main()
