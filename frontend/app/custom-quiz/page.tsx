"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Lightbulb,
  Play,
  Plus,
  Settings2,
  Shuffle,
  Trash2,
} from "lucide-react";
import { api, type ChapterInfo } from "@/lib/api";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

type Row = { chapter: string; book: string; count: number };

export default function CustomQuizPage() {
  const router = useRouter();
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [rows, setRows] = useState<Row[]>([
    { chapter: "", book: "", count: 10 },
    { chapter: "", book: "", count: 15 },
  ]);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getStudentId()) {
      router.replace("/");
      return;
    }
    api
      .getChapters()
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [router]);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { chapter: "", book: "", count: 10 }]);
  }

  function removeRow(i: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function start() {
    setTouched(true);
    setError("");
    const selections = rows
      .filter((r) => r.book && r.chapter && r.count > 0)
      .map((r) => ({
        chapter: r.chapter,
        book: r.book,
        count: Math.min(100, Math.max(1, r.count)),
      }));
    if (!selections.length) {
      setError("Pick at least one year and chapter.");
      return;
    }
    const encoded = encodeURIComponent(JSON.stringify(selections));
    router.push(`/session?mode=custom&custom=${encoded}`);
  }

  const selectedChapters = rows.filter((r) => r.book && r.chapter).length;
  const total = rows.reduce(
    (s, r) => s + (r.book && r.chapter ? r.count : 0),
    0
  );
  const estimatedMins = Math.max(5, Math.round(total * 1));

  return (
    <Navbar>
      <main className="min-h-[calc(100vh-3.5rem)] bg-[#F4F7FB] lg:min-h-screen">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-start gap-3">
            <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
                Build Your Custom Quiz
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
                Tailor your practice session by combining specific years and
                chapters to target your weak areas.
              </p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-xl font-bold text-brand-700">
                  Curate Questions
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-semibold text-brand">
                  <Shuffle className="h-3.5 w-3.5" />
                  Mix and match topics
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {rows.map((row, i) => {
                  const yearError = touched && !row.book;
                  return (
                    <div
                      key={i}
                      className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 sm:grid-cols-[1fr_1.3fr_90px_auto] sm:items-end"
                    >
                      <label className="text-xs font-medium text-slate-500">
                        Academic Year
                        <select
                          className={`mt-1.5 w-full rounded-xl border bg-white px-3 py-2.5 text-sm outline-none focus:border-brand ${
                            yearError ? "border-red-400" : "border-slate-200"
                          }`}
                          value={row.book}
                          onChange={(e) =>
                            updateRow(i, {
                              book: e.target.value,
                              chapter: "",
                            })
                          }
                        >
                          <option value="">Select Year</option>
                          <option value="fsc_part1">1st Year</option>
                          <option value="fsc_part2">2nd Year</option>
                        </select>
                        {yearError && (
                          <span className="mt-1 block text-[11px] italic text-red-500">
                            Please select a year
                          </span>
                        )}
                      </label>

                      <label className="text-xs font-medium text-slate-500">
                        Target Chapter
                        <select
                          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
                          value={row.chapter}
                          onChange={(e) =>
                            updateRow(i, { chapter: e.target.value })
                          }
                          disabled={!row.book}
                        >
                          <option value="">Select Chapter</option>
                          {chapters
                            .filter((c) => c.book === row.book)
                            .map((c) => (
                              <option key={c.id} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                      </label>

                      <label className="text-xs font-medium text-slate-500">
                        MCQ Count
                        <input
                          type="number"
                          min={1}
                          max={100}
                          className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand"
                          value={row.count}
                          onChange={(e) =>
                            updateRow(i, {
                              count: Number(e.target.value) || 1,
                            })
                          }
                        />
                      </label>

                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        className="mb-0.5 rounded-xl p-2.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                        disabled={rows.length <= 1}
                        aria-label="Remove row"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={addRow}
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
              >
                <Plus className="h-4 w-4" />
                Add another chapter
              </button>

              {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl bg-brand-700 p-6 text-white shadow-sm">
                <h3 className="font-display text-xl font-bold">Quiz Overview</h3>

                <dl className="mt-6 space-y-3 text-sm">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <dt className="text-sky-200/90">Selected Chapters</dt>
                    <dd className="font-semibold tabular-nums">
                      {String(selectedChapters).padStart(2, "0")}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <dt className="text-sky-200/90">Estimated Time</dt>
                    <dd className="font-semibold">{estimatedMins} mins</dd>
                  </div>
                </dl>

                <div className="mt-6">
                  <p className="text-[10px] font-semibold tracking-wider text-sky-200/80">
                    TOTAL QUESTIONS
                  </p>
                  <p className="mt-1 font-display text-4xl font-bold tabular-nums">
                    {total}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={start}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent-blue px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-600"
                >
                  <Play className="h-4 w-4 fill-current" />
                  Start Quiz
                </button>

                <p className="mt-5 text-xs leading-relaxed text-sky-100/70">
                  Empowering you to ascend through focused practice. Your
                  journey to medical school starts here.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-amber-500" />
                  <h4 className="font-semibold text-slate-900">Pro Tip</h4>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  Mixing related chapters creates a high-yield practice set that
                  often appears together in MDCAT papers.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </Navbar>
  );
}
