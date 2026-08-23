"use client";

const PREFIX = "uraan_chapter_batch_v1:";
const ROUND_DONE_PREFIX = "uraan_chapter_round_done_v1:";

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
  updatedAt?: number;
};

function roundDoneKey(studentId: string) {
  return `${ROUND_DONE_PREFIX}${studentId}`;
}

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
    const payload: ChapterBatch = { ...batch, updatedAt: Date.now() };
    window.localStorage.setItem(
      key(batch.studentId, batch.chapter),
      JSON.stringify(payload)
    );
  } catch {
    /* quota / private mode */
  }
}

export function markChapterRoundComplete(studentId: string, chapter: string): void {
  if (typeof window === "undefined" || !studentId || !chapter) return;
  try {
    const raw = window.localStorage.getItem(roundDoneKey(studentId));
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[chapter] = Date.now();
    window.localStorage.setItem(roundDoneKey(studentId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function clearChapterRoundComplete(
  studentId: string,
  chapter: string
): void {
  if (typeof window === "undefined" || !studentId || !chapter) return;
  try {
    const raw = window.localStorage.getItem(roundDoneKey(studentId));
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, number>;
    delete map[chapter];
    window.localStorage.setItem(roundDoneKey(studentId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function isChapterRoundComplete(studentId: string, chapter: string): boolean {
  if (typeof window === "undefined" || !studentId || !chapter) return false;
  try {
    const raw = window.localStorage.getItem(roundDoneKey(studentId));
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, number>;
    return Boolean(map[chapter]);
  } catch {
    return false;
  }
}

export function listIncompleteBatches(studentId: string): ChapterBatch[] {
  if (typeof window === "undefined" || !studentId) return [];
  const prefix = key(studentId, "");
  const out: ChapterBatch[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (!k?.startsWith(prefix)) continue;
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(k) || ""
      ) as ChapterBatch;
      if (
        !Array.isArray(parsed.questionIds) ||
        parsed.questionIds.length === 0
      ) {
        continue;
      }
      if (!isBatchComplete(parsed.qStates, parsed.questionIds.length)) {
        out.push(parsed);
      }
    } catch {
      /* skip */
    }
  }
  return out.sort(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  );
}

export function countAnsweredInBatch(batch: ChapterBatch): number {
  return Object.values(batch.qStates).filter(
    (s) => s.isCorrect !== null && s.isCorrect !== undefined
  ).length;
}

export type DashboardResume = {
  chapter: string;
  href: string;
  reason: string;
  resumeAt: number;
  totalInBatch: number;
};

export function pickDashboardResumeChapter(
  studentId: string,
  chapters: { name: string; book: string; unit?: string; question_count?: number }[],
  statsByChapter: Map<string, { attempted: number; accuracy_pct?: number }>
): DashboardResume | null {
  if (!studentId || !chapters.length) return null;

  const incomplete = listIncompleteBatches(studentId);
  if (incomplete.length > 0) {
    const batch = incomplete[0];
    const total = batch.questionIds.length;
    const resumeAt = nextResumeIndex(batch.qStates, total) + 1;
    const answered = countAnsweredInBatch(batch);
    return {
      chapter: batch.chapter,
      href: `/session?mode=chapter&chapter=${encodeURIComponent(batch.chapter)}`,
      reason:
        answered > 0
          ? `You left off at MCQ ${resumeAt} of ${total} — pick up where you stopped.`
          : `Continue ${batch.chapter} from the beginning.`,
      resumeAt,
      totalInBatch: total,
    };
  }

  const ordered = [...chapters].sort((a, b) => {
    const bookA = a.book === "fsc_part2" ? 1 : 0;
    const bookB = b.book === "fsc_part2" ? 1 : 0;
    if (bookA !== bookB) return bookA - bookB;
    const unitA = parseInt(a.unit || "0", 10) || 0;
    const unitB = parseInt(b.unit || "0", 10) || 0;
    return unitA - unitB;
  });

  for (const ch of ordered) {
    const count = ch.question_count ?? 0;
    const attempted = statsByChapter.get(ch.name)?.attempted ?? 0;
    const remaining = Math.max(0, count - attempted);
    const done = remaining === 0 && attempted > 0;
    if (done) continue;
    if (isChapterRoundComplete(studentId, ch.name)) continue;

    const accuracy = statsByChapter.get(ch.name)?.accuracy_pct;
    let reason = "Start this chapter and build your streak.";
    if (attempted > 0 && accuracy != null) {
      reason = `${attempted} MCQs done · ${accuracy}% accuracy — keep going.`;
    } else if (attempted > 0) {
      reason = `${attempted} MCQs done — continue this chapter.`;
    }

    return {
      chapter: ch.name,
      href: `/session?mode=chapter&chapter=${encodeURIComponent(ch.name)}`,
      reason,
      resumeAt: 1,
      totalInBatch: Math.min(100, count || 100),
    };
  }

  return null;
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
