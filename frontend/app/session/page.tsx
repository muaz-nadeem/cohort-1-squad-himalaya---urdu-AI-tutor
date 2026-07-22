"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  type ExplainResult,
  type Question,
  type QuestionSet,
  type ReviewItem,
  type SessionMode,
} from "@/lib/api";
import { getStudentId } from "@/lib/student";
import AskAI from "@/components/AskAI";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Frown,
  Smile,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";

function modeLabel(mode: SessionMode) {
  switch (mode) {
    case "diagnostic":
      return "Diagnostic";
    case "chapter_practice":
      return "Chapter Practice";
    case "full_length_practice":
      return "Full-length Mock";
    case "full_length_timed":
      return "Full-length Mock";
    case "custom":
      return "Custom Quiz";
    case "drill":
      return "Drill";
    default:
      return mode;
  }
}

function SessionInner() {
  const router = useRouter();
  const params = useSearchParams();

  const [studentId, setStudentId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [set, setSet] = useState<QuestionSet | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [explanation, setExplanation] = useState<ExplainResult | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const startedRef = useRef(false);
  const timedOutRef = useRef(false);
  const reviewRef = useRef<ReviewItem[]>([]);
  const scoreRef = useRef(0);
  const answeredRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const explainParam = params.get("explain");
  const flpMode = (params.get("flp") as "practice" | "timed") || "practice";

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const id = getStudentId();
    if (!id) {
      router.replace("/");
      return;
    }
    setStudentId(id);
    startedAtRef.current = Date.now();
    window.sessionStorage.setItem(
      "mdcat_session_started_at",
      String(startedAtRef.current)
    );

    const mode = params.get("mode") || "auto";
    const chapter = params.get("chapter") || undefined;
    const conceptId = params.get("concept_id") || undefined;
    const customRaw = params.get("custom");

    (async () => {
      try {
        let qs: QuestionSet;
        if (mode === "diagnostic") {
          qs = await api.getDiagnostic(id);
        } else if (mode === "chapter" && chapter) {
          qs = await api.getChapterPractice(chapter, 100);
        } else if (mode === "full_length") {
          qs = await api.getFullLength(flpMode);
        } else if (mode === "custom" && customRaw) {
          const selections = JSON.parse(decodeURIComponent(customRaw));
          qs = await api.getCustomQuiz(selections);
        } else {
          qs = await api.getQuestions(id, { chapter, concept_id: conceptId });
        }

        if (!qs.questions.length) {
          setError(
            "No questions in the bank yet. Run: python -m scripts.ingest_mcqs"
          );
          setLoading(false);
          return;
        }
        setSet(qs);
        if (qs.timed_seconds) setSecondsLeft(qs.timed_seconds);

        const session = await api.startSession({
          student_id: id,
          mode: qs.mode,
          concept_id: qs.concept_id,
          chapter: qs.chapter || chapter,
        });
        setSessionId(session.id);
        sessionIdRef.current = session.id;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to start session");
      } finally {
        setLoading(false);
      }
    })();
  }, [params, router, flpMode]);

  useEffect(() => {
    if (secondsLeft === null || selected) return;
    if (secondsLeft <= 0) {
      if (!timedOutRef.current) {
        timedOutRef.current = true;
        finish();
      }
      return;
    }
    const t = setTimeout(
      () => setSecondsLeft((s) => (s === null ? s : s - 1)),
      1000
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, selected]);

  const question: Question | undefined = set?.questions[index];
  const conceptName = explanation?.concept || question?.chapter || "Biology";

  const isTimedExam = set?.mode === "full_length_timed";
  const isFlpPractice = set?.mode === "full_length_practice";
  const reviewAtEnd =
    isTimedExam ||
    explainParam === "end" ||
    (isFlpPractice && explainParam !== "each");
  const showExplainNow = !reviewAtEnd;

  async function selectOption(key: string) {
    if (selected || !question || !studentId) return;
    setSelected(key);
    try {
      const res = await api.logAttempt({
        student_id: studentId,
        question_id: question.id,
        selected_option: key,
        session_id: sessionId || undefined,
      });
      setIsCorrect(res.is_correct);
      setAnswered((a) => {
        const n = a + 1;
        answeredRef.current = n;
        return n;
      });
      if (res.is_correct) {
        setScore((s) => {
          const n = s + 1;
          scoreRef.current = n;
          return n;
        });
      }

      reviewRef.current.push({
        question_id: question.id,
        question_text: question.question_text,
        chapter: question.chapter || "Biology",
        options: question.options,
        selected_option: key,
        correct_option: res.correct_option,
        is_correct: res.is_correct,
      });

      if (showExplainNow) {
        setExplaining(true);
        const exp = await api.explain({
          question_id: question.id,
          concept: question.chapter,
          selected_option: optionText(question, key),
          correct_option: optionText(question, res.correct_option),
        });
        setExplanation(exp);
        setExplaining(false);
      } else {
        setTimeout(() => nextAfterAnswer(), 450);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit answer");
      setExplaining(false);
    }
  }

  function nextAfterAnswer() {
    setSelected(null);
    setIsCorrect(null);
    setExplanation(null);
    if (!set) return;
    if (index >= set.questions.length - 1) {
      finish();
    } else {
      setIndex((i) => i + 1);
    }
  }

  async function finish() {
    const sid = sessionIdRef.current;
    if (!sid) {
      router.replace("/dashboard");
      return;
    }
    try {
      const summary = await api.endSession(sid, {
        score: scoreRef.current,
        total: answeredRef.current,
      });
      window.sessionStorage.setItem("mdcat_summary", JSON.stringify(summary));
      window.sessionStorage.setItem(
        "mdcat_review",
        JSON.stringify(reviewRef.current)
      );
    } catch {
      window.sessionStorage.setItem(
        "mdcat_review",
        JSON.stringify(reviewRef.current)
      );
    }
    router.replace("/summary");
  }

  if (loading) return <Centered text="Loading session..." />;
  if (error)
    return (
      <Centered
        text={error}
        isError
        onBack={() => router.replace("/dashboard")}
      />
    );
  if (!question || !set)
    return (
      <Centered text="No questions." onBack={() => router.replace("/dashboard")} />
    );

  const progress = ((index + 1) / set.questions.length) * 100;
  const mm = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const ss = secondsLeft !== null ? secondsLeft % 60 : 0;
  const hh = secondsLeft !== null ? Math.floor(secondsLeft / 3600) : 0;
  const timerLabel =
    secondsLeft === null
      ? null
      : hh > 0
        ? `${hh.toString().padStart(2, "0")}:${Math.floor((secondsLeft % 3600) / 60)
            .toString()
            .padStart(2, "0")}:${ss.toString().padStart(2, "0")}`
        : `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;

  const scorePct = answered ? Math.round((score / answered) * 100) : 0;
  const showSidebar = !!(selected && showExplainNow);

  return (
    <div className="min-h-screen bg-[#F4F7FB]">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => router.replace("/dashboard")}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            <X className="h-4 w-4" />
            Exit Session
          </button>

          <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-brand">
            {modeLabel(set.mode)}
          </span>

          <div className="flex items-center gap-2">
            {timerLabel && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold tabular-nums ${
                  secondsLeft !== null && secondsLeft < 300
                    ? "bg-red-50 text-red-600"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                <Clock className="h-3.5 w-3.5" />
                {timerLabel}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-[200px] flex-1">
            <p className="text-[10px] font-bold tracking-wider text-slate-400">
              PROGRESS
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-800">
              Q {index + 1} / {set.questions.length}
            </p>
            <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-sky-100">
              <div
                className="h-full rounded-full bg-sky-400 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          {!reviewAtEnd && (
            <div className="text-right">
              <p className="text-[10px] font-bold tracking-wider text-slate-400">
                Current Score
              </p>
              <p className="mt-1 text-sm font-semibold text-brand">
                {score}/{answered || 0}
                {answered > 0 ? ` (${scorePct}%)` : ""}
              </p>
            </div>
          )}
          {reviewAtEnd && (
            <div className="text-right">
              <p className="text-[10px] font-bold tracking-wider text-slate-400">
                Answered
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {answered}/{set.questions.length}
              </p>
            </div>
          )}
        </div>

        <div
          className={`grid gap-6 ${
            showSidebar ? "lg:grid-cols-[1.45fr_0.9fr]" : ""
          }`}
        >
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-brand px-2.5 py-1 text-[10px] font-bold tracking-wider text-white">
                BIOLOGY
              </span>
              {question.chapter && (
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {question.chapter}
                </span>
              )}
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-base font-medium leading-relaxed text-slate-800 sm:text-lg">
                {question.question_text}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {question.options.map((opt) => {
                const isSel = selected === opt.key;
                const isRight =
                  showExplainNow &&
                  explanation &&
                  opt.key === question.correct_option;
                const isWrongPick =
                  showExplainNow && isSel && isCorrect === false;
                let cls =
                  "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50";
                if (selected) {
                  if (isRight) cls = "border-brand bg-sky-50 text-brand-700";
                  else if (isWrongPick)
                    cls = "border-red-400 bg-red-50 text-red-800";
                  else if (isSel && reviewAtEnd)
                    cls = "border-brand bg-brand-50 text-brand";
                  else cls = "border-slate-200 bg-white opacity-50";
                }
                return (
                  <button
                    key={opt.key}
                    disabled={!!selected}
                    onClick={() => selectOption(opt.key)}
                    className={`flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition-all ${cls}`}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold">
                      {opt.key}
                    </span>
                    <span className="flex-1 text-sm sm:text-[15px]">
                      {opt.text}
                    </span>
                    {selected && isRight && (
                      <CheckCircle2 className="h-5 w-5 text-brand" />
                    )}
                    {isWrongPick && <XCircle className="h-5 w-5 text-red-500" />}
                  </button>
                );
              })}
            </div>

            {selected && showExplainNow && (
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={finish}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Finish Session
                </button>
                <button
                  type="button"
                  onClick={nextAfterAnswer}
                  className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  {index >= set.questions.length - 1
                    ? "Finish Session"
                    : "Next Question →"}
                </button>
              </div>
            )}
          </div>

          {showSidebar && (
            <aside className="space-y-4">
              <div
                className={`rounded-2xl border p-4 ${
                  isCorrect
                    ? "border-emerald-100 bg-emerald-50"
                    : "border-red-100 bg-red-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      isCorrect
                        ? "bg-emerald-100 text-emerald-600"
                        : "bg-red-100 text-red-500"
                    }`}
                  >
                    {isCorrect ? (
                      <Smile className="h-4 w-4" />
                    ) : (
                      <Frown className="h-4 w-4" />
                    )}
                  </div>
                  <p
                    className={`text-sm leading-relaxed ${
                      isCorrect ? "text-emerald-800" : "text-red-700"
                    }`}
                  >
                    {isCorrect
                      ? "Nice work. Lock this concept in before you move on."
                      : "Not quite. Don't worry — even doctors make mistakes in training. Let's understand why."}
                  </p>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="flex items-center justify-between bg-brand-700 px-4 py-3 text-white">
                  <div className="inline-flex items-center gap-2 text-xs font-bold tracking-wider">
                    <Sparkles className="h-3.5 w-3.5" />
                    AI INSIGHT
                  </div>
                  <span className="text-[10px] text-sky-200">Uraan AI</span>
                </div>
                <div className="p-4">
                  {explaining ? (
                    <p className="text-sm text-slate-400">
                      Generating explanation...
                    </p>
                  ) : explanation ? (
                    <>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                        {explanation.explanation}
                      </p>
                      {explanation.citation && (
                        <div className="mt-4 flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-xs text-brand">
                          <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{explanation.citation}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {question.explanation ||
                        "Review this concept in your textbook."}
                    </p>
                  )}
                </div>
              </div>

              <AskAI concept={conceptName} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function optionText(q: Question, key: string): string {
  return q.options.find((o) => o.key === key)?.text || key;
}

function Centered({
  text,
  isError,
  onBack,
}: {
  text: string;
  isError?: boolean;
  onBack?: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F4F7FB] px-4">
      <p
        className={`max-w-md text-center text-sm ${
          isError ? "text-red-500" : "text-slate-400"
        }`}
      >
        {text}
      </p>
      {onBack && (
        <button onClick={onBack} className="btn-ghost">
          Back to dashboard
        </button>
      )}
    </div>
  );
}

export default function SessionPage() {
  return (
    <Suspense fallback={<Centered text="Loading..." />}>
      <SessionInner />
    </Suspense>
  );
}
