"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BookOpen,
  Target,
  ChevronRight,
  Play,
  Zap,
  ClipboardList,
  Timer,
  Puzzle,
  MessageCircle,
  Lock,
} from "lucide-react";
import { api, type Dashboard, type WeakSpot } from "@/lib/api";
import { getStudentId, getStudentName } from "@/lib/student";
import Navbar from "@/components/Navbar";

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [weakSpots, setWeakSpots] = useState<WeakSpot[]>([]);
  const [studentName, setStudentName_] = useState("Student");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = getStudentId();
    if (!id) {
      router.replace("/");
      return;
    }
    setStudentName_(getStudentName() || "Student");

    Promise.all([
      api.getDashboard(id),
      api.getWeakSpots(id).catch(() => []),
    ])
      .then(([dashboard, spots]) => {
        setData(dashboard);
        setWeakSpots(spots);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <Navbar>
        <div className="flex min-h-[80vh] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <p className="mt-3 text-sm text-slate-400">Loading dashboard...</p>
          </div>
        </div>
      </Navbar>
    );
  }

  const greeting = getGreeting();
  const firstName = studentName.split(" ")[0];
  const mastery = data?.accuracy_pct ?? 0;
  const daysToMdcat = getDaysToMdcat();
  const planItems = data?.daily_plan?.items || [];
  const primary = planItems[0];
  const hasPractice = (data?.total_attempted ?? 0) > 0;

  return (
    <Navbar>
      <div className="relative min-h-[calc(100vh-3.5rem)] lg:min-h-screen">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#e0edfb_0%,_transparent_50%)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {error && (
            <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error} — is the backend running?
            </div>
          )}

          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">{greeting}</p>
              <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900">
                {firstName}, welcome to Uraan
              </h1>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 text-center shadow-sm ring-1 ring-slate-100">
              <p className="text-2xl font-bold text-brand">{daysToMdcat}</p>
              <p className="text-xs text-slate-400">days to MDCAT</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand to-brand-dark p-6 text-white shadow-lg">
                <p className="text-sm text-blue-100">
                  {hasPractice ? "Today's plan" : "Get started"}
                </p>
                <h2 className="mt-1 text-2xl font-bold">
                  {hasPractice
                    ? primary?.chapter || "Keep practising Biology"
                    : "Practice chapter by chapter"}
                </h2>
                <p className="mt-2 max-w-lg text-sm text-blue-100">
                  {hasPractice
                    ? primary?.reason ||
                      "As you practise, we spot weak chapters and reshape your plan."
                    : "Pick a chapter and start MCQs. Wrong answers teach us your weak spots — then we adapt your plan."}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href={hasPractice ? planHref(primary) : "/practice"}
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand transition hover:bg-blue-50"
                  >
                    <Play className="h-4 w-4" />
                    {hasPractice ? "Continue today" : "Start chapter practice"}
                  </Link>
                  <div className="inline-flex items-center gap-4 rounded-xl bg-white/10 px-4 py-2 text-sm backdrop-blur-sm">
                    <span>{mastery}% mastery</span>
                    <span>{data?.streak || 0} day streak</span>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="mb-4 text-lg font-semibold text-slate-800">
                  Practice hub
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ActionCard
                    href="/practice"
                    icon={<BookOpen className="h-5 w-5" />}
                    title="Chapter practice"
                    desc="100 mixed MCQs per chapter"
                    tint="bg-emerald-50 text-emerald-600"
                  />
                  <ActionCard
                    href="/exam"
                    icon={<Timer className="h-5 w-5" />}
                    title="Full-length"
                    desc="81-Q Biology FLP"
                    tint="bg-sky-50 text-sky-600"
                  />
                </div>
              </div>

              {planItems.length > 1 && (
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                  <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
                    <ClipboardList className="h-4 w-4 text-brand" /> Plan items
                  </h2>
                  <ul className="space-y-3">
                    {planItems.map((item, i) => (
                      <li key={i}>
                        <Link
                          href={planHref(item)}
                          className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-slate-50"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {item.chapter || labelAction(item.action)}
                            </p>
                            <p className="text-xs text-slate-400">{item.reason}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-slate-300" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data && data.chapters.length > 0 && (
                <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="font-semibold text-slate-800">Chapter progress</h2>
                    <Link
                      href="/weak-spots"
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      Weak spots
                    </Link>
                  </div>
                  <div className="space-y-4">
                    {data.chapters.slice(0, 5).map((c) => (
                      <div key={c.chapter}>
                        <div className="mb-1.5 flex justify-between text-sm">
                          <span className="font-medium text-slate-700">{c.chapter}</span>
                          <span className="text-slate-400">{c.accuracy_pct}%</span>
                        </div>
                        <div className="progress-bar">
                          <div
                            className={`progress-bar-fill ${
                              c.accuracy_pct >= 70
                                ? "bg-accent-green"
                                : c.accuracy_pct >= 40
                                ? "bg-accent-amber"
                                : "bg-accent-red"
                            }`}
                            style={{ width: `${c.accuracy_pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="space-y-6">
              <Link
                href="/chat"
                className="group relative flex min-h-[240px] flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-sky-500 to-brand p-6 text-white shadow-lg transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
                <div className="absolute -bottom-8 -left-4 h-24 w-24 rounded-full bg-white/10" />
                <div className="relative">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                    <MessageCircle className="h-7 w-7" />
                  </div>
                  <h2 className="font-display text-2xl font-bold leading-tight">
                    Ask Textbook
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-sky-50">
                    Ask in Urdu or English — typed or spoken. Clear explanations
                    with page cites when the book has them.
                  </p>
                </div>
                <span className="relative mt-6 inline-flex items-center gap-2 text-sm font-semibold">
                  Open tutor
                  <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </Link>

              <Link
                href="/custom-quiz"
                className="group relative flex min-h-[200px] flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-amber-400 to-orange-600 p-6 text-white shadow-lg transition hover:-translate-y-1 hover:shadow-xl"
              >
                <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
                <div className="absolute -bottom-8 -left-4 h-24 w-24 rounded-full bg-white/10" />
                <div className="relative">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
                    <Puzzle className="h-7 w-7" />
                  </div>
                  <h2 className="font-display text-2xl font-bold leading-tight">
                    Custom quiz
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-amber-50">
                    Pick chapters from 1st and 2nd year and set how many MCQs
                    you want from each.
                  </p>
                </div>
                <span className="relative mt-6 inline-flex items-center gap-2 text-sm font-semibold">
                  Build quiz
                  <ChevronRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </span>
              </Link>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
                  <Zap className="h-4 w-4 text-amber-500" /> Stats
                </h3>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Attempted</dt>
                    <dd className="font-semibold">{data?.total_attempted ?? 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Accuracy</dt>
                    <dd className="font-semibold">{mastery}%</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Streak</dt>
                    <dd className="font-semibold">{data?.streak ?? 0} days</dd>
                  </div>
                </dl>
              </div>

              {weakSpots.length > 0 ? (
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 flex items-center gap-2 font-semibold text-slate-800">
                    <Target className="h-4 w-4 text-red-500" /> Focus next
                  </h3>
                  <ul className="space-y-3">
                    {weakSpots.slice(0, 4).map((s) => (
                      <li key={s.concept_id}>
                        <Link
                          href={
                            s.chapter
                              ? `/session?mode=chapter&chapter=${encodeURIComponent(s.chapter)}`
                              : `/session?concept_id=${s.concept_id}`
                          }
                          className="block rounded-xl px-2 py-2 hover:bg-slate-50"
                        >
                          <p className="text-sm font-medium text-slate-800">
                            {s.concept}
                          </p>
                          <p className="text-xs text-slate-400">
                            {s.chapter} · {s.accuracy_pct}%
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-2xl bg-brand-50 p-5">
                  <p className="text-sm font-medium text-brand">
                    Practise a few chapters — we&apos;ll spot which topics you miss
                    and push those into your plan.
                  </p>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </Navbar>
  );
}

function ActionCard({
  href,
  icon,
  title,
  desc,
  tint,
  locked,
}: {
  href?: string;
  icon: ReactNode;
  title: string;
  desc: string;
  tint: string;
  locked?: boolean;
}) {
  const inner = (
    <>
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${tint}`}>
        {locked ? <Lock className="h-4 w-4" /> : icon}
      </div>
      <h3 className="font-semibold text-slate-800">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{desc}</p>
      {!locked && (
        <p className="mt-3 flex items-center gap-1 text-sm font-medium text-brand opacity-0 transition group-hover:opacity-100">
          Open <ChevronRight className="h-4 w-4" />
        </p>
      )}
    </>
  );

  if (locked || !href) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-5 opacity-70">
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
    >
      {inner}
    </Link>
  );
}

function planHref(item?: { action?: string; chapter?: string | null } | null) {
  if (!item) return "/practice";
  if (item.action === "full_length_practice") return "/exam";
  if (item.chapter)
    return `/session?mode=chapter&chapter=${encodeURIComponent(item.chapter)}`;
  return "/practice";
}

function labelAction(action?: string) {
  if (action === "full_length_practice") return "Platform FLP (81)";
  return "Practice";
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getDaysToMdcat() {
  const exam = new Date("2026-08-25");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((exam.getTime() - today.getTime()) / 86400000));
}
