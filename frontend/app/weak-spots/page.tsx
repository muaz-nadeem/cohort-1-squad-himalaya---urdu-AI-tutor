"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Minus,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { api, type WeakSpot } from "@/lib/api";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";
import { useQuery } from "@tanstack/react-query";

export default function WeakSpotsPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    const id = getStudentId();
    if (!id) {
      router.replace("/login");
      return;
    }
    setStudentId(id);
  }, [router]);

  const spotsQuery = useQuery({
    queryKey: ["weak-spots", studentId],
    queryFn: () => api.getWeakSpots(studentId!),
    enabled: !!studentId,
    staleTime: 60_000,
  });

  const spots = spotsQuery.data ?? [];
  const loading = spotsQuery.isLoading && spots.length === 0;
  const error =
    spotsQuery.error instanceof Error
      ? spotsQuery.error.message
      : spotsQuery.error
        ? "Failed to load"
        : "";

  const groups = useMemo(() => {
    const critical = spots.filter((s) => s.accuracy_pct < 40);
    const attention = spots.filter(
      (s) => s.accuracy_pct >= 40 && s.accuracy_pct < 65
    );
    const stable = spots.filter(
      (s) => s.accuracy_pct >= 65 && s.accuracy_pct < 80
    );
    return { critical, attention, stable };
  }, [spots]);

  const topCritical = groups.critical[0] || spots[0];

  return (
    <Navbar>
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#F4F7FB] lg:min-h-screen">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
                Weak Spots Analysis
              </h1>
              <p className="mt-2 text-sm text-slate-500 sm:text-base">
                Targeted focus on the concepts you keep missing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {topCritical && (
                <Link
                  href={`/session?concept_id=${topCritical.concept_id}&mode=drill`}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Drill All
                </Link>
              )}
            </div>
          </div>

          {loading && (
            <div className="mt-12 flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {!loading && spots.length === 0 && (
            <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
              <p className="text-slate-500">
                No weak spots yet. Complete a study session first.
              </p>
              <Link href="/practice" className="btn-primary mt-4 inline-flex">
                Start chapter practice
              </Link>
            </div>
          )}

          {!loading && spots.length > 0 && (
            <div className="mt-8 space-y-8">
              <SpotGroup
                title="CRITICAL"
                color="red"
                spots={groups.critical}
              />
              <SpotGroup
                title="NEEDS ATTENTION"
                color="amber"
                spots={groups.attention}
              />
              <SpotGroup
                title="STABLE"
                color="green"
                spots={groups.stable}
              />

              {topCritical && (
                <div className="relative overflow-hidden rounded-2xl bg-brand-700 p-6 text-white shadow-sm sm:p-7">
                  <div
                    className="pointer-events-none absolute -right-8 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full border-[14px] border-sky-300/20"
                    aria-hidden
                  />
                  <p className="text-xs font-bold tracking-wider text-sky-200">
                    WEEKEND REVISION STRATEGY
                  </p>
                  <h2 className="mt-3 max-w-xl font-display text-2xl font-bold leading-snug">
                    Focus on {topCritical.concept} this weekend
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-sky-100/90">
                    You&apos;ve struggled with this concept across{" "}
                    {topCritical.attempts} attempts
                    {topCritical.chapter
                      ? ` in ${topCritical.chapter}`
                      : ""}
                    . A short drill plus textbook review will close the gap
                    fastest.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Link
                      href="/weekly-plan"
                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-brand"
                    >
                      <Sparkles className="h-4 w-4" />
                      Generate Study Plan
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Navbar>
  );
}

function SpotGroup({
  title,
  color,
  spots,
}: {
  title: string;
  color: "red" | "amber" | "green";
  spots: WeakSpot[];
}) {
  if (!spots.length) return null;

  const labelColor =
    color === "red"
      ? "text-red-500"
      : color === "amber"
        ? "text-amber-600"
        : "text-emerald-600";
  const borderColor =
    color === "red"
      ? "border-l-red-500"
      : color === "amber"
        ? "border-l-amber-500"
        : "border-l-emerald-500";
  return (
    <section>
      <h2 className={`mb-3 text-xs font-bold tracking-wider ${labelColor}`}>
        {title}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {spots.map((s) => {
          const TrendIcon =
            s.trend === "improving"
              ? TrendingUp
              : s.trend === "getting_worse"
                ? TrendingDown
                : Minus;
          const trendColor =
            s.trend === "improving"
              ? "text-emerald-500"
              : s.trend === "getting_worse"
                ? "text-red-500"
                : "text-slate-400";

          return (
            <div
              key={s.concept_id}
              className={`rounded-2xl border border-slate-100 border-l-4 bg-white p-5 shadow-sm ${borderColor}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Biology
                    {s.chapter ? ` · ${s.chapter}` : ""}
                  </p>
                  <h3 className="mt-1 font-semibold leading-snug text-slate-900">
                    {s.concept}
                  </h3>
                </div>
                <TrendIcon className={`h-4 w-4 shrink-0 ${trendColor}`} />
              </div>

              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-400">
                    {s.attempts} attempts
                  </p>
                </div>
                <Link
                  href={`/session?concept_id=${s.concept_id}&mode=drill`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Drill Concept
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
