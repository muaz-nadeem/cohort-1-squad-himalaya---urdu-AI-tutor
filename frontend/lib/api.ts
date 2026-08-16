"use client";

import { getAccessToken } from "./auth";

const API_URL = resolveApiUrl();

function resolveApiUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(
    /\/$/,
    ""
  );
  if (
    process.env.NODE_ENV === "production" &&
    /(localhost|127\.0\.0\.1)/i.test(raw)
  ) {
    console.error(
      "[api] NEXT_PUBLIC_API_URL still points at localhost in a production build. " +
        "Set it to your AWS backend URL in the Vercel project settings."
    );
  }
  return raw;
}

async function authHeaders(
  extra?: Record<string, string>,
  json = true
): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { ...(extra || {}) };
  if (json) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// #region agent log
function dbgLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {}
) {
  const payload = {
    sessionId: "079fbf",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
    runId: "pre-fix",
  };
  try {
    if (typeof window !== "undefined") {
      const prev = window.sessionStorage.getItem("dbg_079fbf") || "[]";
      const arr = JSON.parse(prev) as unknown[];
      arr.push(payload);
      window.sessionStorage.setItem(
        "dbg_079fbf",
        JSON.stringify(arr.slice(-40))
      );
      window.sessionStorage.setItem(
        "dbg_079fbf_last",
        JSON.stringify(payload)
      );
    }
  } catch {
    /* ignore */
  }
  fetch("http://127.0.0.1:7731/ingest/7d9b9d07-93bb-4158-bd2a-ba90f9b04dfc", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "079fbf",
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
  // Also ship to Render so we can poll logs from production (HTTPS-safe).
  try {
    fetch(`${API_URL}/api/client-debug`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
// #endregion

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;
  const method = (options?.method || "GET").toUpperCase();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    // Free Render cold starts can take 50s+; give the wake-up room.
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const baseHeaders = await authHeaders(
        options?.headers as Record<string, string> | undefined,
        !(options?.body instanceof FormData)
      );
      const hasToken = Boolean(baseHeaders.Authorization);
      // #region agent log
      dbgLog("H2", "api.ts:request:start", "request start", {
        path,
        method,
        attempt,
        hasToken,
        apiUrl: API_URL,
      });
      // #endregion
      const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: baseHeaders,
        signal: options?.signal || controller.signal,
      });
      // #region agent log
      dbgLog("H1", "api.ts:request:response", "got response", {
        path,
        method,
        attempt,
        status: res.status,
        ok: res.ok,
      });
      // #endregion
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      return res.json() as Promise<T>;
    } catch (e) {
      lastError = e;
      const isAbort = (e as Error)?.name === "AbortError";
      const isNetwork =
        e instanceof TypeError &&
        /failed to fetch|networkerror|load failed/i.test(e.message);

      // #region agent log
      dbgLog("H4", "api.ts:request:catch", "request catch", {
        path,
        method,
        attempt,
        errName: (e as Error)?.name,
        errMsg: (e as Error)?.message?.slice(0, 200),
        isAbort,
        isNetwork,
      });
      // #endregion

      if (isAbort) {
        throw new Error(
          "Request timed out. On the free Render plan the backend may be waking from sleep — wait a few seconds and try again."
        );
      }

      // Retry only pure network failures (cold start / connection drop).
      if (isNetwork && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }

      if (isNetwork) {
        throw new Error(
          `Network error calling ${method} ${path} on ${API_URL}. ` +
            `If other pages load, this is not “Render asleep” — the specific request failed or the connection dropped.`
        );
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Request failed");
}

/** Poll /health until the free-tier instance is awake (or give up). */
export async function wakeBackend(maxWaitMs = 90_000): Promise<boolean> {
  const started = Date.now();
  let delay = 1500;
  let tries = 0;
  while (Date.now() - started < maxWaitMs) {
    tries += 1;
    try {
      const res = await fetch(`${API_URL}/health`, {
        method: "GET",
        cache: "no-store",
      });
      // #region agent log
      dbgLog("H1", "api.ts:wakeBackend", "health probe", {
        tries,
        status: res.status,
        ok: res.ok,
        elapsedMs: Date.now() - started,
      });
      // #endregion
      if (res.ok) return true;
    } catch (e) {
      // #region agent log
      dbgLog("H1", "api.ts:wakeBackend", "health probe failed", {
        tries,
        errName: (e as Error)?.name,
        errMsg: (e as Error)?.message?.slice(0, 120),
        elapsedMs: Date.now() - started,
      });
      // #endregion
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay + 500, 4000);
  }
  return false;
}


export interface Student {
  id: string;
  name?: string;
  email?: string;
  level: string;
  daily_time: string;
  exam: string;
  subject: string;
  diagnostic_done?: boolean;
}

export interface Option {
  key: string;
  text: string;
}

export interface Question {
  id: string;
  concept_id?: string;
  chapter: string;
  difficulty: number;
  question_text: string;
  options: Option[];
  /** Only present after an attempt is graded server-side. */
  correct_option?: string;
  explanation?: string;
  source?: string;
  source_type?: string;
}

export type SessionMode =
  | "diagnostic"
  | "drill"
  | "chapter_practice"
  | "full_length_practice"
  | "full_length_timed"
  | "custom";

export interface QuestionSet {
  mode: SessionMode;
  concept_id?: string;
  chapter?: string;
  recommended?: WeakSpot;
  questions: Question[];
  timed_seconds?: number | null;
  note?: string;
}

export interface AttemptResult {
  is_correct: boolean;
  correct_option: string;
  attempt: Record<string, unknown>;
}

export interface ExplainResult {
  explanation: string;
  answer: string;
  audio: string | null;
  speech_id?: string | null;
  concept: string;
  citation: string | null;
  sources: { concept: string; chapter: string; similarity: number }[];
  mnemonics?: { topic?: string; page_number?: number; snippet?: string }[];
}

export interface AskResult {
  answer: string;
  audio: string | null;
  speech_id?: string | null;
  urdu_text?: string;
  transcript: string;
  concept: string;
  sources: { concept: string; chapter: string; similarity: number }[];
  no_speech?: boolean;
  error?: string;
}

/** URL that streams cached Urdu narration (includes access_token for <audio>). */
export async function speechStreamUrl(
  speechId?: string | null
): Promise<string | null> {
  if (!speechId) return null;
  const token = await getAccessToken();
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return `${API_URL}/api/tts-stream/${speechId}${q}`;
}

export interface McqContext {
  question_text?: string;
  options?: Option[];
  selected_option?: string;
  correct_option?: string;
  explanation?: string;
}

export interface WeakSpot {
  concept_id: string;
  concept: string;
  chapter?: string;
  accuracy_pct: number;
  attempts: number;
  priority_score: number;
  trend: "improving" | "stuck" | "getting_worse";
  color: "red" | "amber" | "green";
  needs_drill: boolean;
}

export interface DailyPlanItem {
  chapter?: string | null;
  concept?: string;
  concept_id?: string;
  minutes: number;
  question_count: number;
  reason: string;
  action?: string;
}

export interface DailyPlan {
  id?: string;
  plan_date: string;
  items: DailyPlanItem[];
}

export interface Dashboard {
  accuracy_pct: number;
  total_attempted: number;
  streak: number;
  chapters: {
    chapter: string;
    attempted: number;
    correct: number;
    accuracy_pct: number;
  }[];
  focus: WeakSpot | null;
  diagnostic_done?: boolean;
  daily_plan?: DailyPlan | null;
}

export interface SessionSummary {
  session_id: string;
  score: number;
  total: number;
  accuracy_pct: number;
  concepts: {
    concept_id: string;
    concept: string;
    attempted: number;
    correct: number;
    accuracy_pct: number;
  }[];
  chapters?: {
    chapter: string;
    attempted: number;
    correct: number;
    accuracy_pct: number;
  }[];
  next_recommendation: WeakSpot | null;
}

export interface ReviewItem {
  question_id: string;
  question_text: string;
  chapter: string;
  options: Option[];
  selected_option: string;
  correct_option: string;
  is_correct: boolean;
}

export interface WeeklyPlan {
  id: string;
  week_start: string;
  plan: {
    day: string;
    concept: string;
    chapter?: string;
    minutes: number;
    question_count: number;
    reason: string;
  }[];
}

export interface ChapterInfo {
  id: string;
  name: string;
  book: string;
  has_questions: boolean;
  question_count?: number;
}

export interface RagSource {
  book: string | null;
  book_label: string | null;
  chapter: string | null;
  page_number: number | null;
  content_type: string | null;
  concept: string | null;
  similarity: number;
  snippet: string;
}

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
  citation: string | null;
}

export interface RagVoiceResult {
  transcript: string;
  answer: string;
  audio: string | null;
  speech_id?: string | null;
  urdu_text?: string;
  sources: RagSource[];
  citation: string | null;
  no_speech?: boolean;
  error?: string;
}

export const api = {
  createStudent: (body: {
    name?: string;
    email?: string;
    level: string;
    daily_time: string;
  }) =>
    request<Student>("/api/students", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getStudent: (id?: string) =>
    id
      ? request<Student>(`/api/students/${id}`)
      : request<Student>("/api/students/me"),

  getDashboard: (studentId?: string) => {
    const q = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    return request<Dashboard>(`/api/dashboard${q}`);
  },

  getChapters: () => request<ChapterInfo[]>("/api/chapters"),

  getQuestions: (
    studentId: string,
    params: { chapter?: string; concept_id?: string } = {}
  ) => {
    const q = new URLSearchParams({ student_id: studentId });
    if (params.chapter) q.set("chapter", params.chapter);
    if (params.concept_id) q.set("concept_id", params.concept_id);
    return request<QuestionSet>(`/api/questions?${q.toString()}`);
  },

  getDiagnostic: (studentId: string, count = 25) =>
    request<QuestionSet>(
      `/api/questions/diagnostic?student_id=${studentId}&count=${count}`
    ),

  getChapterPractice: (chapter: string, count = 100, studentId?: string) => {
    const q = new URLSearchParams({ chapter, count: String(count) });
    if (studentId) q.set("student_id", studentId);
    return request<QuestionSet>(`/api/questions/chapter?${q.toString()}`);
  },

  getCustomQuiz: (
    selections: { chapter: string; book?: string; count: number }[],
    studentId?: string
  ) =>
    request<QuestionSet>("/api/questions/custom", {
      method: "POST",
      body: JSON.stringify({ selections, student_id: studentId }),
    }),

  getFullLength: (mode: "practice" | "timed" = "practice", studentId?: string) => {
    const q = new URLSearchParams({ mode });
    if (studentId) q.set("student_id", studentId);
    return request<QuestionSet>(`/api/questions/full-length?${q.toString()}`);
  },

  startSession: (body: {
    student_id?: string;
    mode: string;
    concept_id?: string;
    chapter?: string;
  }) =>
    request<{ id: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  endSession: (sessionId: string, body: { score?: number; total?: number } = {}) =>
    request<SessionSummary>(`/api/sessions/${sessionId}/end`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  logAttempt: (body: {
    student_id?: string;
    question_id: string;
    selected_option: string;
    session_id?: string;
  }) =>
    request<AttemptResult>("/api/attempt", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  explain: (body: {
    question_id: string;
    concept: string;
    selected_option: string;
    correct_option: string;
    speak?: boolean;
  }) =>
    request<ExplainResult>("/api/explain", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  ask: (body: {
    concept: string;
    student_question: string;
    history?: { role: string; content: string }[];
    mcq?: McqContext;
  }) =>
    request<AskResult>("/api/ask", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  askVoice: async (
    audio: Blob,
    concept: string,
    mcq?: McqContext
  ): Promise<AskResult> => {
    const form = new FormData();
    const mime = audio.type || "audio/webm";
    const ext =
      mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : mime.includes("ogg")
          ? "ogg"
          : mime.includes("wav")
            ? "wav"
            : "webm";
    form.append("audio", audio, `question.${ext}`);
    form.append("concept", concept);
    if (mcq?.question_text) form.append("mcq", JSON.stringify(mcq));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const headers = await authHeaders({}, false);
      const res = await fetch(`${API_URL}/api/ask-voice`, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        throw new Error("Voice request timed out. Try a shorter question.");
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  },

  getWeakSpots: (studentId?: string) => {
    const q = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    return request<WeakSpot[]>(`/api/weak-spots${q}`);
  },

  getWeeklyPlan: (studentId?: string) => {
    const q = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    return request<WeeklyPlan>(`/api/weekly-plan${q}`);
  },

  getDailyPlan: (studentId?: string) => {
    const q = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
    return request<DailyPlan>(`/api/daily-plan${q}`);
  },

  ragAsk: (body: { question: string; book?: string; top_k?: number }) =>
    request<RagAnswer>("/api/rag/ask", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  ragAskStream: async (body: {
    question: string;
    book?: string;
    top_k?: number;
  }) => {
    const headers = await authHeaders();
    return fetch(`${API_URL}/api/rag/ask-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  },

  ragAskVoice: async (
    audio: Blob,
    book?: string,
    top_k = 3
  ): Promise<RagVoiceResult> => {
    const form = new FormData();
    const mime = audio.type || "audio/webm";
    const ext =
      mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : mime.includes("ogg")
          ? "ogg"
          : mime.includes("wav")
            ? "wav"
            : "webm";
    form.append("audio", audio, `question.${ext}`);
    if (book) form.append("book", book);
    form.append("top_k", String(top_k));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const headers = await authHeaders({}, false);
      const res = await fetch(`${API_URL}/api/rag/ask-voice`, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Voice request failed (${res.status})`);
      }
      return res.json();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        throw new Error(
          "Voice request timed out. Try a shorter question or use text."
        );
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  },
};

export { API_URL };
