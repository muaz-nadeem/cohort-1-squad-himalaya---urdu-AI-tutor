"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { getStudentId, getStudentName } from "@/lib/student";
import { syncStudentCacheFromSession } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import { useEffect, useState } from "react";

export default function DashboardPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentName, setStudentName_] = useState("Student");

  useEffect(() => {
    void syncStudentCacheFromSession().then((id) => {
      const sid = id || getStudentId();
      if (!sid) {
        router.replace("/login");
        return;
      }
      setStudentId(sid);
      setStudentName_(getStudentName() || "Student");
    });
  }, [router]);

  const dashQuery = useQuery({
    queryKey: ["dashboard", studentId],
    queryFn: () => api.getDashboard(studentId!),
    enabled: !!studentId,
    staleTime: 60_000,
  });

  const spotsQuery = useQuery({
    queryKey: ["weak-spots", studentId],
    queryFn: () => api.getWeakSpots(studentId!).catch(() => [] as WeakSpot[]),
    enabled: !!studentId,
    staleTime: 60_000,
  });

  useQuery({
    queryKey: ["chapters"],
    queryFn: () => api.getChapters(),
    enabled: !!studentId,
    staleTime: 10 * 60_000,
  });

  const data = dashQuery.data ?? null;
  const weakSpots = spotsQuery.data ?? [];
  const loading = !studentId || (dashQuery.isLoading && !data);
  const error =
    dashQuery.error instanceof Error
      ? dashQuery.error.message
      : dashQuery.error
        ? "Failed to load"
        : "";

  if (loading && !data) {
    return (
      <Navbar>
        <div className="flex min-h-[80vh] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p className="mt-3 text-sm text-slate-400">Loading dashboard...</p>
          </div>
        </div>
      </Navbar>
    );
  }

  const greeting = getGreeting();
  const firstName = studentName.split(" ")[0];
  const daysToMdcat = getDaysToMdcat();
  const planItems = data?.daily_plan?.items || [];
  const primary = planItems[0];
  const hasPractice = (data?.total_attempted ?? 0) > 0;
  const focus = data?.focus || weakSpots[0] || null;
  const chapters = data?.chapters?.slice(0, 3) || [];
  const missionChapter =
    primary?.chapter || focus?.chapter || "Start Chapter Practice";
  const missionReason =
    primary?.reason ||
    (focus
      ? `Recommended today because ${focus.concept} needs attention. Keep drilling until it sticks.`
      : "Pick a chapter and start MCQs. Wrong answers teach us your weak spots — then we adapt your plan.");

  return (
    <Navbar>
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#F4F7FB] lg:min-h-screen">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {error && (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error} — is the backend running?
            </div>
          )}

          {/* Header */}
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
                {greeting}, {firstName}
              </h1>
              <p className="mt-2 max-w-xl text-sm text-slate-500 sm:text-base">
                Keep flying high. Every MCQ brings you closer to that white coat.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm">
              <Clock className="h-4 w-4" />
              {daysToMdcat} Days to MDCAT
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
                    {data?.streak ?? 0} Day Streak
                  </span>
                </div>

                <h2 className="relative mt-4 font-display text-2xl font-bold text-brand-700 sm:text-3xl">
                  {missionChapter}
                </h2>
                <p className="relative mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
                  {missionReason}
                </p>

                <Link
                  href={hasPractice ? planHref(primary) : "/practice"}
                  className="relative mt-6 inline-flex items-center rounded-xl bg-brand px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
                >
                  {hasPractice ? "Continue Practice →" : "Start Practice →"}
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

                {chapters.length > 0 ? (
                  <div className="space-y-4">
                    {chapters.map((c) => (
                      <div key={c.chapter} className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-700">
                          {c.chapter}
                        </span>
                        <span className="text-sm tabular-nums text-slate-500">
                          {c.attempted} MCQs done
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
                      {(data?.total_attempted ?? 0).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between rounded-xl bg-white/10 px-3.5 py-3 ring-1 ring-white/10">
                  <div>
                    <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                      FOCUS TODAY
                    </p>
                    <p className="mt-0.5 text-sm font-semibold">
                      {focus?.concept || focus?.chapter || "Start practising"}
                    </p>
                  </div>
                  <Flame className="h-4 w-4 text-sky-200" />
                </div>
              </div>

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

{/* Weak Spot Alert — hidden until weak-spot analysis is wired */}
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
    </Navbar>
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
  const exam = new Date("2026-08-16");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((exam.getTime() - today.getTime()) / 86400000));
}
