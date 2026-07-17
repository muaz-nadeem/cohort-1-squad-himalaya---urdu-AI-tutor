"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Sparkles, Target, ListChecks, MessageSquare } from "lucide-react";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

type PracticeFeedback = "each" | "end" | null;

export default function ExamPage() {
  const router = useRouter();
  const [practiceChoice, setPracticeChoice] = useState<PracticeFeedback>(null);

  useEffect(() => {
    if (!getStudentId()) router.replace("/");
  }, [router]);

  return (
    <>
      <Navbar />
      <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_#dbeafe_0%,_transparent_50%)]" />
        <div className="relative mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <Link
            href="/dashboard"
            className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>

          <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Biology full-length
          </h1>
          <p className="mt-3 max-w-xl text-slate-600">
            Our own MDCAT-style Biology paper: <strong>81 MCQs</strong> mixed from
            your bank. Timed mode reviews everything at the end; practice lets you choose.
          </p>

          {practiceChoice === null ? (
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setPracticeChoice("each")}
                className="group rounded-3xl border border-slate-100 bg-white p-6 text-left shadow-sm transition hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Sparkles className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Practice mode</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Untimed. Choose whether you want explanations after each question
                  or a full review at the end.
                </p>
                <p className="mt-4 text-sm font-semibold text-brand group-hover:underline">
                  Continue →
                </p>
              </button>

              <Link
                href="/session?mode=full_length&flp=timed&explain=end"
                className="group rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                  <Clock className="h-6 w-6" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">Timed mode</h2>
                <p className="mt-2 text-sm text-slate-500">
                  70-minute countdown. No feedback mid-paper — full question review
                  with explanations + Ask AI at the end.
                </p>
                <p className="mt-4 text-sm font-semibold text-brand group-hover:underline">
                  Start timed exam →
                </p>
              </Link>
            </div>
          ) : (
            <div className="mt-10 space-y-4">
              <button
                type="button"
                onClick={() => setPracticeChoice(null)}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                ← Back
              </button>
              <h2 className="font-display text-2xl font-bold text-slate-900">
                Practice feedback
              </h2>
              <p className="text-sm text-slate-500">
                When do you want explanations?
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Link
                  href="/session?mode=full_length&flp=practice&explain=each"
                  className="group rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
                >
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-slate-900">After each question</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    See correct/wrong + explanation before moving on.
                  </p>
                </Link>
                <Link
                  href="/session?mode=full_length&flp=practice&explain=end"
                  className="group rounded-3xl border border-slate-100 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-brand/40 hover:shadow-lg"
                >
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                    <ListChecks className="h-5 w-5" />
                  </div>
                  <h3 className="font-bold text-slate-900">At the end</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Exam-style flow, then full review with explanations + Ask AI.
                  </p>
                </Link>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <Target className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
            <p>
              After you finish, we update your weak spots and reshape tomorrow&apos;s
              daily plan so you practice what you missed.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
