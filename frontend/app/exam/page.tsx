"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Info,
  Lightbulb,
  ListChecks,
  Play,
  Settings2,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

type ExamMode = "practice" | "timed";
type PracticeFeedback = "each" | "end";

export default function ExamPage() {
  const router = useRouter();
  const [mode, setMode] = useState<ExamMode>("practice");
  const [feedback, setFeedback] = useState<PracticeFeedback>("each");

  useEffect(() => {
    if (!getStudentId()) router.replace("/");
  }, [router]);

  function startHref() {
    if (mode === "timed") {
      return "/session?mode=full_length&flp=timed&explain=end";
    }
    return `/session?mode=full_length&flp=practice&explain=${feedback}`;
  }

  return (
    <Navbar>
      <main className="min-h-[calc(100vh-3.5rem)] bg-[#F4F7FB] lg:min-h-screen">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3.5 py-1.5 text-xs font-bold tracking-wide text-brand">
            <ShieldCheck className="h-3.5 w-3.5" />
            MDCAT MOCK EXAM
          </div>

          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-brand-700 sm:text-4xl">
            Initialize Exam
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 sm:text-base">
            Prepare for the actual MDCAT conditions. Choose your approach
            carefully to maximize your learning efficiency.
          </p>

          {/* Mode row */}
          <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
            <div className="rounded-2xl border border-sky-100 bg-[#EAF3FB] p-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand shadow-sm">
                <Info className="h-4 w-4" />
              </div>
              <p className="mt-4 font-display text-[15px] leading-relaxed text-brand-700">
                &ldquo;A serious environment builds serious results. Treat this
                simulator as the final threshold before your medical career.&rdquo;
              </p>
            </div>

            <button
              type="button"
              onClick={() => setMode("practice")}
              className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition ${
                mode === "practice"
                  ? "border-brand ring-1 ring-brand/20"
                  : "border-slate-100 hover:border-slate-200"
              }`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  mode === "practice"
                    ? "bg-brand-50 text-brand"
                    : "bg-slate-50 text-slate-500"
                }`}
              >
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <h2 className="font-semibold text-slate-900">Practice Mode</h2>
                {mode === "practice" && (
                  <CheckCircle2 className="h-4 w-4 text-brand" />
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Focus on conceptual clarity. Learn as you go with immediate
                explanations and textbook references.
              </p>
            </button>

            <button
              type="button"
              onClick={() => setMode("timed")}
              className={`rounded-2xl border bg-white p-5 text-left shadow-sm transition ${
                mode === "timed"
                  ? "border-brand ring-1 ring-brand/20"
                  : "border-slate-100 hover:border-slate-200"
              }`}
            >
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  mode === "timed"
                    ? "bg-brand-50 text-brand"
                    : "bg-slate-50 text-slate-500"
                }`}
              >
                <Clock className="h-5 w-5" />
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <h2 className="font-semibold text-slate-900">Timed Mode</h2>
                {mode === "timed" && (
                  <CheckCircle2 className="h-4 w-4 text-brand" />
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Strict exam conditions. 81 MCQs · ~70 minutes · no feedback until
                completion.
              </p>
            </button>
          </div>

          {/* Practice preferences */}
          {mode === "practice" && (
            <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-brand" />
                <h3 className="font-semibold text-slate-900">
                  Practice Preferences
                </h3>
              </div>

              <p className="mt-5 text-xs font-bold tracking-wider text-brand">
                FEEDBACK TIMING
              </p>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setFeedback("each")}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
                    feedback === "each"
                      ? "border-brand bg-brand-50/50 ring-1 ring-brand/15"
                      : "border-slate-100 hover:border-slate-200"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      feedback === "each"
                        ? "bg-brand text-white"
                        : "bg-slate-50 text-slate-500"
                    }`}
                  >
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">
                      After each question
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Best for concept learning
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFeedback("end")}
                  className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
                    feedback === "end"
                      ? "border-brand bg-brand-50/50 ring-1 ring-brand/15"
                      : "border-slate-100 hover:border-slate-200"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      feedback === "end"
                        ? "bg-brand text-white"
                        : "bg-slate-50 text-slate-500"
                    }`}
                  >
                    <ListChecks className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">At the end</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      Mimics exam flow
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Start row */}
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="inline-flex items-center gap-2 text-sm text-slate-500">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              Weak spots and daily plan will update after your session.
            </p>
            <Link
              href={startHref()}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
                <Play className="h-3.5 w-3.5 fill-current" />
              </span>
              Start Full-length Exam
            </Link>
          </div>

          {/* Bottom banner */}
          <div className="relative mt-10 overflow-hidden rounded-2xl bg-brand-700 px-6 py-8 sm:px-8">
            <div
              className="pointer-events-none absolute inset-0 opacity-30"
              style={{
                background:
                  "radial-gradient(ellipse at 70% 50%, rgba(56,189,248,0.35), transparent 55%)",
              }}
              aria-hidden
            />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <p className="max-w-lg font-display text-lg leading-relaxed text-sky-50 sm:text-xl">
                &ldquo;The heights by great men reached and kept were not
                attained by sudden flight…&rdquo;{" "}
                <span className="text-sky-200">
                  — Prepare with Uraan{" "}
                  <span className="font-urdu">اُڑان</span>
                </span>
              </p>

              <div className="w-full max-w-xs rounded-xl border border-white/15 bg-white/10 p-4 text-sm text-sky-50 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <span className="text-sky-200/80">Time Limit</span>
                  <span className="font-semibold">~70 minutes</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sky-200/80">Questions</span>
                  <span className="font-semibold">81 Biology</span>
                </div>
                <div className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs text-sky-100/90">
                  Flagged · Notes · Ask AI after review
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </Navbar>
  );
}
