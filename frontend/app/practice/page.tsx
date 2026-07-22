"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Flame,
  Lock,
  Play,
  TrendingUp,
} from "lucide-react";
import { api, type ChapterInfo, type Dashboard } from "@/lib/api";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

export default function PracticePage() {
  const router = useRouter();
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookFilter, setBookFilter] = useState<"all" | "fsc_part1" | "fsc_part2">(
    "all"
  );

  useEffect(() => {
    const id = getStudentId();
    if (!id) {
      router.replace("/");
      return;
    }
    Promise.all([
      api.getChapters().catch(() => [] as ChapterInfo[]),
      api.getDashboard(id).catch(() => null),
    ])
      .then(([chs, dash]) => {
        setChapters(chs);
        setDashboard(dash);
      })
      .finally(() => setLoading(false));
  }, [router]);

  const accuracyByChapter = useMemo(() => {
    const map = new Map<string, { accuracy_pct: number; attempted: number }>();
    for (const c of dashboard?.chapters || []) {
      map.set(c.chapter, {
        accuracy_pct: c.accuracy_pct,
        attempted: c.attempted,
      });
    }
    return map;
  }, [dashboard]);

  const filtered = chapters.filter(
    (c) => bookFilter === "all" || c.book === bookFilter
  );
  const part1 = filtered.filter((c) => c.book === "fsc_part1");
  const part2 = filtered.filter((c) => c.book === "fsc_part2");
  const withBank = chapters.filter((c) => c.has_questions).length;
  const started = chapters.filter((c) => {
    const s = accuracyByChapter.get(c.name);
    return s && s.attempted > 0;
  }).length;

  return (
    <Navbar>
      <main className="min-h-[calc(100vh-3.5rem)] bg-[#F4F7FB] lg:min-h-screen">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
                Chapter Practice
              </h1>
              <p className="mt-2 text-sm text-slate-500 sm:text-base">
                Master individual topics with focused MCQ sets.
              </p>
            </div>

            <div className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200">
              {(
                [
                  ["all", "All"],
                  ["fsc_part1", "1st Year"],
                  ["fsc_part2", "2nd Year"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBookFilter(id)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    bookFilter === id
                      ? "bg-brand text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Completed"
              value={`${started} / ${withBank || chapters.length || 0}`}
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            />
            <StatCard
              label="Streak"
              value={`${dashboard?.streak ?? 0} Days`}
              icon={<Flame className="h-4 w-4 text-amber-500" />}
            />
            <StatCard
              label="Avg. Accuracy"
              value={`${dashboard?.accuracy_pct ?? 0}%`}
              icon={<TrendingUp className="h-4 w-4 text-brand" />}
            />
          </div>

          {loading ? (
            <p className="mt-10 text-sm text-slate-400">Loading chapters...</p>
          ) : (
            <div className="mt-10 space-y-10">
              {bookFilter !== "fsc_part2" && (
                <ChapterSection
                  title="FSc Part 1 (Biology)"
                  chapters={part1}
                  accuracyByChapter={accuracyByChapter}
                />
              )}
              {bookFilter !== "fsc_part1" && (
                <ChapterSection
                  title="FSc Part 2 (Biology)"
                  chapters={part2}
                  accuracyByChapter={accuracyByChapter}
                  showWeeklyGoal
                />
              )}
            </div>
          )}
        </div>
      </main>
    </Navbar>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-slate-400">
          {label}
        </p>
        {icon}
      </div>
      <p className="mt-2 font-display text-2xl font-bold text-brand-700">
        {value}
      </p>
    </div>
  );
}

function ChapterSection({
  title,
  chapters,
  accuracyByChapter,
  showWeeklyGoal,
}: {
  title: string;
  chapters: ChapterInfo[];
  accuracyByChapter: Map<string, { accuracy_pct: number; attempted: number }>;
  showWeeklyGoal?: boolean;
}) {
  if (!chapters.length && !showWeeklyGoal) return null;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <p className="text-xs text-slate-400">{chapters.length} Chapters</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {chapters.map((ch, i) => {
          const stats = accuracyByChapter.get(ch.name);
          const attempted = stats?.attempted ?? 0;
          const accuracy = stats?.accuracy_pct ?? 0;
          const progress = !ch.has_questions
            ? 0
            : attempted > 0
              ? Math.min(100, Math.max(8, accuracy || 15))
              : 0;
          const status: "locked" | "start" | "progress" | "done" = !ch.has_questions
            ? "locked"
            : attempted === 0
              ? "start"
              : accuracy >= 85
                ? "done"
                : "progress";

          return (
            <ChapterCard
              key={ch.id}
              index={i + 1}
              name={ch.name}
              status={status}
              progress={progress}
              difficulty={
                i % 3 === 0 ? "Medium" : i % 3 === 1 ? "High" : "Low"
              }
            />
          );
        })}

        {showWeeklyGoal && (
          <div className="rounded-2xl bg-brand-700 p-5 text-white shadow-sm">
            <p className="text-xs font-bold tracking-wider text-sky-200">
              WEEKLY GOAL
            </p>
            <h3 className="mt-3 font-display text-xl font-bold leading-snug">
              Stay on track for MDCAT 2026
            </h3>
            <p className="mt-2 text-sm text-sky-100/90">
              Complete your next weak chapter this week to keep your daily plan
              moving.
            </p>
            <Link
              href="/weekly-plan"
              className="mt-5 inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand transition hover:bg-sky-50"
            >
              View Plan
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function ChapterCard({
  index,
  name,
  status,
  progress,
  difficulty,
}: {
  index: number;
  name: string;
  status: "locked" | "start" | "progress" | "done";
  progress: number;
  difficulty: string;
}) {
  const href = `/session?mode=chapter&chapter=${encodeURIComponent(name)}`;

  return (
    <div className="flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-400">
            Chapter {String(index).padStart(2, "0")}
          </p>
          <h3 className="mt-1 font-semibold leading-snug text-slate-900">
            {name}
          </h3>
          <p className="mt-2 text-xs text-slate-500">
            100 mixed MCQs · Difficulty: {difficulty}
          </p>
        </div>
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            status === "done"
              ? "bg-emerald-50 text-emerald-600"
              : status === "locked"
                ? "bg-slate-50 text-slate-400"
                : "bg-brand-50 text-brand"
          }`}
        >
          {status === "done" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : status === "locked" ? (
            <Lock className="h-4 w-4" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
        </div>
      </div>

      <div className="mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${
              status === "done" ? "bg-brand" : "bg-sky-400"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-1 items-end">
        {status === "locked" && (
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-[10px] font-bold tracking-wider text-slate-500">
            COMING SOON
          </span>
        )}
        {status === "done" && (
          <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-[10px] font-bold tracking-wider text-emerald-600">
            COMPLETED
          </span>
        )}
        {status === "progress" && (
          <div className="flex w-full items-center justify-between gap-3">
            <span className="rounded-md bg-sky-50 px-2.5 py-1 text-[10px] font-bold tracking-wider text-sky-600">
              IN PROGRESS
            </span>
            <Link
              href={href}
              className="rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
            >
              Resume
            </Link>
          </div>
        )}
        {status === "start" && (
          <Link
            href={href}
            className="inline-flex w-full items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Start Practice
          </Link>
        )}
      </div>
    </div>
  );
}
