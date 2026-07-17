"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookOpen, Eye, EyeOff } from "lucide-react";
import { api } from "@/lib/api";
import { setStudentId, setStudentName } from "@/lib/student";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError("");
    try {
      const student = await api.login(email.trim());
      setStudentId(student.id);
      setStudentName(student.name || "Student");
      router.replace("/dashboard");
    } catch {
      setError("No account found with this email. Please sign up first.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between bg-surface-blue p-12">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
            <BookOpen className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold text-brand">uraan</span>
        </Link>

        <div className="max-w-md">
          <h1 className="font-display text-4xl font-bold leading-tight text-slate-900">
            Welcome back.
            <br />
            <span className="text-brand-light">Keep flying.</span>
          </h1>
          <p className="mt-4 text-slate-600">
            Diagnostic, chapter practice, full-length papers, and Ask Textbook —
            your MDCAT Biology prep in one place.
          </p>
        </div>

        <p className="text-sm text-slate-400">
          &copy; {new Date().getFullYear()} Uraan. All rights reserved.
        </p>
      </div>

      <div className="flex w-full items-center justify-center bg-surface-blue/50 px-6 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
                <BookOpen className="h-5 w-5" />
              </div>
              <span className="text-xl font-bold text-brand">uraan</span>
            </Link>
          </div>

          <h2 className="text-2xl font-bold text-slate-900">Log in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter your email to continue to your dashboard.
          </p>

          <form onSubmit={handleLogin} className="mt-8 space-y-5">
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
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  Password
                </label>
              </div>
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
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="btn-primary w-full"
            >
              {loading ? "Logging in..." : "Log in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-500">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-semibold text-brand hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
