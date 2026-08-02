"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  Info,
  Lock,
  Mail,
  Plane,
  User,
} from "lucide-react";
import { api } from "@/lib/api";
import { setStudentId, setStudentName } from "@/lib/student";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      const student = await api.createStudent({
        name: name || undefined,
        email: email.trim(),
        level: "just_starting",
        daily_time: "1hr",
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

        <Link href="/" className="relative inline-flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Plane className="h-5 w-5 -rotate-45" />
          </div>
          <div>
            <p className="font-display text-2xl font-bold leading-none">Uraan</p>
            <p className="font-urdu mt-1 text-sm text-sky-200/90">اُڑان</p>
          </div>
        </Link>

        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-bold leading-tight xl:text-[2.6rem]">
            Your medical journey starts here.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-300">
            Join MDCAT aspirants aiming for the stars. We&apos;ve built the
            ultimate digital study hall, just for you.
          </p>
        </div>

        <div className="relative rounded-2xl bg-white/10 p-5 ring-1 ring-white/15 backdrop-blur-sm">
          <p className="text-sm leading-relaxed text-sky-50/95">
            Chapter-wise MCQ practice, full-length papers, and an AI tutor that
            explains your mistakes — in Urdu or English, grounded in your FSc
            textbooks.
          </p>
        </div>
      </div>

      {/* Right form */}
      <div className="flex w-full flex-col bg-[#F7F9FC] px-6 py-10 lg:w-[52%] lg:px-16">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white">
                <Plane className="h-4 w-4 -rotate-45" />
              </div>
              <span className="font-display text-xl font-bold text-brand">
                Uraan
              </span>
            </Link>
            <Link href="/login" className="text-sm font-medium text-brand">
              Log In
            </Link>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-bold text-brand-700">
                Create your account
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Enter your details to get started.
              </p>
            </div>
            <Link
              href="/login"
              className="hidden shrink-0 text-sm text-slate-500 lg:block"
            >
              Already have one?{" "}
              <span className="font-semibold text-brand">Log In</span>
            </Link>
          </div>

          <form onSubmit={handleSignup} className="mt-8 space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Full Name
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  className="!pl-11"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Email Address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="!pl-11"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
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
              <p className="mt-1.5 text-xs text-slate-400">
                Must be at least 8 characters with a symbol.
              </p>
            </div>

            <div className="flex items-start gap-2.5 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-slate-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <p>
                Don&apos;t worry, you can always update these details later in
                your student profile.
              </p>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="btn-primary w-full"
            >
              {loading ? "Creating account..." : "Create account →"}
            </button>

            <p className="text-center text-xs text-slate-400">
              By continuing, you agree to Uraan&apos;s{" "}
              <span className="font-medium text-slate-600">
                Terms of Service
              </span>{" "}
              and{" "}
              <span className="font-medium text-slate-600">Privacy Policy</span>
              .
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
