"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  CalendarDays,
  Clock,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { useStudentId } from "@/lib/useStudent";
import { useQuery } from "@tanstack/react-query";

export default function WeeklyPlanPage() {
  const studentId = useStudentId();

  const planQuery = useQuery({
    queryKey: ["weekly-plan", studentId],
    queryFn: () => api.getWeeklyPlan(studentId!),
    enabled: !!studentId,
    staleTime: 5 * 60_000,
  });

  const plan = planQuery.data ?? null;
  const loading = planQuery.isLoading && !plan;
  const error =
    planQuery.error instanceof Error
      ? planQuery.error.message
      : planQuery.error
        ? "Failed to load"
        : "";

  const totals = useMemo(() => {
    const items = plan?.plan || [];
    const questions = items.reduce((s, i) => s + (i.question_count || 0), 0);
    const minutes = items.reduce((s, i) => s + (i.minutes || 0), 0);
    const focus = items[0]?.concept || items[0]?.chapter || "Biology foundations";
    return { questions, minutes, focus, hours: (minutes / 60).toFixed(1) };
  }, [plan]);

  const todayName = new Date()
    .toLocaleDateString("en-US", { weekday: "long" })
    .toLowerCase();

  return (
    <>
      <div className="min-h-[calc(100dvh-3.5rem)] bg-[#F4F7FB] lg:min-h-dvh">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-brand-700 sm:text-4xl">
                Weekly Study Plan
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
                Your AI-curated ascent
                {plan ? ` for week of ${plan.week_start}` : ""}. We&apos;ve
                prioritized{" "}
                <span className="font-semibold text-slate-700">
                  {totals.focus}
                </span>{" "}
                based on your recent weak spots.
              </p>

              {loading && (
                <div className="mt-10 flex justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                </div>
              )}

              {error && (
                <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}

              {!loading && !error && (
                <>
                  <div className="relative mt-7 overflow-hidden rounded-2xl bg-brand-700 p-6 text-white shadow-sm">
                    <div
                      className="pointer-events-none absolute -right-6 -top-6 h-36 w-36 rounded-full bg-sky-400/20"
                      aria-hidden
                    />
                    <p className="text-xs font-bold tracking-wider text-sky-200">
                      WEEK FOCUS
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-bold leading-snug">
                      Mastering {totals.focus}
                    </h2>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
                        <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                          Target Questions
                        </p>
                        <p className="mt-1 font-display text-2xl font-bold">
                          {totals.questions || "—"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
                        <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                          Est. Effort
                        </p>
                        <p className="mt-1 font-display text-2xl font-bold">
                          {totals.hours} hrs
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8">
                    <div className="mb-4 flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-brand" />
                      <h3 className="font-semibold text-slate-900">
                        Curated Schedule
                      </h3>
                    </div>

                    <div className="space-y-3">
                      {(plan?.plan || []).map((item, i) => {
                        const isToday =
                          item.day.toLowerCase() === todayName ||
                          item.day.toLowerCase().startsWith(todayName.slice(0, 3));
                        return (
                          <div
                            key={i}
                            className={`rounded-2xl border bg-white px-5 py-4 shadow-sm ${
                              isToday
                                ? "border-sky-200 bg-sky-50/70"
                                : "border-slate-100"
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-brand">
                                  {item.day}
                                </p>
                                <p className="mt-1 min-w-0 break-words font-semibold text-slate-900">
                                  {item.concept}
                                  {item.chapter ? ` · ${item.chapter}` : ""}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {item.reason}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-slate-500">
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  {item.minutes} min
                                </span>
                                <span>{item.question_count} Qs</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {!plan?.plan?.length && (
                        <div className="rounded-2xl border border-slate-100 bg-white p-6 text-sm text-slate-500">
                          Complete a few practice sessions and we&apos;ll build
                          your weekly plan from weak spots.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-sky-100 bg-[#EAF3FB] p-5">
                <h3 className="font-display text-xl font-bold text-brand-700">
                  Full-length Biology Mock
                </h3>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-500">
                  <CalendarDays className="h-3.5 w-3.5" />
                  81 MCQs · ~70 minutes
                </p>
                <Link
                  href="/exam"
                  className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  Start Mock
                </Link>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" />
                  <h4 className="font-semibold text-slate-900">Tip</h4>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  Treat each weekday focus as a short sprint. Finish the MCQs,
                  then use Ask Textbook on anything you still miss.
                </p>
              </div>

              <div className="rounded-2xl bg-brand-50 p-5">
                <p className="font-urdu text-base leading-relaxed text-brand-700">
                  خاموشی سے محنت کرو تاکہ کامیابی شور مچا دے
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Work so hard in silence that your success makes the noise.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}
