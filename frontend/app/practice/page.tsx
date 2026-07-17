"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, BookOpen, Layers } from "lucide-react";
import { api, type ChapterInfo } from "@/lib/api";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

export default function PracticePage() {
  const router = useRouter();
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookFilter, setBookFilter] = useState<"all" | "fsc_part1" | "fsc_part2">("all");

  useEffect(() => {
    if (!getStudentId()) {
      router.replace("/");
      return;
    }
    api
      .getChapters()
      .then(setChapters)
      .catch(() => setChapters([]))
      .finally(() => setLoading(false));
  }, [router]);

  const filtered = chapters.filter(
    (c) => bookFilter === "all" || c.book === bookFilter
  );
  const part1 = filtered.filter((c) => c.book === "fsc_part1");
  const part2 = filtered.filter((c) => c.book === "fsc_part2");

  return (
    <Navbar>
      <main className="relative min-h-[calc(100vh-3.5rem)] overflow-hidden lg:min-h-screen">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e8f4f0_0%,_transparent_55%)]" />
        <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>

          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Chapter practice
            </h1>
            <p className="mt-2 max-w-xl text-slate-600">
              100 MCQs per chapter — mixed from academy tests, FLPs, past papers, and
              most-repeated questions.
            </p>
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["fsc_part1", "1st year"],
                ["fsc_part2", "2nd year"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setBookFilter(id)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                  bookFilter === id
                    ? "bg-brand text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <p className="text-sm text-slate-400">Loading chapters...</p>
          ) : (
            <div className="space-y-8">
              {bookFilter !== "fsc_part2" && part1.length > 0 && (
                <Section
                  title="FSc Part 1"
                  icon={<BookOpen className="h-4 w-4" />}
                  chapters={part1}
                />
              )}
              {bookFilter !== "fsc_part1" && part2.length > 0 && (
                <Section
                  title="FSc Part 2"
                  icon={<Layers className="h-4 w-4" />}
                  chapters={part2}
                />
              )}
            </div>
          )}
        </div>
      </main>
    </Navbar>
  );
}

function Section({
  title,
  icon,
  chapters,
}: {
  title: string;
  icon: ReactNode;
  chapters: ChapterInfo[];
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {chapters.map((ch) => (
          <Link
            key={ch.id}
            href={`/session?mode=chapter&chapter=${encodeURIComponent(ch.name)}`}
            className="group rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
          >
            <p className="font-semibold text-slate-800 group-hover:text-brand">
              {ch.name}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {ch.has_questions ? "100 mixed MCQs" : "Ingest PDFs to unlock bank"}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
