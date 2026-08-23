"use client";

import { useMemo } from "react";
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
import { useStudentId } from "@/lib/useStudent";
import { accuracyTone, trendLabel } from "@/lib/trends";
import { useQuery } from "@tanstack/react-query";

export default function WeakSpotsPage() {
  const studentId = useStudentId();

  const spotsQuery = useQuery({
    queryKey: ["weak-spots", studentId],
    queryFn: () => api.getWeakSpots(studentId!),
    enabled: !!studentId,
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
    const stable = spots.filter((s) => s.accuracy_pct >= 65);
    return { critical, attention, stable };
  }, [spots]);

  const topCritical = groups.critical[0] || spots[0];

  return (
    <>
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#F4F7FB] lg:min-h-dvh">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-brand-700 sm:text-4xl">
                Weak Spots
              </h1>
              <p className="mt-2 text-sm text-slate-500 sm:text-base">
                Chapters where your accuracy is lowest — drill these first.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {topCritical && (
                <Link
                  href={drillHref(topCritical)}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  Drill weakest
                </Link>
              )}
            </div>
          </div>

          {loading && (
            <div className="mt-12 space-y-4">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-2xl bg-white shadow-sm"
                />
              ))}
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
                No weak spots yet — complete at least 3 MCQs in a chapter and
                we&apos;ll rank your accuracy here.
              </p>
              <Link href="/practice" className="btn-primary mt-4 inline-flex">
                Start chapter practice
              </Link>
            </div>
          )}

          {!loading && spots.length > 0 && (
            <div className="mt-8 space-y-8">
              <SpotGroup title="CRITICAL" color="red" spots={groups.critical} />
              <SpotGroup
                title="NEEDS ATTENTION"
                color="amber"
                spots={groups.attention}
              />
              <SpotGroup title="ON TRACK" color="green" spots={groups.stable} />

              {topCritical && (
                <div className="relative overflow-hidden rounded-2xl bg-brand-700 p-6 text-white shadow-sm sm:p-7">
                  <div
                    className="pointer-events-none absolute -right-8 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full border-[14px] border-sky-300/20"
                    aria-hidden
                  />
                  <p className="text-xs font-bold tracking-wider text-sky-200">
                    TODAY&apos;S FOCUS
                  </p>
                  <h2 className="mt-3 max-w-xl font-display text-2xl font-bold leading-snug">
                    Drill {topCritical.chapter || topCritical.concept} next
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-sky-100/90">
                    {topCritical.accuracy_pct}% accuracy across{" "}
                    {topCritical.attempts} attempts
                    {topCritical.trend === "getting_worse"
                      ? " — and it's slipping. "
                      : ". "}
                    A focused chapter session will close the gap fastest.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <Link
                      href={drillHref(topCritical)}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-brand"
                    >
                      <Zap className="h-4 w-4" />
                      Start drilling
                    </Link>
                    <Link
                      href="/weekly-plan"
                      className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-white/15"
                    >
                      <Sparkles className="h-4 w-4" />
                      Weekly plan
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function drillHref(spot: WeakSpot): string {
  const chapter = spot.chapter || spot.concept;
  if (chapter) {
    return `/session?mode=chapter&chapter=${encodeURIComponent(chapter)}`;
  }
  if (spot.concept_id) {
    return `/session?concept_id=${spot.concept_id}&mode=drill`;
  }
  return "/practice";
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
          const label = s.chapter || s.concept || "Biology";

          return (
            <div
              key={`${s.chapter || s.concept_id || label}`}
              className={`rounded-2xl border border-slate-100 border-l-4 bg-white p-5 shadow-sm ${borderColor}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Chapter
                  </p>
                  <h3 className="mt-1 min-w-0 break-words font-semibold leading-snug text-slate-900">
                    {label}
                  </h3>
                  <p
                    className={`mt-2 text-sm font-semibold tabular-nums ${accuracyTone(s.accuracy_pct)}`}
                  >
                    {s.accuracy_pct}% accuracy
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {s.attempts} attempts · {trendLabel(s.trend)}
                  </p>
                </div>
                <TrendIcon className={`h-4 w-4 shrink-0 ${trendColor}`} />
              </div>

              <div className="mt-4 flex items-end justify-end">
                <Link
                  href={drillHref(s)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Drill chapter
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
