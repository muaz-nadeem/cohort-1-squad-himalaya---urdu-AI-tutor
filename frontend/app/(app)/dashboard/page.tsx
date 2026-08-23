"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Clock,
  ClipboardList,
  Flame,
  MessageCircle,
  Settings2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, type WeakSpot } from "@/lib/api";
import { useStudentId, useStudentName } from "@/lib/useStudent";
import { CHAPTERS_QUERY } from "@/lib/queries";
import { accuracyTone } from "@/lib/trends";
import {
  pickDashboardResumeChapter,
  type DashboardResume,
} from "@/lib/chapterBatch";

export default function DashboardPage() {
  const studentId = useStudentId();
  const studentName = useStudentName();

  const dashQuery = useQuery({
    queryKey: ["dashboard", studentId],
    queryFn: () => api.getDashboard(studentId!),
    enabled: !!studentId,
  });

  const spotsQuery = useQuery({
    queryKey: ["weak-spots", studentId],
    queryFn: () => api.getWeakSpots(studentId!).catch(() => [] as WeakSpot[]),
    enabled: !!studentId,
  });

  // Warm the chapter catalogue so /practice and /custom-quiz open with no wait.
  const chaptersQuery = useQuery({ ...CHAPTERS_QUERY, enabled: !!studentId });
  const allChapters = chaptersQuery.data ?? [];

  const data = dashQuery.data ?? null;

  const statsByChapter = useMemo(() => {
    const map = new Map<string, { attempted: number; accuracy_pct?: number }>();
    for (const c of data?.chapters ?? []) {
      map.set(c.chapter, {
        attempted: c.attempted,
        accuracy_pct: c.accuracy_pct,
      });
    }
    return map;
  }, [data?.chapters]);

  const [resumeMission, setResumeMission] = useState<DashboardResume | null>(
    null
  );

  useEffect(() => {
    if (!studentId || !allChapters.length) {
      setResumeMission(null);
      return;
    }
    setResumeMission(
      pickDashboardResumeChapter(studentId, allChapters, statsByChapter)
    );
  }, [studentId, allChapters, statsByChapter]);

  const weakSpots = spotsQuery.data ?? [];
  // The page frame renders immediately; only the numbers wait on the request,
  // and they show a skeleton rather than a misleading zero.
  const pending = !data;
  const error =
    dashQuery.error instanceof Error
      ? dashQuery.error.message
      : dashQuery.error
        ? "Failed to load"
        : "";

  const greeting = getGreeting();
  const firstName = studentName.split(" ")[0];
  const daysToMdcat = getDaysToMdcat();
  const planItems = data?.daily_plan?.items || [];
  const primary = planItems[0];
  const hasPractice = (data?.total_attempted ?? 0) > 0;
  const focus = data?.focus || weakSpots[0] || null;
  const chapters = data?.chapters?.slice(0, 3) || [];
  const missionChapter = resumeMission?.chapter
    ? resumeMission.chapter
    : pending
      ? "Today's mission"
      : primary?.chapter ||
        focus?.chapter ||
        focus?.concept ||
        "Start Chapter Practice";
  const missionAccuracy =
    resumeMission?.chapter
      ? statsByChapter.get(resumeMission.chapter)?.accuracy_pct
      : focus?.accuracy_pct ??
        (primary?.chapter
          ? data?.chapters?.find((c) => c.chapter === primary.chapter)
              ?.accuracy_pct
          : undefined);
  const missionReason = resumeMission?.reason
    ? resumeMission.reason
    : pending
      ? "Pulling up your plan…"
      : primary?.reason ||
        (focus?.chapter && missionAccuracy != null
          ? `Do ${focus.chapter} — ${missionAccuracy}% accuracy. Keep drilling until it sticks.`
          : focus?.chapter || focus?.concept
            ? `Recommended today because ${focus.chapter || focus.concept} needs attention.`
            : "Pick a chapter and start MCQs. Wrong answers teach us your weak spots — then we adapt your plan.");
  const continueHref =
    resumeMission?.href ||
    (hasPractice
      ? primary?.chapter
        ? `/session?mode=chapter&chapter=${encodeURIComponent(primary.chapter)}`
        : focus?.chapter
          ? `/session?mode=chapter&chapter=${encodeURIComponent(focus.chapter)}`
          : planHref(primary)
      : "/practice");

  return (
    <>
      <div className="min-h-[calc(100dvh-3.5rem)] bg-white lg:min-h-dvh">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {error && (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error} — is the backend running?
            </div>
          )}

          {/* Header */}
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-brand-700 sm:text-3xl lg:text-4xl">
                {greeting}, {firstName}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-slate-500 sm:text-base">
                Keep flying high. Every MCQ brings you closer to that white coat.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
              <Clock className="h-4 w-4" />
              {daysToMdcat} {daysToMdcat === 1 ? "Day" : "Days"} to MDCAT
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Left + center column */}
            <div className="space-y-5 lg:col-span-2">
              {/* Daily Mission */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-6 shadow-sm sm:p-7">
                <div
                  className="pointer-events-none absolute -right-4 bottom-0 opacity-[0.07]"
                  aria-hidden
                >
                  <svg width="180" height="180" viewBox="0 0 24 24" fill="currentColor" className="text-brand">
                    <path d="M12 2C8 2 5 5.5 5 9.5c0 2.4 1.1 4.5 2.8 6.2L6 21l3.2-.9c.9.3 1.8.4 2.8.4 4 0 7-3.5 7-7.5S16 2 12 2zm0 11.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
                  </svg>
                </div>

                <div className="relative flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-orange-50 px-2.5 py-1 text-[10px] font-bold tracking-wider text-orange-600">
                    DAILY MISSION
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-[10px] font-bold tracking-wider text-amber-600">
                    <Flame className="h-3 w-3" />
                    {pending ? "—" : data?.streak ?? 0} Day Streak
                  </span>
                </div>

                <h2 className="relative mt-4 font-display text-2xl font-bold text-brand-700 sm:text-3xl">
                  {missionChapter}
                </h2>
                {missionAccuracy != null && !pending && (
                  <p
                    className={`relative mt-1 text-sm font-semibold tabular-nums ${accuracyTone(missionAccuracy)}`}
                  >
                    {missionAccuracy}% accuracy so far
                  </p>
                )}
                <p className="relative mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                  {missionReason}
                </p>

                <Link
                  href={continueHref}
                  className="relative mt-6 inline-flex items-center rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
                >
                  {hasPractice || resumeMission ? "Continue Practice →" : "Start Practice →"}
                </Link>
              </div>

              {/* Mid action cards */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Link
                  href="/practice"
                  className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-brand/20 hover:shadow-md"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-semibold text-slate-900">
                    Chapter Practice
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Focus on specific topics from the syllabus.
                  </p>
                  <p className="mt-4 text-sm font-semibold text-brand group-hover:underline">
                    Start drilling &gt;
                  </p>
                </Link>

                <Link
                  href="/exam"
                  className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:border-brand/20 hover:shadow-md"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 font-semibold text-slate-900">
                    Full-length Mock
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    81 MCQs · ~70 min. Simulate the real deal.
                  </p>
                  <p className="mt-4 text-sm font-semibold text-brand group-hover:underline">
                    Enter Simulation &gt;
                  </p>
                </Link>
              </div>

              {/* Chapter progress */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">
                    Recent Chapters
                  </h3>
                  <Link
                    href="/practice"
                    className="text-sm font-medium text-brand hover:underline"
                  >
                    All Chapters
                  </Link>
                </div>

                {pending ? (
                  <div className="space-y-4">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                        <span className="h-4 w-20 animate-pulse rounded bg-slate-100" />
                      </div>
                    ))}
                  </div>
                ) : chapters.length > 0 ? (
                  <div className="space-y-4">
                    {chapters.map((c) => (
                      <div key={c.chapter} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium text-slate-700">
                          {c.chapter}
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-slate-500">
                          {c.accuracy_pct}% · {c.attempted} done
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    Complete a few practice sessions to see your progress here.
                  </p>
                )}
              </div>
            </div>

            {/* Right column */}
            <aside className="space-y-5">
              <div className="rounded-2xl bg-brand-700 p-5 text-white shadow-sm">
                <h3 className="text-sm font-semibold tracking-wide text-sky-100">
                  Quick Stats
                </h3>
                <div className="mt-5">
                  <div>
                    <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                      MCQs ATTEMPTED
                    </p>
                    <p className="mt-1 font-display text-2xl font-bold tabular-nums">
                      {pending ? (
                        <span className="inline-block h-6 w-16 animate-pulse rounded bg-white/20 align-middle" />
                      ) : (
                        (data?.total_attempted ?? 0).toLocaleString()
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between rounded-xl bg-white/10 px-3.5 py-3 ring-1 ring-white/10">
                  <div>
                    <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                      FOCUS TODAY
                    </p>
                    <p className="mt-0.5 min-w-0 break-words text-sm font-semibold">
                      {pending
                        ? "…"
                        : focus?.chapter || focus?.concept || "Start practising"}
                    </p>
                    {!pending && focus?.accuracy_pct != null && (
                      <p className={`text-xs font-medium tabular-nums ${accuracyTone(focus.accuracy_pct)}`}>
                        {focus.accuracy_pct}% accuracy
                      </p>
                    )}
                  </div>
                  <Flame className="h-4 w-4 text-sky-200" />
                </div>
              </div>

              {weakSpots.length > 0 && (
                <div className="rounded-2xl border border-red-100 bg-red-50/60 p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold tracking-wider text-red-500">
                        WEAK SPOTS
                      </p>
                      <h3 className="mt-1 font-semibold text-slate-900">
                        {weakSpots[0].chapter || weakSpots[0].concept}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {weakSpots[0].accuracy_pct}% accuracy across{" "}
                        {weakSpots[0].attempts} attempts — drill this chapter next.
                      </p>
                    </div>
                  </div>
                  <Link
                    href={
                      weakSpots[0].chapter
                        ? `/session?mode=chapter&chapter=${encodeURIComponent(weakSpots[0].chapter)}`
                        : "/weak-spots"
                    }
                    className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                  >
                    Drill now →
                  </Link>
                  <Link
                    href="/weak-spots"
                    className="mt-2 block text-center text-xs font-medium text-brand hover:underline"
                  >
                    View all weak spots
                  </Link>
                </div>
              )}

              <div className="relative overflow-hidden rounded-2xl bg-[#E8F1FB] p-5 shadow-sm">
                <span className="rounded-md bg-white/80 px-2 py-0.5 text-[10px] font-bold tracking-wider text-brand">
                  NEW FEATURE
                </span>
                <h3 className="mt-3 font-semibold text-brand-700">
                  Ask your Textbook
                </h3>
                <p className="mt-1.5 max-w-[85%] text-sm leading-relaxed text-slate-600">
                  Stuck on a concept? Uraan AI explains it using context from
                  your FSc Biology textbooks.
                </p>
                <Link
                  href="/chat"
                  className="mt-4 inline-flex items-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
                >
                  Ask a Question
                </Link>
                <MessageCircle
                  className="pointer-events-none absolute -bottom-2 -right-2 h-20 w-20 text-brand/10"
                  aria-hidden
                />
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      Build Custom Quiz
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Mix chapters and difficulty
                    </p>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
                    <Settings2 className="h-4 w-4" />
                  </div>
                </div>
                <Link
                  href="/custom-quiz"
                  className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-brand/30 px-4 py-2.5 text-sm font-semibold text-brand transition hover:bg-brand-50"
                >
                  Configure Now
                </Link>
              </div>

            </aside>
          </div>

          <footer className="mt-10 border-t border-slate-200/80 pb-4 pt-8 text-center">
            <p className="font-urdu text-base text-slate-500">
              اُڑان: آپ کی کامیابی کا سفر
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Keep flying, the sky is just the beginning.
            </p>
          </footer>
        </div>
      </div>
    </>
  );
}

function planHref(item?: { action?: string; chapter?: string | null } | null) {
  if (!item) return "/practice";
  if (item.action === "full_length_practice") return "/exam";
  if (item.chapter)
    return `/session?mode=chapter&chapter=${encodeURIComponent(item.chapter)}`;
  return "/practice";
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getDaysToMdcat() {
  // Local calendar days until 20 Sep 2026. Date-only ISO strings parse as UTC
  // and inflate the count by one day in Pakistan (UTC+5).
  const exam = new Date(2026, 8, 20);
  const today = new Date();
  exam.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((exam.getTime() - today.getTime()) / 86_400_000));
}
