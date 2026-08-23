"use client";

import { useMemo, useState } from "react";
import {
  Bookmark,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type ExplainResult,
  type SavedMcq,
} from "@/lib/api";
import { useStudentId } from "@/lib/useStudent";
import { getDoctorPersona } from "@/lib/doctorPersona";
import AskAI from "@/components/AskAI";
import SpeechControls from "@/components/SpeechControls";
import { SAVED_MCQS_QUERY } from "@/lib/queries";

export default function SavedMcqsPage() {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [askOpenId, setAskOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "wrong" | "unreviewed">("all");
  const doctor = useMemo(
    () => getDoctorPersona(studentId),
    [studentId]
  );

  const savedQuery = useQuery({
    ...SAVED_MCQS_QUERY,
    enabled: !!studentId,
  });

  const items = savedQuery.data?.items ?? [];
  const loading = savedQuery.isLoading && items.length === 0;
  const error =
    savedQuery.error instanceof Error
      ? savedQuery.error.message
      : savedQuery.error
        ? "Failed to load"
        : "";

  const visible = useMemo(() => {
    if (filter === "wrong") return items.filter((i) => !i.is_correct);
    if (filter === "unreviewed") return items.filter((i) => !i.reviewed);
    return items;
  }, [items, filter]);

  async function toggleExpand(item: SavedMcq) {
    const key = item.question_id;
    if (openId === key) {
      setOpenId(null);
      setAskOpenId(null);
      return;
    }
    setOpenId(key);
    setAskOpenId(null);
    if (!item.reviewed) {
      try {
        await api.markSavedMcqReviewed(key, true);
        queryClient.setQueryData(SAVED_MCQS_QUERY.queryKey, (old: { items: SavedMcq[] } | undefined) =>
          old
            ? {
                items: old.items.map((row) =>
                  row.question_id === key ? { ...row, reviewed: true } : row
                ),
              }
            : old
        );
      } catch {
        /* keep UI usable */
      }
    }
  }

  async function removeSaved(questionId: string) {
    try {
      await api.unsaveMcq(questionId);
      if (openId === questionId) {
        setOpenId(null);
        setAskOpenId(null);
      }
      await queryClient.invalidateQueries({ queryKey: SAVED_MCQS_QUERY.queryKey });
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] bg-[#F4F7FB] lg:min-h-dvh">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-brand-700 sm:text-4xl">
              Saved MCQs
            </h1>
            <p className="mt-2 text-sm text-slate-500 sm:text-base">
              Questions you bookmarked during practice — with your answer and AI
              explanation preserved.
            </p>
          </div>
          <div className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200">
            {(
              [
                ["all", "All"],
                ["wrong", "Wrong"],
                ["unreviewed", "To review"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                  filter === id
                    ? "bg-brand text-white"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
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

        {!loading && items.length === 0 && (
          <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
            <Bookmark className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-4 text-slate-500">
              No saved MCQs yet. During chapter practice or a mock exam, tap{" "}
              <span className="font-semibold text-slate-700">Save MCQ</span> after
              you answer.
            </p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="mt-8 space-y-3">
            {visible.length === 0 ? (
              <p className="text-sm text-slate-400">Nothing in this filter.</p>
            ) : (
              visible.map((item, i) => {
                const open = openId === item.question_id;
                const explanation = item.explanation as ExplainResult | null;
                return (
                  <div
                    key={item.id}
                    className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm"
                  >
                    <div className="flex items-start gap-3 px-4 py-4">
                      {item.is_correct ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleExpand(item)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="text-sm font-medium text-slate-800">
                          Q{i + 1}: {item.question_text}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-brand">
                            {item.chapter}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                              item.is_correct
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-red-50 text-red-600"
                            }`}
                          >
                            {item.is_correct ? "Correct" : "Wrong"} · Your pick:{" "}
                            {item.selected_option}
                          </span>
                          {!item.reviewed && (
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                              Not reviewed
                            </span>
                          )}
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => removeSaved(item.question_id)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"
                          aria-label="Remove from saved"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpand(item)}
                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"
                          aria-label={open ? "Collapse" : "View explanation"}
                        >
                          {open ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="space-y-4 border-t border-slate-100 bg-slate-50/70 px-4 py-4">
                        <div className="space-y-2">
                          {item.options.map((opt) => {
                            const isCorrect = opt.key === item.correct_option;
                            const isYours = opt.key === item.selected_option;
                            const isWrongPick = isYours && !item.is_correct;
                            let cls =
                              "border-slate-200 bg-white text-slate-600";
                            if (isCorrect) {
                              cls =
                                "border-emerald-300 bg-emerald-50 text-emerald-800";
                            }
                            if (isWrongPick) {
                              cls = "border-red-300 bg-red-50 text-red-800";
                            }
                            return (
                              <div
                                key={opt.key}
                                className={`flex items-start gap-3 rounded-xl border px-4 py-3 sm:items-center ${cls}`}
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold">
                                  {opt.key}
                                </span>
                                <span className="min-w-0 flex-1 break-words text-sm">
                                  {opt.text}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="rounded-xl border border-sky-100 bg-white p-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wide text-brand">
                              <Sparkles className="h-3.5 w-3.5" />
                              AI Explanation
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {explanation?.speech_id ? (
                                <SpeechControls
                                  speechId={explanation.speech_id}
                                  variant="primary"
                                />
                              ) : null}
                              <button
                                type="button"
                                onClick={() =>
                                  setAskOpenId((id) =>
                                    id === item.question_id
                                      ? null
                                      : item.question_id
                                  )
                                }
                                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-dark"
                              >
                                {askOpenId === item.question_id
                                  ? "Hide chat"
                                  : `Ask ${doctor.displayName}`}
                              </button>
                            </div>
                          </div>
                          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                            {explanation?.explanation ||
                              "No explanation was saved with this MCQ. It may have been from timed mode — use Ask Doctor for help."}
                          </p>
                          {askOpenId === item.question_id && (
                            <div className="mt-4">
                              <AskAI
                                embedded
                                doctor={doctor}
                                concept={item.chapter}
                                onClose={() => setAskOpenId(null)}
                                mcq={{
                                  question_text: item.question_text,
                                  options: item.options,
                                  selected_option: item.selected_option,
                                  correct_option: item.correct_option,
                                  explanation:
                                    explanation?.explanation || "",
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
