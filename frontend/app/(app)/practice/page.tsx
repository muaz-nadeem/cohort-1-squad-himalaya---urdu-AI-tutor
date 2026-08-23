"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Play, Search } from "lucide-react";
import { api, type ChapterInfo } from "@/lib/api";
import { useStudentId } from "@/lib/useStudent";
import { CHAPTERS_QUERY } from "@/lib/queries";
import { hasIncompleteChapterBatch } from "@/lib/chapterBatch";
import { useQuery } from "@tanstack/react-query";
import ChapterCover from "@/components/ChapterCover";
import { TrendIcon, accuracyTone, trendLabel, type Trend } from "@/lib/trends";

function matchesChapter(ch: ChapterInfo, query: string) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  const unit = (ch.unit || "").toLowerCase();
  const unitPad = unit.padStart(2, "0");
  return (
    ch.name.toLowerCase().includes(q) ||
    ch.id.replace(/_/g, " ").includes(q) ||
    unit === q ||
    unitPad === q ||
    `chapter ${unit}`.includes(q) ||
    `ch ${unitPad}`.includes(q)
  );
}

export default function PracticePage() {
  const [bookFilter, setBookFilter] = useState<"all" | "fsc_part1" | "fsc_part2">(
    "all"
  );
  const [search, setSearch] = useState("");
  const studentId = useStudentId();

  // The catalogue is student-independent, so it can load before auth resolves.
  const chaptersQuery = useQuery(CHAPTERS_QUERY);

  const dashQuery = useQuery({
    queryKey: ["dashboard", studentId],
    queryFn: () => api.getDashboard(studentId!),
    enabled: !!studentId,
  });

  const chapters = chaptersQuery.data ?? [];
  const dashboard = dashQuery.data ?? null;
  const loading = chaptersQuery.isLoading && chapters.length === 0;
  const chaptersError =
    chaptersQuery.error instanceof Error
      ? chaptersQuery.error.message
      : chaptersQuery.error
        ? "Failed to load chapters"
        : null;
  const accuracyByChapter = useMemo(() => {
    const map = new Map<
      string,
      { accuracy_pct: number; attempted: number; trend?: Trend }
    >();
    for (const c of dashboard?.chapters || []) {
      map.set(c.chapter, {
        accuracy_pct: c.accuracy_pct,
        attempted: c.attempted,
        trend: c.trend,
      });
    }
    return map;
  }, [dashboard]);

  const filtered = chapters.filter(
    (c) =>
      (bookFilter === "all" || c.book === bookFilter) &&
      matchesChapter(c, search)
  );
  const part1 = filtered.filter((c) => c.book === "fsc_part1");
  const part2 = filtered.filter((c) => c.book === "fsc_part2");
  const noSearchHits = !loading && !chaptersError && chapters.length > 0 && filtered.length === 0;

  return (
    <>
      <main className="min-h-[calc(100dvh-3.5rem)] bg-[#F4F7FB] lg:min-h-dvh">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-brand-700 sm:text-3xl">
              Chapter Practice
            </h1>
            <p className="mt-2 text-sm text-slate-500 sm:text-base">
              Master individual topics with focused MCQ sets.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="inline-flex w-full rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200 sm:w-auto sm:shrink-0">
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
                    className={`min-h-11 flex-1 rounded-full px-3 py-2 text-sm font-medium transition sm:flex-none sm:px-4 ${
                      bookFilter === id
                        ? "bg-brand text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="relative block w-full sm:ml-auto sm:w-52">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search chapters..."
                  className="!py-2.5 !pl-9 !pr-3"
                  aria-label="Search chapters"
                />
              </label>
            </div>
          </div>

          {loading && !chapters.length ? (
            <p className="mt-10 text-sm text-slate-400">Loading chapters...</p>
          ) : chaptersError ? (
            <p className="mt-10 text-sm text-red-600">
              Could not load chapters. {chaptersError}
            </p>
          ) : !chapters.length ? (
            <p className="mt-10 text-sm text-slate-400">
              No chapters returned from the API. Try signing out and back in.
            </p>
          ) : noSearchHits ? (
            <p className="mt-10 text-sm text-slate-400">
              No chapters match “{search.trim()}”.
            </p>
          ) : (
            <div className="mt-10 space-y-10">
              {bookFilter !== "fsc_part2" && (
                <ChapterSection
                  title="FSc Part 1 (Biology)"
                  chapters={part1}
                  accuracyByChapter={accuracyByChapter}
                  studentId={studentId}
                />
              )}
              {bookFilter !== "fsc_part1" && (
                <ChapterSection
                  title="FSc Part 2 (Biology)"
                  chapters={part2}
                  accuracyByChapter={accuracyByChapter}
                  studentId={studentId}
                />
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function ChapterSection({
  title,
  chapters,
  accuracyByChapter,
  studentId,
}: {
  title: string;
  chapters: ChapterInfo[];
  accuracyByChapter: Map<string, { accuracy_pct: number; attempted: number }>;
  studentId: string | null;
}) {
  if (!chapters.length) return null;

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
          const count = ch.question_count ?? 0;
          const remaining = Math.max(0, count - attempted);
          const openBatch = studentId
            ? hasIncompleteChapterBatch(studentId, ch.name)
            : false;
          const progress =
            count > 0
              ? Math.min(100, Math.round((attempted / count) * 100))
              : 0;
          const status: "start" | "progress" | "done" = openBatch
            ? "progress"
            : remaining === 0 && attempted > 0
              ? "done"
              : attempted > 0
                ? "progress"
                : "start";
          const cta: "none" | "resume" | "next" | "again" = openBatch
            ? "resume"
            : status === "done"
              ? "again"
              : attempted >= 100 && remaining > 0
                ? "next"
                : attempted > 0
                  ? "resume"
                  : "none";

          return (
            <ChapterCard
              key={ch.id}
              id={ch.id}
              unit={ch.unit || String(i + 1)}
              name={ch.name}
              status={status}
              cta={cta}
              progress={progress}
              questionCount={count}
              attempted={attempted}
              accuracyPct={stats?.accuracy_pct}
              trend={stats?.trend}
            />
          );
        })}
      </div>
    </section>
  );
}

function ChapterCard({
  id,
  unit,
  name,
  status,
  cta,
  progress,
  questionCount,
  attempted,
  accuracyPct,
  trend,
}: {
  id: string;
  unit: string;
  name: string;
  status: "start" | "progress" | "done";
  cta: "none" | "resume" | "next" | "again";
  progress: number;
  questionCount: number;
  attempted: number;
  accuracyPct?: number;
  trend?: Trend;
}) {
  const href = `/session?mode=chapter&chapter=${encodeURIComponent(name)}`;
  const countLabel =
    questionCount > 0
      ? `${questionCount} MCQ${questionCount === 1 ? "" : "s"} in bank`
      : "No MCQs ingested yet";
  const statsLabel =
    attempted > 0 && accuracyPct != null
      ? `${accuracyPct}% accuracy · ${attempted} done`
      : attempted > 0
        ? `${attempted} MCQ${attempted === 1 ? "" : "s"} done`
        : null;

  return (
    <Link
      href={href}
      className="flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition hover:border-brand/20 hover:shadow-md"
    >
      <ChapterCover id={id} unit={unit} />
      <div className="flex flex-1 flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-400">
            Chapter {String(unit).padStart(2, "0")}
          </p>
          <h3 className="mt-1 min-w-0 break-words font-semibold leading-snug text-slate-900">
            {name}
          </h3>
          <p className="mt-2 text-xs text-slate-500">{countLabel}</p>
          {statsLabel && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {trend && <TrendIcon trend={trend} />}
              <p
                className={`text-xs font-medium ${
                  accuracyPct != null ? accuracyTone(accuracyPct) : "text-slate-500"
                }`}
              >
                {statsLabel}
                {trend ? ` · ${trendLabel(trend)}` : ""}
              </p>
            </div>
          )}
        </div>
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            status === "done"
              ? "bg-emerald-50 text-emerald-600"
              : "bg-brand-50 text-brand"
          }`}
        >
          {status === "done" ? (
            <CheckCircle2 className="h-4 w-4" />
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

      {cta !== "none" && (
        <div className="mt-4 flex flex-1 items-end">
          <div className="flex w-full items-center justify-between gap-3">
            <span
              className={`rounded-md px-2.5 py-1 text-[10px] font-bold tracking-wider ${
                status === "done"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-sky-50 text-sky-600"
              }`}
            >
              {status === "done" ? "COMPLETED" : "IN PROGRESS"}
            </span>
            <span className="rounded-xl bg-brand px-3.5 py-2 text-xs font-semibold text-white">
              {cta === "again"
                ? "Practice again"
                : cta === "next"
                  ? "Next 100"
                  : "Resume"}
            </span>
          </div>
        </div>
      )}
      </div>
    </Link>
  );
}
