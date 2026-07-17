"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Trophy,
  Target,
  ArrowRight,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api, type ExplainResult, type ReviewItem, type SessionSummary } from "@/lib/api";
import AskAI from "@/components/AskAI";
import Navbar from "@/components/Navbar";

export default function SummaryPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [filter, setFilter] = useState<"all" | "wrong">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, ExplainResult>>({});
  const [loadingExplain, setLoadingExplain] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.sessionStorage.getItem("mdcat_summary");
    if (!raw) {
      router.replace("/dashboard");
      return;
    }
    setSummary(JSON.parse(raw));
    try {
      const rev = window.sessionStorage.getItem("mdcat_review");
      if (rev) setReview(JSON.parse(rev));
    } catch {
      /* ignore */
    }
  }, [router]);

  if (!summary) return null;

  const wrongCount = review.filter((r) => !r.is_correct).length;
  const visible =
    filter === "wrong" ? review.filter((r) => !r.is_correct) : review;

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
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
            <Trophy className="h-8 w-8 text-brand" />
          </div>
          <p className="text-sm text-slate-500">Session complete</p>
          <p className="my-3 text-5xl font-bold text-brand">
            {summary.score}
            <span className="text-2xl text-slate-400">/{summary.total}</span>
          </p>
          <p className="text-sm text-slate-500">{summary.accuracy_pct}% accuracy</p>
          {review.length > 0 && (
            <p className="mt-2 text-xs text-slate-400">
              {wrongCount} incorrect · tap a question below to review
            </p>
          )}
        </div>

        {review.length > 0 && (
          <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-800">Question review</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFilter("all")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    filter === "all"
                      ? "bg-brand text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  All ({review.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilter("wrong")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    filter === "wrong"
                      ? "bg-brand text-white"
                      : "bg-slate-100 text-slate-600"
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
                return (
                  <div
                    key={`${item.question_id}-${i}`}
                    className="overflow-hidden rounded-xl border border-slate-100"
                  >
                    <button
                      type="button"
                      onClick={() => toggleReview(item)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      {item.is_correct ? (
                        <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-green" />
                      ) : (
                        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-red" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                          {item.chapter}
                        </p>
                        <p className="mt-0.5 text-sm font-medium text-slate-800 line-clamp-2">
                          {item.question_text}
                        </p>
                      </div>
                      {open ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                      )}
                    </button>

                    {open && (
                      <div className="space-y-4 border-t border-slate-100 bg-slate-50/80 px-4 py-4">
                        <div className="space-y-2">
                          {item.options.map((opt) => {
                            const isCorrect = opt.key === item.correct_option;
                            const isSelected = opt.key === item.selected_option;
                            let cls = "border-slate-200 bg-white";
                            if (isCorrect) cls = "border-green-500 bg-green-50";
                            else if (isSelected) cls = "border-red-400 bg-red-50";
                            return (
                              <div
                                key={opt.key}
                                className={`rounded-xl border px-4 py-3 text-sm ${cls}`}
                              >
                                <span className="font-semibold">{opt.key}.</span>{" "}
                                {opt.text}
                                {isCorrect && (
                                  <span className="ml-2 text-xs font-medium text-green-700">
                                    Correct
                                  </span>
                                )}
                                {isSelected && !isCorrect && (
                                  <span className="ml-2 text-xs font-medium text-red-600">
                                    Your answer
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {loadingExplain === item.question_id ? (
                          <p className="text-sm text-slate-400">Loading explanation...</p>
                        ) : exp ? (
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="whitespace-pre-line text-sm text-slate-700">
                              {exp.explanation}
                            </p>
                            {exp.citation && (
                              <p className="mt-2 text-xs text-slate-400">{exp.citation}</p>
                            )}
                          </div>
                        ) : null}

                        <AskAI concept={item.chapter || "Biology"} />
                      </div>
                    )}
                  </div>
                );
              })}
              {visible.length === 0 && (
                <p className="text-sm text-slate-400">No wrong answers — nice work.</p>
              )}
            </div>
          </div>
        )}

        {summary.chapters && summary.chapters.length > 0 && (
          <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <p className="mb-4 font-semibold text-slate-800">Weak chapters this session</p>
            <div className="space-y-3">
              {summary.chapters
                .slice()
                .sort((a, b) => a.accuracy_pct - b.accuracy_pct)
                .map((c) => (
                  <Link
                    key={c.chapter}
                    href={`/session?mode=chapter&chapter=${encodeURIComponent(c.chapter)}`}
                    className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-slate-50"
                  >
                    <span className="text-sm text-slate-700">{c.chapter}</span>
                    <span
                      className={`text-sm font-medium ${
                        c.accuracy_pct >= 50 ? "text-accent-green" : "text-accent-red"
                      }`}
                    >
                      {c.accuracy_pct}%
                    </span>
                  </Link>
                ))}
            </div>
          </div>
        )}

        {summary.next_recommendation && (
          <div className="mb-6 rounded-2xl border border-brand-100 bg-brand-50 p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Target className="h-5 w-5 text-brand" />
              <p className="font-semibold text-slate-800">Recommended next</p>
            </div>
            <p className="mb-4 text-sm text-slate-600">
              Drill <b>{summary.next_recommendation.concept}</b> (
              {summary.next_recommendation.accuracy_pct}% accuracy)
            </p>
            <Link
              href={`/session?concept_id=${summary.next_recommendation.concept_id}&mode=drill`}
              className="btn-primary w-full"
            >
              Drill now <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Link href="/weak-spots" className="btn-ghost">
            Weak spots
          </Link>
          <Link href="/dashboard" className="btn-primary">
            Dashboard
          </Link>
        </div>
      </div>
    </Navbar>
  );
}

function optionLabel(item: ReviewItem, key: string): string {
  return item.options.find((o) => o.key === key)?.text || key;
}
