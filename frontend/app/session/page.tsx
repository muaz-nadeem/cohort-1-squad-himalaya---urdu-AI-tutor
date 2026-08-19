"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  isBackendLikelyAwake,
  wakeBackend,
  speechStreamUrl,
  type ExplainResult,
  type Question,
  type QuestionSet,
  type ReviewItem,
  type SessionMode,
} from "@/lib/api";
import { getStudentId } from "@/lib/student";
import { syncStudentCacheFromSession } from "@/lib/auth";
import { getDoctorPersona } from "@/lib/doctorPersona";
import AskAI from "@/components/AskAI";
import {
  Bookmark,
  CheckCircle2,
  Clock,
  Flag,
  Frown,
  Loader2,
  Smile,
  Sparkles,
  Volume2,
  X,
  XCircle,
} from "lucide-react";

type QState = {
  selected: string | null;
  isCorrect: boolean | null;
  revealedCorrect: string | null;
  explanation: ExplainResult | null;
  flagged: boolean;
};

const EMPTY_Q: QState = {
  selected: null,
  isCorrect: null,
  revealedCorrect: null,
  explanation: null,
  flagged: false,
};

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
  const [qStates, setQStates] = useState<Record<number, QState>>({});
  const [explaining, setExplaining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusText, setStatusText] = useState("Starting session...");
  const [error, setError] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [speakingExplain, setSpeakingExplain] = useState(false);
  const [navFilter, setNavFilter] = useState<"all" | "flagged" | "wrong">(
    "all"
  );
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [exiting, setExiting] = useState(false);
  const startedRef = useRef(false);
  const timedOutRef = useRef(false);
  const explainAudioRef = useRef<HTMLAudioElement | null>(null);
  const reviewRef = useRef<ReviewItem[]>([]);
  const scoreRef = useRef(0);
  const answeredRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());

  const doctor = useMemo(() => getDoctorPersona(studentId), [studentId]);
  const current = qStates[index] ?? EMPTY_Q;
  const {
    selected,
    isCorrect,
    revealedCorrect,
    explanation,
    flagged,
  } = current;

  function patchQ(i: number, patch: Partial<QState>) {
    setQStates((prev) => ({
      ...prev,
      [i]: { ...(prev[i] ?? EMPTY_Q), ...patch },
    }));
  }

  function syncScoreFromStates(next: Record<number, QState>) {
    const vals = Object.values(next);
    const a = vals.filter((s) => s.isCorrect !== null).length;
    const s = vals.filter((s) => s.isCorrect === true).length;
    answeredRef.current = a;
    scoreRef.current = s;
  }

  const explainParam = params.get("explain");
  const flpMode = (params.get("flp") as "practice" | "timed") || "practice";
  const isTimedExamEarly = set?.mode === "full_length_timed";
  const reviewAtEndEarly = isTimedExamEarly || explainParam === "end";
  const showExplainNow = !reviewAtEndEarly;

  /**
   * Make sure a student row exists, but never on the critical path — the
   * questions and session endpoints create one implicitly when needed, so this
   * only has to win the race in the rare "brand new account" case.
   */
  async function ensureProfileInBackground() {
    try {
      await api.getStudent();
    } catch (profileErr) {
      const profileMsg = String((profileErr as Error)?.message || profileErr);
      // 404 "Student not found" is expected until profile is created.
      if (!/Student not found/i.test(profileMsg) && !/404/.test(profileMsg)) {
        return;
      }
      try {
        await api.createStudent({
          name: undefined,
          level: "just_starting",
          daily_time: "1hr",
        });
      } catch {
        /* surfaced by the questions call if it actually matters */
      }
    }
  }

  async function bootSession() {
    setLoading(true);
    setError("");
    setStatusText("Loading questions...");

    startedAtRef.current = Date.now();
    window.sessionStorage.setItem(
      "mdcat_session_started_at",
      String(startedAtRef.current)
    );

    const mode = params.get("mode") || "auto";
    const chapter = params.get("chapter") || undefined;
    const conceptId = params.get("concept_id") || undefined;
    const customRaw = params.get("custom");

    try {
      // localStorage already holds the id on every in-app entry point; verify
      // against Supabase in parallel rather than blocking the first request.
      const id = getStudentId();
      const syncP = syncStudentCacheFromSession();
      if (!id) {
        const synced = await syncP;
        if (!synced) {
          router.replace("/login");
          return;
        }
        setStudentId(synced);
      } else {
        setStudentId(id);
      }
      const studentIdForBoot = id || (await syncP);
      if (!studentIdForBoot) {
        router.replace("/login");
        return;
      }

      // Only pay for a health poll when we have no recent proof the API is up.
      if (!isBackendLikelyAwake()) {
        setStatusText("Waking server...");
        const awake = await wakeBackend(90_000);
        if (!awake) {
          setError(
            "Server did not wake up in time. Open the site again in a minute, or check Render / UptimeRobot."
          );
          return;
        }
      }

      void ensureProfileInBackground();

      setStatusText(
        mode === "chapter"
          ? "Loading chapter MCQs..."
          : "Loading questions..."
      );

      let questionsP: Promise<QuestionSet>;
      let sessionMode: string | null = null;
      if (mode === "diagnostic") {
        questionsP = api.getDiagnostic(studentIdForBoot);
        sessionMode = "diagnostic";
      } else if (mode === "chapter" && chapter) {
        questionsP = api.getChapterPractice(chapter, 100, studentIdForBoot);
        sessionMode = "chapter_practice";
      } else if (mode === "full_length") {
        questionsP = api.getFullLength(flpMode, studentIdForBoot);
        sessionMode =
          flpMode === "timed" ? "full_length_timed" : "full_length_practice";
      } else if (mode === "custom" && customRaw) {
        const selections = JSON.parse(decodeURIComponent(customRaw));
        questionsP = api.getCustomQuiz(selections, studentIdForBoot);
        sessionMode = "custom";
      } else {
        questionsP = api.getQuestions(studentIdForBoot, {
          chapter,
          concept_id: conceptId,
        });
      }

      // When the mode is known up front, the session row doesn't depend on the
      // question set — open it alongside instead of after, saving a round-trip.
      const sessionP = sessionMode
        ? api.startSession({
            student_id: studentIdForBoot,
            mode: sessionMode,
            concept_id: conceptId,
            chapter,
          })
        : null;

      const qs = await questionsP;
      if (!qs.questions.length) {
        setError(
          "No questions available for this chapter yet. Try another chapter."
        );
        return;
      }
      setSet(qs);
      if (qs.timed_seconds) setSecondsLeft(qs.timed_seconds);

      const session = await (sessionP ??
        api.startSession({
          student_id: studentIdForBoot,
          mode: qs.mode,
          concept_id: conceptId || qs.concept_id,
          chapter: chapter || qs.chapter,
        }));
      setSessionId(session.id);
      sessionIdRef.current = session.id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start session";
      setError(
        msg === "Failed to fetch"
          ? "Could not reach the server. Tap Try again in a few seconds."
          : msg
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, router, flpMode]);

  useEffect(() => {
    // Timed exam: the clock must keep running even while an answer is selected.
    if (secondsLeft === null) return;
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
  }, [secondsLeft]);

  const question: Question | undefined = set?.questions[index];
  const conceptName = explanation?.concept || question?.chapter || "Biology";

  const isTimedExam = set?.mode === "full_length_timed";
  const reviewAtEnd = isTimedExam || explainParam === "end";

  async function selectOption(key: string) {
    if (!question || !studentId) return;
    // Already graded — locked.
    if (current.isCorrect !== null) return;
    // Answer in flight.
    if (current.selected) return;
    patchQ(index, { selected: key });
    try {
      const res = await api.logAttempt({
        student_id: studentId,
        question_id: question.id,
        selected_option: key,
        session_id: sessionId || undefined,
      });
      setQStates((prev) => {
        const next = {
          ...prev,
          [index]: {
            ...(prev[index] ?? EMPTY_Q),
            selected: key,
            isCorrect: res.is_correct,
            revealedCorrect: res.correct_option,
            flagged: prev[index]?.flagged ?? false,
            explanation: prev[index]?.explanation ?? null,
          },
        };
        syncScoreFromStates(next);
        return next;
      });

      const item: ReviewItem = {
        question_id: question.id,
        question_text: question.question_text,
        chapter: question.chapter || "Biology",
        options: question.options,
        selected_option: key,
        correct_option: res.correct_option,
        is_correct: res.is_correct,
      };
      const ri = reviewRef.current.findIndex(
        (r) => r.question_id === question.id
      );
      if (ri >= 0) reviewRef.current[ri] = item;
      else reviewRef.current.push(item);

      if (showExplainNow) {
        setExplaining(true);
        try {
          const exp = await api.explain({
            question_id: question.id,
            concept: question.chapter,
            selected_option: optionText(question, key),
            correct_option: optionText(question, res.correct_option),
            speak: true,
          });
          patchQ(index, { explanation: exp });
        } catch {
          patchQ(index, {
            explanation: {
              explanation: `The correct answer is: ${optionText(question, res.correct_option)}`,
              answer: "",
              audio: null,
              concept: question.chapter || "Biology",
              citation: null,
              sources: [],
            },
          });
        }
        setExplaining(false);
      } else {
        setTimeout(() => nextAfterAnswer(), 450);
      }
    } catch (e) {
      patchQ(index, { selected: null });
      setError(e instanceof Error ? e.message : "Failed to submit answer");
      setExplaining(false);
    }
  }

  function goToQuestion(i: number) {
    if (!set || i < 0 || i >= set.questions.length || i === index) return;
    if (explainAudioRef.current) {
      explainAudioRef.current.pause();
      explainAudioRef.current = null;
    }
    setSpeakingExplain(false);
    setExplaining(false);
    setConfirmEnd(false);
    setIndex(i);
  }

  function markForReview() {
    patchQ(index, { flagged: true });
  }

  function toggleFlag() {
    patchQ(index, { flagged: !flagged });
  }

  function nextAfterAnswer() {
    if (explainAudioRef.current) {
      explainAudioRef.current.pause();
      explainAudioRef.current = null;
    }
    setSpeakingExplain(false);
    if (!set) return;
    if (navFilter === "flagged" || navFilter === "wrong") {
      const pool =
        navFilter === "flagged"
          ? set.questions
              .map((_, i) => i)
              .filter((i) => (qStates[i] ?? EMPTY_Q).flagged)
          : set.questions
              .map((_, i) => i)
              .filter((i) => (qStates[i] ?? EMPTY_Q).isCorrect === false);
      const next = pool.find((i) => i > index) ?? pool.find((i) => i < index);
      if (next !== undefined) {
        goToQuestion(next);
        return;
      }
    }
    if (index >= set.questions.length - 1) {
      requestEnd();
    } else {
      goToQuestion(index + 1);
    }
  }

  function requestEnd() {
    if (!set) {
      void finish();
      return;
    }
    const wrongN = set.questions.filter(
      (_, i) => (qStates[i] ?? EMPTY_Q).isCorrect === false
    ).length;
    const flagN = set.questions.filter(
      (_, i) => (qStates[i] ?? EMPTY_Q).flagged
    ).length;
    if (wrongN > 0 || flagN > 0) {
      setConfirmEnd(true);
      return;
    }
    void finish();
  }

  function exitSession() {
    if (exiting) return;
    setExiting(true);
    setConfirmEnd(false);
    // Close the session properly, but as a keepalive request — the student is
    // leaving and nothing on the dashboard depends on the response, so there's
    // no reason to hold them behind a round-trip.
    const sid = sessionIdRef.current;
    if (sid) {
      void api.endSessionDetached(sid, {
        score: scoreRef.current,
        total: answeredRef.current,
      });
    }
    router.replace("/dashboard");
  }

  async function playExplanation() {
    const id = explanation?.speech_id;
    if (!id) return;
    const url = await speechStreamUrl(id);
    if (!url) return;
    if (explainAudioRef.current) {
      explainAudioRef.current.pause();
    }
    const audio = new Audio(url);
    explainAudioRef.current = audio;
    setSpeakingExplain(true);
    audio.onended = () => setSpeakingExplain(false);
    audio.onerror = () => setSpeakingExplain(false);
    audio.play().catch(() => setSpeakingExplain(false));
  }

  async function finish() {
    if (exiting) return;
    setExiting(true);
    setConfirmEnd(false);
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

  if (loading) return <Centered text={statusText || "Loading session..."} />;
  if (error)
    return (
      <Centered
        text={error}
        isError
        onRetry={() => {
          startedRef.current = false;
          void bootSession();
        }}
        onBack={() => router.replace("/dashboard")}
      />
    );
  if (!question || !set)
    return (
      <Centered text="No questions." onBack={() => router.replace("/dashboard")} />
    );

  const answered = Object.values(qStates).filter(
    (s) => s.isCorrect !== null
  ).length;
  const score = Object.values(qStates).filter(
    (s) => s.isCorrect === true
  ).length;
  const scorePct = answered ? Math.round((score / answered) * 100) : 0;
  const showSidebar = !!(selected && showExplainNow);
  const graded = isCorrect !== null;
  const revealColors = !reviewAtEnd;
  const flaggedCount = set.questions.filter(
    (_, i) => (qStates[i] ?? EMPTY_Q).flagged
  ).length;
  const wrongCount = set.questions.filter(
    (_, i) => (qStates[i] ?? EMPTY_Q).isCorrect === false
  ).length;

  function boxClass(i: number) {
    const st = qStates[i] ?? EMPTY_Q;
    const isCurrent = i === index;
    const currentRing = isCurrent ? " ring-2 ring-offset-1 ring-brand/40" : "";

    // Grade color wins immediately — don't wait until the student leaves the question.
    if (revealColors && st.isCorrect === true) {
      return `border-emerald-500 bg-emerald-500 text-white${currentRing}`;
    }
    if (revealColors && st.isCorrect === false) {
      return `border-red-500 bg-red-500 text-white${currentRing}`;
    }
    if (isCurrent) {
      return "border-brand bg-brand text-white ring-2 ring-brand/30";
    }
    if (st.flagged) {
      return "border-amber-400 bg-amber-50 text-amber-800";
    }
    if (st.selected && reviewAtEnd) {
      return "border-slate-400 bg-slate-200 text-slate-700";
    }
    return "border-slate-200 bg-white text-slate-600 hover:border-slate-300";
  }

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

  return (
    <div className="min-h-screen bg-[#F4F7FB]">
      {exiting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
            Ending session…
          </div>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={exitSession}
            disabled={exiting}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-60"
          >
            {exiting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            {exiting ? "Ending…" : "Exit Session"}
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
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold tracking-wider text-slate-400">
                PROGRESS
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                Q {index + 1} / {set.questions.length}
              </p>
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

          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ["all", "All"],
                ["flagged", `Review (${flaggedCount})`],
                ["wrong", `Wrong (${wrongCount})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setNavFilter(id);
                  if (id === "flagged" && flaggedCount > 0) {
                    const first = set.questions.findIndex(
                      (_, i) => (qStates[i] ?? EMPTY_Q).flagged
                    );
                    if (first >= 0) goToQuestion(first);
                  }
                  if (id === "wrong" && wrongCount > 0) {
                    const first = set.questions.findIndex(
                      (_, i) => (qStates[i] ?? EMPTY_Q).isCorrect === false
                    );
                    if (first >= 0) goToQuestion(first);
                  }
                }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  navFilter === id
                    ? "bg-brand text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto hidden items-center gap-3 text-[10px] text-slate-400 sm:inline-flex">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Correct
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Wrong
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Current
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Review
              </span>
            </span>
          </div>

          <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-100 bg-white p-2 shadow-sm sm:max-h-none">
            <div className="flex flex-wrap gap-1.5">
              {set.questions.map((_, i) => {
                const st = qStates[i] ?? EMPTY_Q;
                if (navFilter === "flagged" && !st.flagged) return null;
                if (navFilter === "wrong" && st.isCorrect !== false) return null;
                return (
                  <button
                    key={i}
                    type="button"
                    title={`Question ${i + 1}`}
                    onClick={() => goToQuestion(i)}
                    className={`relative flex h-7 w-7 items-center justify-center rounded-md border text-[10px] font-bold tabular-nums transition sm:h-8 sm:w-8 sm:text-[11px] ${boxClass(i)}`}
                  >
                    {i + 1}
                    {st.flagged && i !== index && (
                      <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
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
              <button
                type="button"
                onClick={toggleFlag}
                className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  flagged
                    ? "bg-amber-100 text-amber-800"
                    : "bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                <Bookmark
                  className={`h-3.5 w-3.5 ${flagged ? "fill-current" : ""}`}
                />
                {flagged ? "Marked for review" : "Mark for review"}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
              <p className="text-base font-medium leading-relaxed text-slate-800 sm:text-lg">
                {question.question_text}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {question.options.map((opt) => {
                const isSel = selected === opt.key;
                const shouldHighlight = showSidebar && explanation;
                const isRight =
                  shouldHighlight &&
                  !!revealedCorrect &&
                  opt.key === revealedCorrect;
                const isWrongPick =
                  shouldHighlight && isSel && isCorrect === false;
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
                    {isRight && (
                      <CheckCircle2 className="h-5 w-5 text-brand" />
                    )}
                    {isWrongPick && <XCircle className="h-5 w-5 text-red-500" />}
                  </button>
                );
              })}
            </div>

            {selected && showSidebar && graded && (
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={requestEnd}
                  disabled={exiting}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  Finish Session
                </button>
                <button
                  type="button"
                  onClick={nextAfterAnswer}
                  disabled={exiting}
                  className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {index >= set.questions.length - 1
                    ? "Finish Session"
                    : "Next Question →"}
                </button>
              </div>
            )}

            {!selected && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={flagged ? toggleFlag : markForReview}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold ${
                    flagged
                      ? "border-amber-300 bg-amber-100 text-amber-900"
                      : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  <Flag
                    className={`h-4 w-4 ${flagged ? "fill-current" : ""}`}
                  />
                  {flagged ? "Marked for review" : "Leave for review"}
                </button>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={requestEnd}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Finish Session
                  </button>
                  {flagged && (
                    <button
                      type="button"
                      onClick={nextAfterAnswer}
                      className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                    >
                      {index >= set.questions.length - 1
                        ? "Finish Session"
                        : "Next Question →"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {confirmEnd && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold text-slate-800">
                  Review before you quit?
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  You can jump back to marked or wrong questions first.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {flaggedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmEnd(false);
                        setNavFilter("flagged");
                        const first = set.questions.findIndex(
                          (_, i) => (qStates[i] ?? EMPTY_Q).flagged
                        );
                        if (first >= 0) goToQuestion(first);
                      }}
                      className="rounded-xl bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-900"
                    >
                      Review marked ({flaggedCount})
                    </button>
                  )}
                  {wrongCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmEnd(false);
                        setNavFilter("wrong");
                        const first = set.questions.findIndex(
                          (_, i) =>
                            (qStates[i] ?? EMPTY_Q).isCorrect === false
                        );
                        if (first >= 0) goToQuestion(first);
                      }}
                      className="rounded-xl bg-red-100 px-3 py-2 text-xs font-semibold text-red-800"
                    >
                      Review wrong ({wrongCount})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmEnd(false);
                      void finish();
                    }}
                    className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white"
                  >
                    End anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(false)}
                    className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {showSidebar && (
            <aside className="space-y-4">
              <div
                className={`rounded-2xl border p-4 ${
                  !graded
                    ? "border-slate-100 bg-slate-50"
                    : isCorrect
                      ? "border-emerald-100 bg-emerald-50"
                      : "border-red-100 bg-red-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      !graded
                        ? "bg-slate-100 text-slate-400"
                        : isCorrect
                          ? "bg-emerald-100 text-emerald-600"
                          : "bg-red-100 text-red-500"
                    }`}
                  >
                    {!graded ? (
                      <Clock className="h-4 w-4 animate-pulse" />
                    ) : isCorrect ? (
                      <Smile className="h-4 w-4" />
                    ) : (
                      <Frown className="h-4 w-4" />
                    )}
                  </div>
                  <p
                    className={`text-sm leading-relaxed ${
                      !graded
                        ? "text-slate-500"
                        : isCorrect
                          ? "text-emerald-800"
                          : "text-red-700"
                    }`}
                  >
                    {!graded
                      ? "Checking your answer..."
                      : isCorrect
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
                  {explanation?.speech_id ? (
                    <button
                      type="button"
                      onClick={playExplanation}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-white/25 disabled:opacity-60"
                      disabled={speakingExplain}
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                      {speakingExplain ? "Playing..." : "Listen"}
                    </button>
                  ) : (
                    <span className="text-[10px] text-sky-200">Uraan AI</span>
                  )}
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
                    </>
                  ) : (
                    <p className="text-sm text-slate-500">
                      {question.explanation ||
                        "Review this concept in your textbook."}
                    </p>
                  )}
                </div>
              </div>

              <AskAI
                doctor={doctor}
                concept={conceptName}
                mcq={{
                  question_text: question.question_text,
                  options: question.options,
                  selected_option: selected || "",
                  correct_option: revealedCorrect || "",
                  explanation:
                    explanation?.explanation || question.explanation || "",
                }}
              />
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
  onRetry,
}: {
  text: string;
  isError?: boolean;
  onBack?: () => void;
  onRetry?: () => void;
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
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry && (
          <button onClick={onRetry} className="btn-primary">
            Try again
          </button>
        )}
        {onBack && (
          <button onClick={onBack} className="btn-ghost">
            Back to dashboard
          </button>
        )}
      </div>
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
