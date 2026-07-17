"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { setStudentId, setStudentName } from "@/lib/student";

const LEVELS = [
  { id: "just_starting", label: "Just starting", ur: "ابھی شروع کیا ہے" },
  { id: "halfway", label: "Halfway", ur: "آدھی تیاری ہو گئی" },
  { id: "almost_done", label: "Almost done", ur: "تقریباً مکمل" },
];

const TIMES = [
  { id: "30min", label: "30 min / day" },
  { id: "1hr", label: "1 hour / day" },
  { id: "2hr_plus", label: "2+ hours / day" },
];

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [level, setLevel] = useState("");
  const [time, setTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!level || !time) return;
    setLoading(true);
    setError("");
    try {
      const student = await api.createStudent({
        name: name || undefined,
        email: email || undefined,
        level,
        daily_time: time,
      });
      setStudentId(student.id);
      setStudentName(student.name || name || "Student");
      router.replace("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-surface-blue p-12">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
                <BookOpen className="h-5 w-5" />
              </div>
              <span className="text-xl font-bold text-brand">uraan</span>
            </Link>
          </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-bold leading-tight text-slate-900">
            Your MDCAT prep,
            <br />
            <span className="text-brand-light">all in one place.</span>
          </h1>
          <p className="mt-4 text-slate-600">
            Biology — chapter by chapter, at your own pace.
          </p>
        </div>

        <p className="text-sm text-slate-400">
          &copy; {new Date().getFullYear()} Uraan. All rights reserved.
        </p>
      </div>

      {/* Right panel */}
      <div className="flex w-full items-center justify-center bg-surface-blue/50 px-6 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
              <BookOpen className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold text-brand">uraan</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Create account</h2>
          <p className="mt-1 text-sm text-slate-500">
            {step === 1
              ? "Enter your details to get started."
              : "Tell us about your preparation."}
          </p>

          {/* Step indicators */}
          <div className="mt-6 flex gap-2">
            <div className={`h-1 flex-1 rounded-full ${step >= 1 ? "bg-brand" : "bg-slate-200"}`} />
            <div className={`h-1 flex-1 rounded-full ${step >= 2 ? "bg-brand" : "bg-slate-200"}`} />
          </div>

          {step === 1 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) setStep(2);
              }}
              className="mt-8 space-y-5"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Full name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ahmed Raza"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button type="submit" className="btn-primary w-full">
                Continue
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignup} className="mt-8 space-y-6">
              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Preparation level
                </p>
                <div className="grid gap-2">
                  {LEVELS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setLevel(l.id)}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        level === l.id
                          ? "border-brand bg-brand-50 text-brand"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <span className="font-medium">{l.label}</span>
                      <span className="ml-2 font-urdu text-slate-400">{l.ur}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Daily study time
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {TIMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTime(t.id)}
                      className={`rounded-xl border px-2 py-3 text-sm transition ${
                        time === t.id
                          ? "border-brand bg-brand-50 text-brand"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn-ghost flex-1"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={loading || !level || !time}
                  className="btn-primary flex-1"
                >
                  {loading ? "Creating..." : "Start learning"}
                </button>
              </div>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-brand hover:underline">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
