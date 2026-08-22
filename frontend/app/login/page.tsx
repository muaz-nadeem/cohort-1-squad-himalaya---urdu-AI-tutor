"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { signIn } from "@/lib/auth";
import { setStudentName } from "@/lib/student";
import BrandMark from "@/components/BrandMark";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("confirmed") === "1") {
      setNotice("Email confirmed. Sign in to continue.");
    }
    const linkError = q.get("error");
    if (linkError) setError(linkError);
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const emailValue = email.trim();
    if (!emailValue || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await signIn(emailValue, password);
      if (!keepLoggedIn) {
        document.cookie =
          "uraan_signed_in=1; path=/; SameSite=Lax; max-age=86400";
      }
      // Don't wait on the profile — a cold backend here used to leave the
      // button stuck on "Signing in…".
      void api
        .getStudent()
        .then((me) => setStudentName(me.name || "Student"))
        .catch(() => {});
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Login failed. Check your email and password."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh">
      <div className="relative hidden overflow-hidden bg-brand-700 lg:flex lg:w-[48%] flex-col justify-between px-12 py-10 text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.55) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />
        <Link href="/" className="relative inline-flex items-center gap-3">
          <BrandMark className="h-10 w-10" priority />
          <div>
            <p className="font-display text-2xl font-bold leading-none">Uraan</p>
            <p className="font-urdu mt-1 text-sm text-sky-200/90">اُڑان</p>
          </div>
        </Link>
        <div className="relative max-w-md">
          <h1 className="font-display text-4xl font-bold leading-tight xl:text-[2.6rem]">
            Welcome back, aspirant.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-300">
            Sign in with your email and password to continue your MDCAT prep.
          </p>
        </div>
        <p className="relative text-sm text-sky-200/70">MDCAT 2026 Biology</p>
      </div>

      <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Link href="/" className="flex items-center gap-2.5">
              <BrandMark className="h-9 w-9" />
              <span className="font-display text-xl font-bold text-brand">
                Uraan
              </span>
            </Link>
            <Link href="/signup" className="text-sm font-medium text-brand">
              Sign up
            </Link>
          </div>
          <h2 className="font-display text-2xl font-bold text-slate-900">
            Sign in
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            New here?{" "}
            <Link href="/signup" className="font-medium text-brand hover:underline">
              Create an account
            </Link>
          </p>

          <form onSubmit={handleLogin} className="mt-8 space-y-5">
            {notice && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {notice}
              </p>
            )}
            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}
            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700">
                <Mail className="h-4 w-4 text-slate-400" /> Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none ring-brand/30 focus:ring-2 sm:text-sm"
                autoComplete="email"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-sm font-medium text-slate-700">
                <span className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-slate-400" /> Password
                </span>
              </span>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 pr-12 text-base outline-none ring-brand/30 focus:ring-2 sm:text-sm"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-slate-400"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={keepLoggedIn}
                onChange={(e) => setKeepLoggedIn(e.target.checked)}
                className="rounded border-slate-300 text-brand focus:ring-brand"
              />
              Keep me logged in
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
