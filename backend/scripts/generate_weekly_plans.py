"""Generate weekly study plans for every student.

Run every Sunday night (cron / scheduled task):
    python -m scripts.generate_weekly_plans
"""
from __future__ import annotations

import sys

sys.path.append(".")

from app.config import settings  # noqa: E402
from app.db import require_client  # noqa: E402
from app.planner import generate_plan  # noqa: E402


def main() -> None:
    if not settings.supabase_ready:
        sys.exit("SUPABASE_URL/SUPABASE_KEY must be set in .env")

    students = require_client().table("students").select("id").execute().data
    for s in students:
        generate_plan(s["id"])
        print(f"  plan generated for {s['id']}")
    print(f"\nDone. {len(students)} plans.")


if __name__ == "__main__":
    main()
