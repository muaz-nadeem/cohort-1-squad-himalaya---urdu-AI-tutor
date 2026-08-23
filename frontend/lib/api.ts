"use client";

import { getAccessToken, invalidateSessionCache } from "./auth";

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

/**
 * Any successful call proves the instance is up, so the session page can skip
 * its /health poll instead of paying an extra round-trip before every session.
 */
let lastAwakeAt = 0;
const AWAKE_TTL_MS = 120_000;

export function markBackendAwake() {
  lastAwakeAt = Date.now();
}

export function isBackendLikelyAwake(): boolean {
  return Date.now() - lastAwakeAt < AWAKE_TTL_MS;
}

function mergeAbortSignals(
  signals: (AbortSignal | undefined | null)[]
): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => !!s);
  if (live.length === 1) return live[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(live);
  const merged = new AbortController();
  for (const s of live) {
    if (s.aborted) {
      merged.abort();
      return merged.signal;
    }
    s.addEventListener("abort", () => merged.abort(), { once: true });
  }
  return merged.signal;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;
  const method = (options?.method || "GET").toUpperCase();
  let retriedAuth = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    // Free Render cold starts can take 50s+; give the wake-up room.
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const baseHeaders = await authHeaders(
        options?.headers as Record<string, string> | undefined,
        !(options?.body instanceof FormData)
      );
      const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: baseHeaders,
        signal: mergeAbortSignals([options?.signal, controller.signal]),
      });
      if (!res.ok) {
        // The memoised token can go stale ahead of schedule (password change,
        // revoked session). Drop it and take one clean retry.
        if (res.status === 401 && !retriedAuth) {
          retriedAuth = true;
          invalidateSessionCache();
          continue;
        }
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
      }
      markBackendAwake();
      return res.json() as Promise<T>;
    } catch (e) {
      lastError = e;
      const isAbort = (e as Error)?.name === "AbortError";
      const isNetwork =
        e instanceof TypeError &&
        /failed to fetch|networkerror|load failed/i.test(e.message);

      if (isAbort) {
        if (options?.signal?.aborted) throw e;
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
  // Already talked to the backend a moment ago — don't pay for another probe.
  if (isBackendLikelyAwake()) return true;
  const started = Date.now();
  let delay = 1500;
  while (Date.now() - started < maxWaitMs) {
    try {
      const res = await fetch(`${API_URL}/health`, {
        method: "GET",
        cache: "no-store",
      });
      if (res.ok) {
        markBackendAwake();
        return true;
      }
    } catch {
      // still waking / restarting
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
  /** Full batch order. Present for chapter practice so the UI can open
   *  after a short preview while the rest hydrate in the background. */
  question_ids?: string[];
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
  urdu_text?: string;
  concept: string;
  citation: string | null;
  sources: { concept: string; chapter: string; similarity: number }[];
  mnemonics?: { topic?: string; page_number?: number; snippet?: string }[];
  verified_correct_option?: string;
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
  concept_id?: string;
  concept?: string;
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
    trend?: "improving" | "stuck" | "getting_worse";
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
  weak_chapters?: {
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
  unit?: string;
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

export interface TextbookChatSummary {
  id: string;
  title: string;
  book_filter?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TextbookChatMessage {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
  sources?: RagSource[] | null;
  citation?: string | null;
  created_at?: string;
}

export interface TextbookChatDetail extends TextbookChatSummary {
  messages: TextbookChatMessage[];
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

  getChapterPractice: (
    chapter: string,
    count = 100,
    studentId?: string,
    preview = 5
  ) => {
    const q = new URLSearchParams({
      chapter,
      count: String(count),
      preview: String(preview),
    });
    if (studentId) q.set("student_id", studentId);
    return request<QuestionSet>(`/api/questions/chapter?${q.toString()}`);
  },

  getQuestionsByIds: (ids: string[], chapter?: string, studentId?: string) =>
    request<QuestionSet>("/api/questions/by-ids", {
      method: "POST",
      body: JSON.stringify({ ids, chapter, student_id: studentId }),
    }),

  getCustomQuiz: (
    selections: { chapter: string; book?: string; count: number }[],
    studentId?: string
  ) =>
    request<QuestionSet>("/api/questions/custom", {
      method: "POST",
      body: JSON.stringify({ selections, student_id: studentId }),
    }),

  getFullLength: (mode: "practice" | "timed" = "practice", studentId?: string, preview = 0) => {
    const q = new URLSearchParams({ mode });
    if (studentId) q.set("student_id", studentId);
    if (preview > 0) q.set("preview", String(preview));
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

  /**
   * Close the session without making the student wait for it. `keepalive` lets
   * the request outlive the page transition (and even a tab close).
   */
  endSessionDetached: async (
    sessionId: string,
    body: { score?: number; total?: number } = {}
  ): Promise<void> => {
    try {
      const headers = await authHeaders();
      await fetch(`${API_URL}/api/sessions/${sessionId}/end`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch {
      /* the student has already left — nothing useful to surface */
    }
  },

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

  ask: (
    body: {
      concept: string;
      student_question: string;
      history?: { role: string; content: string }[];
      mcq?: McqContext;
    },
    signal?: AbortSignal
  ) =>
    request<AskResult>("/api/ask", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),

  askVoice: async (
    audio: Blob,
    concept: string,
    mcq?: McqContext,
    signal?: AbortSignal
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
        signal: mergeAbortSignals([signal, controller.signal]),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        if (signal?.aborted) throw e;
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

  ragAsk: (body: {
    question: string;
    book?: string;
    top_k?: number;
    history?: { role: string; content: string }[];
  }) =>
    request<RagAnswer>("/api/rag/ask", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  ragAskStream: async (
    body: {
      question: string;
      book?: string;
      top_k?: number;
      history?: { role: string; content: string }[];
    },
    signal?: AbortSignal
  ) => {
    const headers = await authHeaders();
    return fetch(`${API_URL}/api/rag/ask-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  },

  listTextbookChats: () =>
    request<{ chats: TextbookChatSummary[] }>("/api/textbook-chats"),

  createTextbookChat: (body?: { title?: string; book_filter?: string }) =>
    request<TextbookChatSummary>("/api/textbook-chats", {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),

  getTextbookChat: (chatId: string) =>
    request<TextbookChatDetail>(`/api/textbook-chats/${chatId}`),

  deleteTextbookChat: (chatId: string) =>
    request<{ ok: boolean }>(`/api/textbook-chats/${chatId}`, {
      method: "DELETE",
    }),

  renameTextbookChat: (chatId: string, title: string) =>
    request<TextbookChatSummary>(`/api/textbook-chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  appendTextbookChatMessages: (
    chatId: string,
    body: {
      messages: {
        role: string;
        content: string;
        sources?: RagSource[];
        citation?: string | null;
      }[];
      title?: string;
    }
  ) =>
    request<{
      messages: TextbookChatMessage[];
      chat: TextbookChatSummary;
    }>(`/api/textbook-chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  ragAskVoice: async (
    audio: Blob,
    book?: string,
    top_k = 3,
    signal?: AbortSignal
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
        signal: mergeAbortSignals([signal, controller.signal]),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Voice request failed (${res.status})`);
      }
      return res.json();
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        if (signal?.aborted) throw e;
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
