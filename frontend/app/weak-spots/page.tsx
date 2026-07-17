"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Play, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { api, type WeakSpot } from "@/lib/api";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

const TREND_ICON: Record<string, typeof TrendingUp> = {
  improving: TrendingUp,
  stuck: Minus,
  getting_worse: TrendingDown,
};

const TREND_LABEL: Record<string, string> = {
  improving: "Improving",
  stuck: "Stuck",
  getting_worse: "Getting worse",
};

export default function WeakSpotsPage() {
  const router = useRouter();
  const [spots, setSpots] = useState<WeakSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = getStudentId();
    if (!id) {
      router.replace("/");
      return;
    }
    api
      .getWeakSpots(id)
      .then(setSpots)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <Navbar>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Weak Spots</h1>
            <p className="text-sm text-slate-500">Ranked by priority</p>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </header>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {!loading && spots.length === 0 && (
          <div className="rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
            <p className="text-slate-500">No weak spots yet. Complete a study session first.</p>
            <Link href="/session" className="btn-primary mt-4 inline-flex">
              Start a session
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {spots.map((s) => {
            const TrendIcon = TREND_ICON[s.trend] || Minus;
            return (
              <div
                key={s.concept_id}
                className={`rounded-2xl border bg-white p-5 shadow-sm ${
                  s.color === "red"
                    ? "border-l-4 border-l-red-500"
                    : s.color === "amber"
                    ? "border-l-4 border-l-amber-500"
                    : "border-l-4 border-l-green-500"
                } border-t border-r border-b border-t-slate-100 border-r-slate-100 border-b-slate-100`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-slate-800">{s.concept}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{s.chapter}</p>
                  </div>
                  <span
                    className={`text-lg font-bold ${
                      s.accuracy_pct >= 70
                        ? "text-accent-green"
                        : s.accuracy_pct >= 40
                        ? "text-accent-amber"
                        : "text-accent-red"
                    }`}
                  >
                    {s.accuracy_pct}%
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <TrendIcon className="h-3.5 w-3.5" />
                    <span>
                      {s.attempts} attempts · {TREND_LABEL[s.trend]}
                    </span>
                  </div>
                  <Link
                    href={`/session?concept_id=${s.concept_id}&mode=drill`}
                    className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-dark"
                  >
                    <Play className="h-3 w-3" /> Drill
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Navbar>
  );
}
