"use client";

const PREFIX = "uraan_chapter_batch_v1:";

export type SavedQState = {
  selected: string | null;
  isCorrect: boolean | null;
  revealedCorrect: string | null;
  flagged: boolean;
};

export type ChapterBatch = {
  chapter: string;
  studentId: string;
  questionIds: string[];
  qStates: Record<number, SavedQState>;
  index: number;
};

function key(studentId: string, chapter: string) {
  return `${PREFIX}${studentId}:${chapter}`;
}

export function loadChapterBatch(
  studentId: string,
  chapter: string
): ChapterBatch | null {
  if (typeof window === "undefined" || !studentId || !chapter) return null;
  try {
    const raw = window.localStorage.getItem(key(studentId, chapter));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChapterBatch;
    if (!Array.isArray(parsed.questionIds) || parsed.questionIds.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveChapterBatch(batch: ChapterBatch): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(batch.studentId, batch.chapter), JSON.stringify(batch));
  } catch {
    /* quota / private mode */
  }
}

export function clearChapterBatch(studentId: string, chapter: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(studentId, chapter));
}

export function isBatchComplete(
  qStates: Record<number, { isCorrect: boolean | null }>,
  total: number
): boolean {
  if (total <= 0) return false;
  for (let i = 0; i < total; i++) {
    if (qStates[i]?.isCorrect === null || qStates[i]?.isCorrect === undefined) {
      return false;
    }
  }
  return true;
}

function isAnswered(
  st: { isCorrect: boolean | null; selected?: string | null } | undefined
): boolean {
  if (!st) return false;
  if (st.isCorrect !== null && st.isCorrect !== undefined) return true;
  return Boolean(st.selected);
}

export function firstUnansweredIndex(
  qStates: Record<number, { isCorrect: boolean | null }>,
  total: number
): number {
  for (let i = 0; i < total; i++) {
    if (qStates[i]?.isCorrect === null || qStates[i]?.isCorrect === undefined) {
      return i;
    }
  }
  return Math.max(0, total - 1);
}

/** Continue after the furthest answered question, not the last one viewed. */
export function nextResumeIndex(
  qStates: Record<
    number,
    { isCorrect: boolean | null; selected?: string | null }
  >,
  total: number
): number {
  let lastAnswered = -1;
  for (let i = 0; i < total; i++) {
    if (isAnswered(qStates[i])) lastAnswered = i;
  }
  if (lastAnswered < 0) return 0;
  const next = lastAnswered + 1;
  return next >= total ? Math.max(0, total - 1) : next;
}

export function hasIncompleteChapterBatch(
  studentId: string,
  chapter: string
): boolean {
  const batch = loadChapterBatch(studentId, chapter);
  if (!batch) return false;
  return !isBatchComplete(batch.qStates, batch.questionIds.length);
}
