"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  api,
  isBackendLikelyAwake,
  wakeBackend,
  type ExplainResult,
  type Question,
  type QuestionSet,
  type ReviewItem,
  type SessionMode,
  type SessionSummary,
} from "@/lib/api";
import { getStudentId } from "@/lib/student";
import { syncStudentCacheFromSession } from "@/lib/auth";
import { setPendingSummary } from "@/lib/sessionHandoff";
import { getDoctorPersona } from "@/lib/doctorPersona";
import {
  clearChapterBatch,
  firstUnansweredIndex,
  isBatchComplete,
  loadChapterBatch,
  saveChapterBatch,
  type SavedQState,
} from "@/lib/chapterBatch";
import AskAI from "@/components/AskAI";
import SpeechControls from "@/components/SpeechControls";
import {
  Bookmark,
  CheckCircle2,
  Clock,
  Frown,
  Loader2,
  Menu,
  Smile,
  Sparkles,
  MessageCircle,
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

const FILL_CHUNK = 20;
const FLP_TOTAL = 81;
const PENDING_ID = (i: number) => `__pending_${i}`;

function padQuestionIds(ids: string[], total: number) {
  const out = ids.slice(0, total);
  while (out.length < total) out.push(PENDING_ID(out.length));
  return out;
}

function batchTotal(qs: QuestionSet) {
  return qs.question_ids?.length || qs.questions.length;
}

function questionAt(qs: QuestionSet, i: number): Question | undefined {
  const id = qs.question_ids?.[i];
  if (id) return qs.questions.find((q) => q.id === id);
  return qs.questions[i];
}

function mergeLoaded(prev: QuestionSet, incoming: Question[]): QuestionSet {
  const byId = new Map(prev.questions.map((q) => [q.id, q]));
  for (const q of incoming) byId.set(q.id, q);
  return { ...prev, questions: Array.from(byId.values()) };
}

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
  const [confirmExit, setConfirmExit] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [insightOpen, setInsightOpen] = useState(true);
  const [exiting, setExiting] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const startedRef = useRef(false);
  const timedOutRef = useRef(false);
  const explainAudioRef = useRef<HTMLAudioElement | null>(null);
  const reviewRef = useRef<ReviewItem[]>([]);
  const scoreRef = useRef(0);
  const answeredRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const skipBatchPersistRef = useRef(false);
  const chapterRef = useRef<string | undefined>(undefined);
  const qStatesRef = useRef<Record<number, QState>>({});
  const indexRef = useRef(0);
  const setRef = useRef<QuestionSet | null>(null);
  const studentIdRef = useRef<string | null>(null);
  const fillCancelRef = useRef(false);
  setRef.current = set;
  studentIdRef.current = studentId;

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
    setQStates((prev) => {
      const next = {
        ...prev,
        [i]: { ...(prev[i] ?? EMPTY_Q), ...patch },
      };
      qStatesRef.current = next;
      persistChapterProgress(next, indexRef.current);
      return next;
    });
  }

  function compactStates(states: Record<number, QState>): Record<number, SavedQState> {
    const out: Record<number, SavedQState> = {};
    for (const [k, v] of Object.entries(states)) {
      out[Number(k)] = {
        selected: v.selected,
        isCorrect: v.isCorrect,
        revealedCorrect: v.revealedCorrect,
        flagged: v.flagged,
      };
    }
    return out;
  }

  function persistChapterProgress(
    states: Record<number, QState> = qStatesRef.current,
    idx: number = indexRef.current
  ) {
    if (skipBatchPersistRef.current) return;
    const chapter = chapterRef.current;
    const currentSet = setRef.current;
    const sid = studentIdRef.current;
    if (!sid || !currentSet || currentSet.mode !== "chapter_practice" || !chapter) {
      return;
    }
    saveChapterBatch({
      studentId: sid,
      chapter,
      questionIds: currentSet.question_ids?.length
        ? currentSet.question_ids
        : currentSet.questions.map((q) => q.id),
      qStates: compactStates(states),
      index: idx,
    });
  }

  async function fillRemaining(
    ids: string[],
    already: Question[],
    chapterName: string | undefined,
    sid: string,
    startAt = 0
  ) {
    const loaded = new Set(already.map((q) => q.id));
    const pending = [
      ...ids.slice(startAt).filter((id) => !loaded.has(id)),
      ...ids.slice(0, startAt).filter((id) => !loaded.has(id)),
    ];
    for (let i = 0; i < pending.length; i += FILL_CHUNK) {
      if (fillCancelRef.current) return;
      const chunk = pending.slice(i, i + FILL_CHUNK);
      try {
        const more = await api.getQuestionsByIds(chunk, chapterName, sid);
        if (fillCancelRef.current) return;
        setSet((prev) => {
          if (!prev) return prev;
          const next = mergeLoaded(prev, more.questions);
          setRef.current = next;
          return next;
        });
      } catch {
        /* keep filling later chunks */
      }
    }
  }

  async function loadFullFlp(
    flpModeVal: "practice" | "timed",
    sid: string,
    preview: QuestionSet
  ) {
    try {
      const full = await api.getFullLength(flpModeVal, sid, 0);
      if (fillCancelRef.current || !full.questions.length) return;
      const previewQs = preview.questions;
      const previewIds = new Set(previewQs.map((q) => q.id));
      const extra = full.questions.filter((q) => !previewIds.has(q.id));
      const merged = [...previewQs, ...extra].slice(0, FLP_TOTAL);
      const allIds = padQuestionIds(
        merged.map((q) => q.id),
        FLP_TOTAL
      );
      setSet((prev) => {
        if (!prev) return prev;
        const next: QuestionSet = {
          ...prev,
          questions: merged,
          question_ids: allIds,
        };
        setRef.current = next;
        return next;
      });
    } catch {
      /* session continues with the preview questions */
    }
  }

  function restoreReview(qs: QuestionSet, states: Record<number, QState>) {
    const items: ReviewItem[] = [];
    const n = batchTotal(qs);
    for (let i = 0; i < n; i++) {
      const st = states[i];
      const q = questionAt(qs, i);
      if (!q || !st?.selected || st.isCorrect === null) continue;
      items.push({
        question_id: q.id,
        question_text: q.question_text,
        chapter: q.chapter || "Biology",
        options: q.options,
        selected_option: st.selected,
        correct_option: st.revealedCorrect || "",
        is_correct: st.isCorrect,
      });
    }
    reviewRef.current = items;
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
    chapterRef.current = chapter;

    // Tracked outside the try so a failed boot can close a session it opened.
    let sessionP: Promise<{ id: string }> | null = null;

    try {
      // localStorage already holds the id on every in-app entry point, so only
      // fall back to waiting on Supabase when there's nothing cached.
      const cachedId = getStudentId();
      const syncP = syncStudentCacheFromSession();
      if (cachedId) syncP.catch(() => {});
      const studentIdForBoot = cachedId || (await syncP);
      if (!studentIdForBoot) {
        router.replace("/login");
        return;
      }
      setStudentId(studentIdForBoot);
      studentIdRef.current = studentIdForBoot;

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
      let resumeBatch = null as ReturnType<typeof loadChapterBatch>;
      let resumeAt = 0;
      fillCancelRef.current = false;
      if (mode === "diagnostic") {
        questionsP = api.getDiagnostic(studentIdForBoot);
        sessionMode = "diagnostic";
      } else if (mode === "chapter" && chapter) {
        resumeBatch = loadChapterBatch(studentIdForBoot, chapter);
        const incomplete =
          resumeBatch &&
          !isBatchComplete(resumeBatch.qStates, resumeBatch.questionIds.length);
        if (incomplete && resumeBatch) {
          resumeAt = firstUnansweredIndex(
            resumeBatch.qStates,
            resumeBatch.questionIds.length
          );
          const initialIds = resumeBatch.questionIds.slice(
            resumeAt,
            resumeAt + 5
          );
          questionsP = api.getQuestionsByIds(
            initialIds.length ? initialIds : resumeBatch.questionIds.slice(0, 5),
            chapter,
            studentIdForBoot
          );
        } else {
          if (resumeBatch) {
            clearChapterBatch(studentIdForBoot, chapter);
          }
          questionsP = api.getChapterPractice(chapter, 100, studentIdForBoot, 5);
          resumeBatch = null;
        }
        sessionMode = "chapter_practice";
      } else if (mode === "full_length") {
        questionsP = api.getFullLength(flpMode, studentIdForBoot, 5);
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
      sessionP = sessionMode
        ? api.startSession({
            student_id: studentIdForBoot,
            mode: sessionMode,
            concept_id: conceptId,
            chapter,
          })
        : null;

      let qs = await questionsP;
      if (!qs.questions.length) {
        setError(
          mode === "chapter"
            ? "No more unseen MCQs in this chapter. Try Practice again, or pick another chapter."
            : "No questions available for this chapter yet. Try another chapter."
        );
        return;
      }

      // FLP preview: backend returned a handful of questions without
      // question_ids. Remember this before allIds fills it in below.
      const isFlp = qs.mode === "full_length_practice" || qs.mode === "full_length_timed";
      const isFlpPreview = isFlp && !qs.question_ids;

      const allIds = isFlpPreview
        ? padQuestionIds(qs.questions.map((q) => q.id), FLP_TOTAL)
        : resumeBatch?.questionIds ||
          qs.question_ids ||
          qs.questions.map((q) => q.id);
      qs = { ...qs, question_ids: allIds };
      setSet(qs);
      setRef.current = qs;
      if (qs.timed_seconds) setSecondsLeft(qs.timed_seconds);

      if (resumeBatch && qs.mode === "chapter_practice") {
        const restored: Record<number, QState> = {};
        for (const [k, saved] of Object.entries(resumeBatch.qStates)) {
          restored[Number(k)] = { ...EMPTY_Q, ...saved, explanation: null };
        }
        qStatesRef.current = restored;
        setQStates(restored);
        syncScoreFromStates(restored);
        restoreReview(qs, restored);
        indexRef.current = resumeAt;
        setIndex(resumeAt);
      } else if (qs.mode === "chapter_practice" && chapter) {
        saveChapterBatch({
          studentId: studentIdForBoot,
          chapter,
          questionIds: allIds,
          qStates: {},
          index: 0,
        });
      }

      if (!isFlpPreview && allIds.length > qs.questions.length) {
        void fillRemaining(allIds, qs.questions, chapter, studentIdForBoot, resumeAt);
      }

      if (isFlpPreview) {
        void loadFullFlp(flpMode, studentIdForBoot, qs);
      }

      const session = await (sessionP ??
        api.startSession({
          student_id: studentIdForBoot,
          mode: qs.mode,
          concept_id: conceptId || qs.concept_id,
          chapter: chapter || qs.chapter,
        }));
      setSessionId(session.id);
      sessionIdRef.current = session.id;
      sessionP = null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start session";
      setError(
        msg === "Failed to fetch"
          ? "Could not reach the server. Tap Try again in a few seconds."
          : msg
      );
    } finally {
      setLoading(false);
      // Opening the session in parallel means a failed boot can leave one
      // hanging — close it rather than leaving an empty session on the record.
      if (sessionP) {
        void sessionP
          .then((s) => api.endSessionDetached(s.id, { score: 0, total: 0 }))
          .catch(() => {});
      }
    }
  }

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void bootSession();
    return () => {
      fillCancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, router, flpMode]);

  const [showTimesUp, setShowTimesUp] = useState(false);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      if (!timedOutRef.current) {
        timedOutRef.current = true;
        setShowTimesUp(true);
        setTimeout(() => finish(), 2500);
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

  const question: Question | undefined = set ? questionAt(set, index) : undefined;
  const totalQ = set ? batchTotal(set) : 0;
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
        qStatesRef.current = next;
        syncScoreFromStates(next);
        persistChapterProgress(next, index);
        if (
          setRef.current &&
          isBatchComplete(next, batchTotal(setRef.current)) &&
          studentIdRef.current &&
          chapterRef.current
        ) {
          skipBatchPersistRef.current = true;
          clearChapterBatch(studentIdRef.current, chapterRef.current);
        }
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
        setAskOpen(false);
        setInsightOpen(true);
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
    if (!set || i < 0 || i >= batchTotal(set)) return;
    setNavOpen(false);
    if (i === index) return;
    if (explainAudioRef.current) {
      explainAudioRef.current.pause();
      explainAudioRef.current = null;
    }
    setSpeakingExplain(false);
    setExplaining(false);
    setConfirmEnd(false);
    setAskOpen(false);
    setInsightOpen(true);
    indexRef.current = i;
    setIndex(i);
    persistChapterProgress(qStatesRef.current, i);
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
      const pool = Array.from({ length: batchTotal(set) }, (_, i) => i).filter(
        (i) =>
          navFilter === "flagged"
            ? (qStates[i] ?? EMPTY_Q).flagged
            : (qStates[i] ?? EMPTY_Q).isCorrect === false
      );
      const next = pool.find((i) => i > index) ?? pool.find((i) => i < index);
      if (next !== undefined) {
        goToQuestion(next);
        return;
      }
    }
    if (index >= batchTotal(set) - 1) {
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
    const wrongN = Array.from({ length: batchTotal(set) }, (_, i) => i).filter(
      (i) => (qStates[i] ?? EMPTY_Q).isCorrect === false
    ).length;
    const flagN = Array.from({ length: batchTotal(set) }, (_, i) => i).filter(
      (i) => (qStates[i] ?? EMPTY_Q).flagged
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
    setConfirmExit(false);
    setConfirmEnd(false);
    persistChapterProgress();
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

  /** Score card built from what the client already knows — no server needed. */
  function localSummary(sessionIdValue: string): SessionSummary {
    const total = answeredRef.current;
    const score = scoreRef.current;
    const byChapter = new Map<string, { attempted: number; correct: number }>();
    for (const item of reviewRef.current) {
      const row = byChapter.get(item.chapter) || { attempted: 0, correct: 0 };
      row.attempted += 1;
      if (item.is_correct) row.correct += 1;
      byChapter.set(item.chapter, row);
    }
    return {
      session_id: sessionIdValue,
      score,
      total,
      accuracy_pct: total ? Math.round((score / total) * 100) : 0,
      concepts: [],
      chapters: Array.from(byChapter, ([chapter, row]) => ({
        chapter,
        attempted: row.attempted,
        correct: row.correct,
        accuracy_pct: row.attempted
          ? Math.round((row.correct / row.attempted) * 100)
          : 0,
      })),
      next_recommendation: null,
    };
  }

  function finish() {
    if (exiting) return;
    setExiting(true);
    setConfirmEnd(false);
    const chapter = chapterRef.current;
    if (
      set?.mode === "chapter_practice" &&
      chapter &&
      studentId &&
      isBatchComplete(qStatesRef.current, batchTotal(set))
    ) {
      skipBatchPersistRef.current = true;
      clearChapterBatch(studentId, chapter);
    } else {
      persistChapterProgress();
    }
    const sid = sessionIdRef.current;
    window.sessionStorage.setItem(
      "mdcat_review",
      JSON.stringify(reviewRef.current)
    );
    if (!sid) {
      router.replace("/dashboard");
      return;
    }
    // Show the summary straight away off local numbers; the server's version
    // catches up on /summary via the handoff.
    window.sessionStorage.setItem(
      "mdcat_summary",
      JSON.stringify(localSummary(sid))
    );
    setPendingSummary(
      api.endSession(sid, {
        score: scoreRef.current,
        total: answeredRef.current,
      })
    );
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
  if (!set)
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
  const flaggedCount = Array.from({ length: totalQ }, (_, i) => i).filter(
    (i) => (qStates[i] ?? EMPTY_Q).flagged
  ).length;
  const wrongCount = Array.from({ length: totalQ }, (_, i) => i).filter(
    (i) => (qStates[i] ?? EMPTY_Q).isCorrect === false
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
    <div className="min-h-dvh overflow-x-hidden bg-[#F4F7FB]">
      {showTimesUp && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <Clock className="h-14 w-14 text-red-400" />
          <p className="mt-4 font-display text-4xl font-bold text-white sm:text-5xl">
            Time&apos;s Up!
          </p>
          <p className="mt-3 text-sm text-slate-300">
            Your answers have been saved. Viewing results…
          </p>
        </div>
      )}
      {exiting && !showTimesUp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-[1px]">
          <div className="inline-flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-slate-700 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
            Ending session…
          </div>
        </div>
      )}
      {confirmExit && !exiting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Cancel exit"
            onClick={() => setConfirmExit(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <p className="text-base font-semibold text-slate-800">
              Are you sure you want to exit?
            </p>
            <p className="mt-1 text-sm text-slate-500">
              You can come back and pick up where you left off.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmExit(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={exitSession}
                className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
              >
                Yes, exit
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-2 sm:px-6 sm:py-3">
          <button
            type="button"
            onClick={() => {
              if (exiting) return;
              setConfirmExit(true);
            }}
            disabled={exiting}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-60 sm:justify-self-start sm:px-2"
          >
            {exiting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {exiting ? "Ending…" : "Exit Session"}
            </span>
          </button>

          <p className="min-w-0 flex-1 truncate text-center text-xs font-semibold sm:max-w-[min(100%,28rem)] sm:text-sm">
            <span className="tracking-wider text-slate-700">BIOLOGY</span>
            {question?.chapter ? (
              <>
                <span className="mx-1.5 font-normal text-slate-300 sm:mx-2">
                  ·
                </span>
                <span className="font-medium text-slate-600">
                  {question.chapter}
                </span>
              </>
            ) : null}
          </p>

          <div className="hidden items-center justify-end justify-self-end gap-3 sm:flex">
            <span className="truncate text-right text-xs font-semibold text-brand-700 sm:text-sm">
              {modeLabel(set.mode)}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6 lg:flex-row lg:gap-10">
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-2 lg:hidden">
            {timerLabel && (
              <div
                className={`flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 text-sm font-bold tabular-nums ${
                  secondsLeft !== null && secondsLeft < 300
                    ? "bg-red-50 text-red-600 ring-1 ring-red-200"
                    : "bg-brand-700 text-white"
                }`}
              >
                <Clock className="mr-2 h-4 w-4 shrink-0" />
                {timerLabel}
              </div>
            )}
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200"
            >
              <Menu className="h-4 w-4" />
              Questions
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-500">
              Q {index + 1} / {totalQ}
              {!reviewAtEnd && (
                <span className="ml-3 font-medium text-brand">
                  Score {score}/{answered || 0}
                  {answered > 0 ? ` (${scorePct}%)` : ""}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={toggleFlag}
              className={`ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
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

          {question ? (
            <p className="mt-5 text-base font-medium leading-relaxed text-slate-800 sm:text-lg">
              {question.question_text}
            </p>
          ) : (
            <div className="mt-8 flex min-h-[120px] flex-col items-center justify-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <p className="text-sm font-medium text-slate-500">
                Loading question...
              </p>
            </div>
          )}

          <div className="mt-5 space-y-3">
            {(question?.options ?? []).map((opt) => {
              const isSel = selected === opt.key;
              const shouldHighlight = showSidebar && graded;
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
                  className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3.5 text-left shadow-sm transition-all sm:items-center sm:gap-4 sm:px-5 sm:py-4 ${cls}`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold">
                    {opt.key}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-sm sm:text-[15px]">
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

          {isTimedExam && (
            <p className="mt-3 text-xs text-slate-400">
              Once you select an option, you will be taken to the next MCQ automatically.
            </p>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
            <button
              type="button"
              onClick={() => goToQuestion(index - 1)}
              disabled={exiting || index <= 0}
              className="min-h-11 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            >
              ← Previous Question
            </button>
            {selected || flagged ? (
              <button
                type="button"
                onClick={nextAfterAnswer}
                disabled={exiting}
                className="min-h-11 w-full rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60 sm:w-auto"
              >
                Next Question →
              </button>
            ) : null}
          </div>

          {showSidebar && question && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div
                className={`rounded-t-2xl px-4 py-3 ${
                  !graded
                    ? "bg-slate-50"
                    : isCorrect
                      ? "bg-emerald-50"
                      : "bg-red-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
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
                    className={`min-w-0 flex-1 text-sm leading-relaxed ${
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
                        : "Not quite. Let's understand why."}
                  </p>
                </div>
              </div>

              {insightOpen && (
                <>
                  <div className="flex items-center justify-between bg-brand-700 px-4 py-2.5 text-white">
                    <div className="inline-flex items-center gap-2 text-xs font-bold tracking-wider">
                      <Sparkles className="h-3.5 w-3.5" />
                      AI INSIGHT
                    </div>
                    <button
                      type="button"
                      onClick={() => setAskOpen((v) => !v)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      {askOpen ? "Hide chat" : `Ask ${doctor.displayName}`}
                    </button>
                  </div>

                  <div className="p-4">
                    {explaining ? (
                      <p className="text-sm text-slate-400">
                        Generating explanation...
                      </p>
                    ) : explanation ? (
                      <div>
                        <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                          {explanation.explanation}
                        </p>
                        <SpeechControls speechId={explanation.speech_id} />
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        {question.explanation ||
                          "Review this concept in your textbook."}
                      </p>
                    )}
                  </div>

                  {askOpen && (
                    <AskAI
                      embedded
                      doctor={doctor}
                      concept={conceptName}
                      onClose={() => setAskOpen(false)}
                      mcq={{
                        question_text: question.question_text,
                        options: question.options,
                        selected_option: selected || "",
                        correct_option: revealedCorrect || "",
                        explanation:
                          explanation?.explanation ||
                          question.explanation ||
                          "",
                      }}
                    />
                  )}
                </>
              )}

              {!insightOpen && (
                <div className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setInsightOpen(true)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-dark"
                  >
                    <Sparkles className="h-4 w-4" />
                    View explanation
                  </button>
                </div>
              )}
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
                      const first = Array.from(
                        { length: totalQ },
                        (_, i) => i
                      ).find((i) => (qStates[i] ?? EMPTY_Q).flagged);
                      if (first !== undefined) goToQuestion(first);
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
                      const first = Array.from(
                        { length: totalQ },
                        (_, i) => i
                      ).find(
                        (i) => (qStates[i] ?? EMPTY_Q).isCorrect === false
                      );
                      if (first !== undefined) goToQuestion(first);
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

        <aside className="hidden w-[22rem] shrink-0 sticky top-16 self-start lg:block xl:w-[26rem]">
          <QuestionNav
            totalQ={totalQ}
            flaggedCount={flaggedCount}
            wrongCount={wrongCount}
            navFilter={navFilter}
            setNavFilter={setNavFilter}
            qStates={qStates}
            goToQuestion={goToQuestion}
            boxClass={boxClass}
            index={index}
            timerLabel={timerLabel}
            secondsLeft={secondsLeft}
            answered={answered}
            score={score}
            scorePct={scorePct}
          />
        </aside>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Close questions"
            onClick={() => setNavOpen(false)}
          />
          <aside className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-[#F4F7FB] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300" />
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Questions</p>
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <QuestionNav
              totalQ={totalQ}
              flaggedCount={flaggedCount}
              wrongCount={wrongCount}
              navFilter={navFilter}
              setNavFilter={setNavFilter}
              qStates={qStates}
              goToQuestion={goToQuestion}
              boxClass={boxClass}
              index={index}
              timerLabel={timerLabel}
              secondsLeft={secondsLeft}
              answered={answered}
              score={score}
              scorePct={scorePct}
            />
          </aside>
        </div>
      )}

      
    </div>
  );
}

function QuestionNav({
  totalQ,
  flaggedCount,
  wrongCount,
  navFilter,
  setNavFilter,
  qStates,
  goToQuestion,
  boxClass,
  index,
  timerLabel,
  secondsLeft,
  answered,
  score,
  scorePct,
}: {
  totalQ: number;
  flaggedCount: number;
  wrongCount: number;
  navFilter: "all" | "flagged" | "wrong";
  setNavFilter: (id: "all" | "flagged" | "wrong") => void;
  qStates: Record<number, QState>;
  goToQuestion: (i: number) => void;
  boxClass: (i: number) => string;
  index: number;
  timerLabel: string | null;
  secondsLeft: number | null;
  answered: number;
  score: number;
  scorePct: number;
}) {
  return (
    <>
      <p className="text-[10px] font-bold tracking-wider text-slate-400">
        QUESTIONS
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
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
                const first = Array.from({ length: totalQ }, (_, i) => i).find(
                  (i) => (qStates[i] ?? EMPTY_Q).flagged
                );
                if (first !== undefined) goToQuestion(first);
              }
              if (id === "wrong" && wrongCount > 0) {
                const first = Array.from({ length: totalQ }, (_, i) => i).find(
                  (i) => (qStates[i] ?? EMPTY_Q).isCorrect === false
                );
                if (first !== undefined) goToQuestion(first);
              }
            }}
            className={`min-h-9 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              navFilter === id
                ? "bg-brand text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-slate-100 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 lg:grid-cols-10">
          {Array.from({ length: totalQ }, (_, i) => {
            const st = qStates[i] ?? EMPTY_Q;
            if (navFilter === "flagged" && !st.flagged) return null;
            if (navFilter === "wrong" && st.isCorrect !== false) return null;
            return (
              <button
                key={i}
                type="button"
                title={`Question ${i + 1}`}
                onClick={() => goToQuestion(i)}
                className={`relative flex min-h-11 w-full items-center justify-center rounded-md border text-xs font-bold tabular-nums transition lg:min-h-8 ${boxClass(i)}`}
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
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Correct
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Wrong
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-brand" /> Current
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Review
        </span>
      </div>
      {timerLabel && (
        <div
          className={`mt-5 hidden flex-col items-center justify-center rounded-2xl p-5 shadow-sm lg:flex ${
            secondsLeft !== null && secondsLeft < 300
              ? "bg-red-50 text-red-600 ring-1 ring-red-200"
              : "bg-brand-700 text-white"
          }`}
        >
          <Clock
            className={`h-6 w-6 ${
              secondsLeft !== null && secondsLeft < 300
                ? "text-red-400"
                : "text-sky-200"
            }`}
          />
          <p className="mt-2 text-3xl font-bold tabular-nums">{timerLabel}</p>
          <p
            className={`mt-1 text-[11px] font-semibold tracking-wider ${
              secondsLeft !== null && secondsLeft < 300
                ? "text-red-400"
                : "text-sky-200/80"
            }`}
          >
            TIME REMAINING
          </p>
        </div>
      )}
      {answered > 0 && (
        <div className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold tracking-wider text-slate-400">
            SCORE
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-800">
            {score}
            <span className="text-base font-semibold text-slate-400">
              /{answered}
            </span>
            <span className="ml-2 text-sm font-semibold text-brand">
              {scorePct}%
            </span>
          </p>
        </div>
      )}
    </>
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#F4F7FB] px-4">
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
