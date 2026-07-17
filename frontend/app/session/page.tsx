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
import Navbar from "@/components/Navbar";
import { ArrowLeft, CheckCircle, Clock, XCircle } from "lucide-react";

function modeLabel(mode: SessionMode) {
  switch (mode) {
    case "diagnostic":
      return "Diagnostic";
    case "chapter_practice":
      return "Chapter Practice";
    case "full_length_practice":
      return "FLP · Practice";
    case "full_length_timed":
      return "FLP · Timed";
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

  const explainParam = params.get("explain"); // each | end | null
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
    const t = setTimeout(() => setSecondsLeft((s) => (s === null ? s : s - 1)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, selected]);

  const question: Question | undefined = set?.questions[index];
  const conceptName = explanation?.concept || question?.chapter || "Biology";

  const isTimedExam = set?.mode === "full_length_timed";
  const isFlpPractice = set?.mode === "full_length_practice";
  // Timed always end-review; practice uses ?explain=; other modes show each
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

  async function next() {
    nextAfterAnswer();
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
    // Always go to summary; review section shows if mdcat_review exists
    router.replace("/summary");
  }

  if (loading) return <Centered text="Loading session..." />;
  if (error)
    return (
      <Centered text={error} isError onBack={() => router.replace("/dashboard")} />
    );
  if (!question || !set)
    return <Centered text="No questions." onBack={() => router.replace("/dashboard")} />;

  const progress = ((index + 1) / set.questions.length) * 100;
  const mm = secondsLeft !== null ? Math.floor(secondsLeft / 60) : 0;
  const ss = secondsLeft !== null ? secondsLeft % 60 : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <button
          onClick={() => router.replace("/dashboard")}
          className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" /> Exit
        </button>
        <div className="flex items-center gap-2">
          {secondsLeft !== null && (
            <span
              className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                secondsLeft < 300 ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              {mm}:{ss.toString().padStart(2, "0")}
            </span>
          )}
          <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand">
            {modeLabel(set.mode)}
            {reviewAtEnd && !isTimedExam ? " · End review" : ""}
          </span>
        </div>
      </header>

      <div className="mb-6">
        <div className="mb-2 flex justify-between text-sm text-slate-500">
          <span>
            Question {index + 1} / {set.questions.length}
          </span>
          {!reviewAtEnd && (
            <span>
              Score {score}/{answered}
            </span>
          )}
          {reviewAtEnd && <span>Answered {answered}</span>}
        </div>
        <div className="progress-bar">
          <div className="progress-bar-fill bg-brand" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        {question.chapter && (
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            {question.chapter}
          </p>
        )}
        <p className="text-lg font-medium text-slate-800">{question.question_text}</p>
      </div>

      <div className="space-y-3">
        {question.options.map((opt) => {
          const isSel = selected === opt.key;
          const isRight =
            showExplainNow && explanation && opt.key === question.correct_option;
          const isWrongPick = showExplainNow && isSel && isCorrect === false;
          let cls =
            "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50";
          if (selected) {
            if (isRight) cls = "border-green-500 bg-green-50 text-green-800";
            else if (isWrongPick) cls = "border-red-500 bg-red-50 text-red-800";
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
              <span className="flex-1">{opt.text}</span>
              {selected && isRight && <CheckCircle className="h-5 w-5 text-green-500" />}
              {isWrongPick && <XCircle className="h-5 w-5 text-red-500" />}
            </button>
          );
        })}
      </div>

      {selected && showExplainNow && (
        <div className="mt-6 space-y-4">
          <div
            className={`rounded-2xl border p-5 ${
              isCorrect ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
            }`}
          >
            <p className="mb-2 font-semibold">
              {isCorrect ? "Correct!" : "Not quite."}
            </p>
            {explaining ? (
              <p className="text-sm text-slate-500">Generating explanation...</p>
            ) : explanation ? (
              <>
                <p className="whitespace-pre-line text-sm text-slate-700">
                  {explanation.explanation}
                </p>
                {explanation.citation && (
                  <p className="mt-2 text-xs text-slate-400">{explanation.citation}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">
                {question.explanation || "Review this concept in your textbook."}
              </p>
            )}
          </div>

          <AskAI concept={conceptName} />

          <button onClick={next} className="btn-primary w-full">
            {index >= set.questions.length - 1 ? "Finish session" : "Next question →"}
          </button>
        </div>
      )}
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <p className={`max-w-md text-center text-sm ${isError ? "text-red-500" : "text-slate-400"}`}>
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
    <>
      <Navbar />
      <Suspense fallback={<Centered text="Loading..." />}>
        <SessionInner />
      </Suspense>
    </>
  );
}
