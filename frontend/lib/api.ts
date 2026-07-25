const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
      ...options,
      signal: options?.signal || controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") {
      throw new Error("Request timed out. The server may be loading models — try again in a moment.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
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
  correct_option: string;
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
  concept: string;
  citation: string | null;
  sources: { concept: string; chapter: string; similarity: number }[];
  mnemonics?: { topic?: string; page_number?: number; snippet?: string }[];
}

export interface AskResult {
  answer: string;
  audio: string | null;
  transcript: string;
  concept: string;
  sources: { concept: string; chapter: string; similarity: number }[];
  error?: string;
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
  chapters: { chapter: string; attempted: number; correct: number; accuracy_pct: number }[];
  focus: WeakSpot | null;
  diagnostic_done?: boolean;
  daily_plan?: DailyPlan | null;
}

export interface SessionSummary {
  session_id: string;
  score: number;
  total: number;
  accuracy_pct: number;
  concepts: { concept_id: string; concept: string; attempted: number; correct: number; accuracy_pct: number }[];
  chapters?: { chapter: string; attempted: number; correct: number; accuracy_pct: number }[];
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

export const api = {
  login: (email: string) =>
    request<Student>(`/api/login?email=${encodeURIComponent(email)}`),

  createStudent: (body: {
    name?: string;
    email?: string;
    level: string;
    daily_time: string;
  }) => request<Student>("/api/students", { method: "POST", body: JSON.stringify(body) }),

  getStudent: (id: string) => request<Student>(`/api/students/${id}`),

  getDashboard: (studentId: string) =>
    request<Dashboard>(`/api/dashboard?student_id=${studentId}`),

  getChapters: () => request<ChapterInfo[]>("/api/chapters"),

  getQuestions: (studentId: string, params: { chapter?: string; concept_id?: string } = {}) => {
    const q = new URLSearchParams({ student_id: studentId });
    if (params.chapter) q.set("chapter", params.chapter);
    if (params.concept_id) q.set("concept_id", params.concept_id);
    return request<QuestionSet>(`/api/questions?${q.toString()}`);
  },

  getDiagnostic: (studentId: string, count = 25) =>
    request<QuestionSet>(
      `/api/questions/diagnostic?student_id=${studentId}&count=${count}`
    ),

  getChapterPractice: (chapter: string, count = 100) =>
    request<QuestionSet>(
      `/api/questions/chapter?chapter=${encodeURIComponent(chapter)}&count=${count}`
    ),

  getCustomQuiz: (selections: { chapter: string; book?: string; count: number }[]) =>
    request<QuestionSet>("/api/questions/custom", {
      method: "POST",
      body: JSON.stringify({ selections }),
    }),

  getFullLength: (mode: "practice" | "timed" = "practice") =>
    request<QuestionSet>(`/api/questions/full-length?mode=${mode}`),

  startSession: (body: {
    student_id: string;
    mode: string;
    concept_id?: string;
    chapter?: string;
  }) => request<{ id: string }>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),

  endSession: (sessionId: string, body: { score: number; total: number }) =>
    request<SessionSummary>(`/api/sessions/${sessionId}/end`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  logAttempt: (body: {
    student_id: string;
    question_id: string;
    selected_option: string;
    session_id?: string;
  }) => request<AttemptResult>("/api/attempt", { method: "POST", body: JSON.stringify(body) }),

  explain: (body: {
    question_id: string;
    concept: string;
    selected_option: string;
    correct_option: string;
  }) => request<ExplainResult>("/api/explain", { method: "POST", body: JSON.stringify(body) }),

  ask: (body: {
    concept: string;
    student_question: string;
    history?: { role: string; content: string }[];
  }) => request<AskResult>("/api/ask", { method: "POST", body: JSON.stringify(body) }),

  askVoice: async (audio: Blob, concept: string): Promise<AskResult> => {
    const form = new FormData();
    form.append("audio", audio, "question.webm");
    form.append("concept", concept);
    const res = await fetch(`${API_URL}/api/ask-voice`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getWeakSpots: (studentId: string) =>
    request<WeakSpot[]>(`/api/weak-spots?student_id=${studentId}`),

  getWeeklyPlan: (studentId: string) =>
    request<WeeklyPlan>(`/api/weekly-plan?student_id=${studentId}`),

  getDailyPlan: (studentId: string) =>
    request<DailyPlan>(`/api/daily-plan?student_id=${studentId}`),

  ragAsk: (body: { question: string; book?: string; top_k?: number }) =>
    request<RagAnswer>("/api/rag/ask", { method: "POST", body: JSON.stringify(body) }),

  ragAskStream: (body: { question: string; book?: string; top_k?: number }) =>
    fetch(`${API_URL}/api/rag/ask-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};

export { API_URL };
