"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  Clock,
  ClipboardList,
  Flame,
  MessageCircle,
  Settings2,
  TrendingDown,
} from "lucide-react";
import { api, type Dashboard, type WeakSpot } from "@/lib/api";
import { getStudentId, getStudentName } from "@/lib/student";
import Navbar from "@/components/Navbar";

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [weakSpots, setWeakSpots] = useState<WeakSpot[]>([]);
  const [studentName, setStudentName_] = useState("Student");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = getStudentId();
    if (!id) {
      router.replace("/");
      return;
    }
    setStudentName_(getStudentName() || "Student");

    Promise.all([
      api.getDashboard(id),
      api.getWeakSpots(id).catch(() => []),
    ])
      .then(([dashboard, spots]) => {
        setData(dashboard);
        setWeakSpots(spots);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
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
  const mastery = data?.accuracy_pct ?? 0;
  const daysToMdcat = getDaysToMdcat();
  const planItems = data?.daily_plan?.items || [];
  const primary = planItems[0];
  const hasPractice = (data?.total_attempted ?? 0) > 0;
  const focus = data?.focus || weakSpots[0] || null;
  const declining = weakSpots.find((s) => s.trend === "getting_worse") || weakSpots[0];
  const chapters = data?.chapters?.slice(0, 3) || [];
  const missionChapter =
    primary?.chapter || focus?.chapter || "Biological Molecules";
  const missionReason =
    primary?.reason ||
    (focus
      ? `Recommended today because ${focus.concept} needs attention. Keep drilling until it sticks.`
      : "Pick a chapter and start MCQs. Wrong answers teach us your weak spots — then we adapt your plan.");
  const chapterMastery =
    data?.chapters?.find((c) => c.chapter === missionChapter)?.accuracy_pct ??
    mastery;

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

                <div className="relative mt-6 max-w-md">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-slate-400">
                    <span>CURRENT MASTERY</span>
                    <span className="text-brand">{chapterMastery}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${Math.min(100, chapterMastery)}%` }}
                    />
                  </div>
                </div>

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

              {/* Chapter accuracy */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-slate-900">
                    Top Chapter Accuracy
                  </h3>
                  <Link
                    href="/weak-spots"
                    className="text-sm font-medium text-brand hover:underline"
                  >
                    View Analytics
                  </Link>
                </div>

                {chapters.length > 0 ? (
                  <div className="space-y-4">
                    {chapters.map((c) => (
                      <div key={c.chapter}>
                        <div className="mb-1.5 flex justify-between text-sm">
                          <span className="font-medium text-slate-700">
                            {c.chapter}
                          </span>
                          <span className="tabular-nums text-slate-500">
                            {c.accuracy_pct}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${
                              c.accuracy_pct >= 70
                                ? "bg-emerald-500"
                                : c.accuracy_pct >= 40
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                            style={{ width: `${c.accuracy_pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    Complete a few practice sessions to see chapter accuracy
                    here.
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
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                      ATTEMPTED
                    </p>
                    <p className="mt-1 font-display text-2xl font-bold tabular-nums">
                      {(data?.total_attempted ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                      ACCURACY
                    </p>
                    <p className="mt-1 font-display text-2xl font-bold tabular-nums">
                      {mastery}%
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
                  <TrendingDown className="h-4 w-4 text-sky-200" />
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

              {declining ? (
                <div className="rounded-2xl border border-red-100 bg-red-50/70 p-5">
                  <div className="flex gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-500">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-red-700">
                        Weak Spot Alert
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-red-700/80">
                        Your performance in{" "}
                        <span className="font-semibold">
                          {declining.concept || declining.chapter}
                        </span>{" "}
                        needs attention ({declining.accuracy_pct}% accuracy). We
                        recommend a short drill session.
                      </p>
                      <Link
                        href={
                          declining.chapter
                            ? `/session?mode=chapter&chapter=${encodeURIComponent(declining.chapter)}`
                            : `/session?concept_id=${declining.concept_id}`
                        }
                        className="mt-3 inline-block text-sm font-semibold text-red-600 hover:underline"
                      >
                        Start quick test →
                      </Link>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 text-sm text-emerald-800">
                  Practise a few chapters — we&apos;ll spot which topics you miss
                  and push those into your plan.
                </div>
              )}
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
  const exam = new Date("2026-08-25");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((exam.getTime() - today.getTime()) / 86400000));
}
