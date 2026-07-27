"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Sparkles,
  Trophy,
  XCircle,
} from "lucide-react";
import {
  api,
  type ExplainResult,
  type ReviewItem,
  type SessionSummary,
} from "@/lib/api";
import AskAI from "@/components/AskAI";
import Navbar from "@/components/Navbar";

export default function SummaryPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<"all" | "wrong">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<
    Record<string, ExplainResult>
  >({});
  const [loadingExplain, setLoadingExplain] = useState<string | null>(null);
  const [elapsedLabel, setElapsedLabel] = useState("—");
  const [avgPerQ, setAvgPerQ] = useState("—");

  useEffect(() => {
    const raw = window.sessionStorage.getItem("mdcat_summary");
    if (!raw) {
      router.replace("/dashboard");
      return;
    }
    const parsed = JSON.parse(raw) as SessionSummary;
    setSummary(parsed);
    try {
      const rev = window.sessionStorage.getItem("mdcat_review");
      if (rev) setReview(JSON.parse(rev));
    } catch {
      /* ignore */
    }

    const startedAt = Number(
      window.sessionStorage.getItem("mdcat_session_started_at") || ""
    );
    if (startedAt) {
      const secs = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const mm = Math.floor(secs / 60);
      const ss = secs % 60;
      setElapsedLabel(
        `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`
      );
      if (parsed.total > 0) {
        setAvgPerQ(`${Math.round(secs / parsed.total)}s / question`);
      }
    }
  }, [router]);

  if (!summary) return null;

  const wrongCount = review.filter((r) => !r.is_correct).length;
  const visible =
    filter === "wrong" ? review.filter((r) => !r.is_correct) : review;
  const focusChapter =
    summary.chapters?.slice().sort((a, b) => a.accuracy_pct - b.accuracy_pct)[0]
      ?.chapter ||
    review[0]?.chapter ||
    "Biology";

  async function toggleReview(item: ReviewItem) {
    const key = item.question_id;
    if (openId === key) {
      setOpenId(null);
      return;
    }
    setOpenId(key);
    if (explanations[key] || loadingExplain === key) return;

    setLoadingExplain(key);
    try {
      const exp = await api.explain({
        question_id: item.question_id,
        concept: item.chapter,
        selected_option: optionLabel(item, item.selected_option),
        correct_option: optionLabel(item, item.correct_option),
      });
      setExplanations((prev) => ({ ...prev, [key]: exp }));
    } catch {
      /* show options even if explain fails */
    } finally {
      setLoadingExplain(null);
    }
  }

  return (
    <Navbar>
      <div className="min-h-[calc(100vh-3.5rem)] bg-[#F4F7FB] lg:min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
            Session Summary
          </h1>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">
            Excellent focus! Here&apos;s how you performed in your last{" "}
            {focusChapter} sprint.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold tracking-wider text-slate-400">
                    PERFORMANCE SCORE
                  </p>
                  <p className="mt-2 font-display text-3xl font-bold text-brand">
                    {summary.score}{" "}
                    <span className="text-xl text-slate-400">
                      / {summary.total}
                    </span>
                  </p>
                  {wrongCount > 0 && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-red-500">
                      <XCircle className="h-3.5 w-3.5" />
                      {wrongCount} questions need review
                    </p>
                  )}
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand">
                  <Trophy className="h-5 w-5" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-bold tracking-wider text-slate-400">
                ACCURACY
              </p>
              <p className="mt-2 font-display text-3xl font-bold text-brand">
                {summary.accuracy_pct}%
              </p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${
                    summary.accuracy_pct >= 70
                      ? "bg-emerald-500"
                      : summary.accuracy_pct >= 40
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${summary.accuracy_pct}%` }}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-[10px] font-bold tracking-wider text-slate-400">
                TIME TAKEN
              </p>
              <p className="mt-2 font-display text-3xl font-bold text-brand tabular-nums">
                {elapsedLabel}
              </p>
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5 text-brand" />
                Avg: {avgPerQ}
              </p>
            </div>
          </div>

          {review.length > 0 && (
            <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  Question Review
                </h2>
                <div className="inline-flex rounded-full bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setFilter("all")}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      filter === "all"
                        ? "bg-sky-100 text-brand"
                        : "text-slate-500"
                    }`}
                  >
                    All ({review.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter("wrong")}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      filter === "wrong"
                        ? "bg-sky-100 text-brand"
                        : "text-slate-500"
                    }`}
                  >
                    Wrong ({wrongCount})
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {visible.map((item, i) => {
                  const open = openId === item.question_id;
                  const exp = explanations[item.question_id];
                  const yourOpt = item.options.find(
                    (o) => o.key === item.selected_option
                  );
                  const correctOpt = item.options.find(
                    (o) => o.key === item.correct_option
                  );
                  return (
                    <div
                      key={`${item.question_id}-${i}`}
                      className="overflow-hidden rounded-xl border border-slate-100"
                    >
                      <button
                        type="button"
                        onClick={() => toggleReview(item)}
                        className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-slate-50"
                      >
                        {item.is_correct ? (
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                        ) : (
                          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">
                            Q{i + 1}: {item.question_text}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-brand">
                              {item.chapter}
                            </span>
                          </div>
                        </div>
                        {open ? (
                          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                      </button>

                      {open && (
                        <div className="space-y-4 border-t border-slate-100 bg-slate-50/70 px-4 py-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                              <p className="text-[10px] font-bold tracking-wider text-red-500">
                                YOUR ANSWER
                              </p>
                              <p className="mt-2 text-sm font-medium text-red-700">
                                {yourOpt
                                  ? `${yourOpt.key}) ${yourOpt.text}`
                                  : item.selected_option}
                              </p>
                            </div>
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                              <p className="text-[10px] font-bold tracking-wider text-emerald-600">
                                CORRECT ANSWER
                              </p>
                              <p className="mt-2 text-sm font-medium text-emerald-700">
                                {correctOpt
                                  ? `${correctOpt.key}) ${correctOpt.text}`
                                  : item.correct_option}
                              </p>
                            </div>
                          </div>

                          {loadingExplain === item.question_id ? (
                            <p className="text-sm text-slate-400">
                              Loading explanation...
                            </p>
                          ) : exp ? (
                            <div className="rounded-xl border border-sky-100 bg-sky-50/80 p-4">
                              <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold tracking-wide text-brand">
                                <Sparkles className="h-3.5 w-3.5" />
                                Quick Hint
                              </div>
                              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                                {exp.explanation}
                              </p>
                              {exp.citation && (
                                <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-brand">
                                  <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                  {exp.citation}
                                </p>
                              )}
                              <div className="mt-4">
                                <AskAI
                                  concept={item.chapter || "Biology"}
                                  mcq={{
                                    question_text: item.question_text,
                                    options: item.options,
                                    selected_option: item.selected_option,
                                    correct_option: item.correct_option,
                                    explanation: exp?.explanation || "",
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <AskAI
                              concept={item.chapter || "Biology"}
                              mcq={{
                                question_text: item.question_text,
                                options: item.options,
                                selected_option: item.selected_option,
                                correct_option: item.correct_option,
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {visible.length === 0 && (
                  <p className="text-sm text-slate-400">
                    No wrong answers — nice work.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Link href="/weak-spots" className="btn-ghost">
              Weak spots
            </Link>
            <Link href="/dashboard" className="btn-primary">
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </Navbar>
  );
}

function optionLabel(item: ReviewItem, key: string): string {
  return item.options.find((o) => o.key === key)?.text || key;
}
