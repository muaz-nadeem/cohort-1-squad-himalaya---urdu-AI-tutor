"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { api, type ChapterInfo } from "@/lib/api";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

type Row = { chapter: string; book: string; count: number };

export default function CustomQuizPage() {
  const router = useRouter();
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [rows, setRows] = useState<Row[]>([
    { chapter: "", book: "fsc_part1", count: 30 },
  ]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getStudentId()) {
      router.replace("/");
      return;
    }
    api.getChapters().then(setChapters).catch(() => setChapters([]));
  }, [router]);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, { chapter: "", book: "fsc_part1", count: 20 }]);
  }

  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function start() {
    setError("");
    const selections = rows
      .filter((r) => r.chapter && r.count > 0)
      .map((r) => ({
        chapter: r.chapter,
        book: r.book,
        count: Math.min(100, Math.max(1, r.count)),
      }));
    if (!selections.length) {
      setError("Pick at least one chapter.");
      return;
    }
    const encoded = encodeURIComponent(JSON.stringify(selections));
    router.push(`/session?mode=custom&custom=${encoded}`);
  }

  const total = rows.reduce((s, r) => s + (r.chapter ? r.count : 0), 0);

  return (
    <>
      <Navbar />
      <main className="relative min-h-[calc(100vh-4rem)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_#fef3c7_0%,_transparent_45%)]" />
        <div className="relative mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>

          <h1 className="font-display text-3xl font-bold text-slate-900">
            Build your quiz
          </h1>
          <p className="mt-2 text-slate-600">
            Mix chapters from 1st and 2nd year. Each chapter pulls a random mix from
            the full MCQ bank.
          </p>

          <div className="mt-8 space-y-4">
            {rows.map((row, i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1 text-xs font-medium text-slate-500">
                    Year
                    <select
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      value={row.book}
                      onChange={(e) => {
                        updateRow(i, {
                          book: e.target.value,
                          chapter: "",
                        });
                      }}
                    >
                      <option value="fsc_part1">1st year</option>
                      <option value="fsc_part2">2nd year</option>
                    </select>
                  </label>
                  <label className="flex-[2] text-xs font-medium text-slate-500">
                    Chapter
                    <select
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      value={row.chapter}
                      onChange={(e) => updateRow(i, { chapter: e.target.value })}
                    >
                      <option value="">Select chapter</option>
                      {chapters
                        .filter((c) => c.book === row.book)
                        .map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="w-28 text-xs font-medium text-slate-500">
                    MCQs
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                      value={row.count}
                      onChange={(e) =>
                        updateRow(i, { count: Number(e.target.value) || 1 })
                      }
                    />
                  </label>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="rounded-xl p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addRow}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
          >
            <Plus className="h-4 w-4" /> Add another chapter
          </button>

          {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

          <div className="mt-8 flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              Total: <span className="font-semibold text-slate-800">{total}</span> MCQs
            </p>
            <button onClick={start} className="btn-primary">
              Start quiz
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
