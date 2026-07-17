"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, Clock, HelpCircle } from "lucide-react";
import { api, type WeeklyPlan } from "@/lib/api";
import { getStudentId } from "@/lib/student";
import Navbar from "@/components/Navbar";

const DAY_COLORS: Record<string, string> = {
  monday: "bg-blue-50 text-blue-700",
  tuesday: "bg-green-50 text-green-700",
  wednesday: "bg-purple-50 text-purple-700",
  thursday: "bg-amber-50 text-amber-700",
  friday: "bg-red-50 text-red-700",
  saturday: "bg-pink-50 text-pink-700",
  sunday: "bg-indigo-50 text-indigo-700",
};

export default function WeeklyPlanPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = getStudentId();
    if (!id) {
      router.replace("/");
      return;
    }
    api
      .getWeeklyPlan(id)
      .then(setPlan)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-brand" />
            <div>
              <h1 className="text-xl font-bold text-slate-800">Weekly Plan</h1>
              <p className="text-sm text-slate-500">
                {plan ? `Week of ${plan.week_start}` : "Your personalized study plan"}
              </p>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </header>

        {loading && (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {plan?.plan.map((item, i) => {
            const colorClass = DAY_COLORS[item.day.toLowerCase()] || "bg-slate-50 text-slate-700";
            return (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-6 py-5 shadow-sm"
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${colorClass}`}
                  >
                    {item.day}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">{item.concept}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{item.reason}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span>{item.minutes} min</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>{item.question_count} Qs</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
