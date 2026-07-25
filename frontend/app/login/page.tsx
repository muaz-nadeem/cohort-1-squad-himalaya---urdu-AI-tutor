"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail, Plane } from "lucide-react";
import { api } from "@/lib/api";
import { setStudentId, setStudentName } from "@/lib/student";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const emailValue = email.trim();
    if (!emailValue) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const student = await api.login(emailValue);
      setStudentId(student.id);
      setStudentName(student.name || "Student");
      router.replace("/dashboard");
    } catch {
      setError("No account found with this email. Please verify or sign up.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-700 lg:flex lg:w-[48%] flex-col justify-between px-12 py-10 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.55) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
          aria-hidden
        />

        <div className="relative">
          <Link href="/" className="inline-flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
              <Plane className="h-5 w-5 -rotate-45" />
            </div>
            <div>
              <p className="font-display text-2xl font-bold leading-none">Uraan</p>
              <p className="font-urdu mt-1 text-sm text-sky-200/90">اُڑان</p>
            </div>
          </Link>
          <span className="mt-4 inline-flex rounded-full bg-sky-400/20 px-3 py-1 text-xs font-semibold tracking-wide text-sky-100 ring-1 ring-sky-300/30">
            MDCAT 2026
          </span>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-bold leading-tight xl:text-[2.6rem]">
            Your medical career starts with a single step.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-300">
            Uraan provides the most accurate MDCAT simulation environment,
            tailored to help you master every chapter with medical-grade
            precision. Stay focused, your goal is within reach.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-8">
            <div>
              <p className="font-display text-3xl font-bold">4k+</p>
              <p className="mt-1 text-sm text-slate-400">Practice Questions</p>
            </div>
            <div>
              <p className="font-display text-3xl font-bold">50+</p>
              <p className="mt-1 text-sm text-slate-400">Mock Tests</p>
            </div>
          </div>
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex -space-x-2">
            {["#93C5FD", "#BFDBFE", "#E0F2FE"].map((c, i) => (
              <span
                key={i}
                className="h-8 w-8 rounded-full border-2 border-brand-700"
                style={{ backgroundColor: c }}
              />
            ))}
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-brand-700 bg-white/15 text-[10px] font-semibold">
              +3k
            </span>
          </div>
          <p className="text-sm text-slate-300">
            Join thousands of successful medical aspirants.
          </p>
        </div>
      </div>

      {/* Right form */}
      <div className="flex w-full flex-col bg-[#F7F9FC] px-6 py-10 lg:w-[52%] lg:px-16">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white">
                <Plane className="h-4 w-4 -rotate-45" />
              </div>
              <span className="font-display text-xl font-bold text-brand">Uraan</span>
            </Link>
          </div>

          <h2 className="font-display text-3xl font-bold text-brand-700">
            Welcome Back
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Resume your MDCAT preparation where you left off.
          </p>

          {error && (
            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
              <span className="mt-0.5 text-base leading-none">⚠</span>
              <p>{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="mt-8 space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Official Email Address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                  placeholder="aspirant@uraan.com"
                  className="!pl-11"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Password
                </label>
                <button
                  type="button"
                  className="text-xs font-medium text-brand hover:underline"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="!pl-11 !pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={keepLoggedIn}
                onChange={(e) => setKeepLoggedIn(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30"
              />
              Keep me logged in for this study session
            </label>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? "Logging in..." : "Log in →"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            New to Uraan?{" "}
            <Link
              href="/signup"
              className="font-semibold text-brand hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>

        <p className="mt-10 text-center text-[10px] font-semibold tracking-[0.2em] text-slate-400">
          POWERED BY CLINICAL PRECISION
        </p>
      </div>
    </div>
  );
}
