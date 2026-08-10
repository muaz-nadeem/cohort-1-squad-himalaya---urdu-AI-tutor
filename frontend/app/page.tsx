"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getStudentId } from "@/lib/student";
import { syncStudentCacheFromSession } from "@/lib/auth";
import BrandMark from "@/components/BrandMark";

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    void syncStudentCacheFromSession().then((id) => {
      if (id || getStudentId()) router.replace("/dashboard");
    });
  }, [router]);

  return (
    <div className="landing min-h-screen text-slate-900">
      <header className="absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <BrandMark className="h-8 w-8" priority />
            <span className="font-display text-lg font-bold tracking-tight text-brand">
              uraan
            </span>
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <Link
              href="/login"
              className="font-medium text-slate-600 transition hover:text-brand"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-hero relative overflow-hidden">
        <div className="landing-hero-glow" aria-hidden />
        <div className="landing-hero-grid" aria-hidden />
        <svg
          className="landing-arc"
          viewBox="0 0 800 400"
          fill="none"
          aria-hidden
        >
          <path
            d="M40 320 C 180 80, 420 40, 760 180"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>

        <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-5 pb-16 pt-20 sm:px-8 lg:flex-row lg:items-center lg:gap-4 lg:pb-12 lg:pt-16">
          <div className="landing-reveal relative z-10 max-w-xl flex-1">
            <p className="font-urdu text-xl leading-loose text-brand/70 sm:text-2xl">
              اڑان
            </p>
            <p className="font-display mt-2 text-[clamp(4rem,12vw,7.5rem)] font-bold leading-[0.82] tracking-tight text-brand">
              uraan
            </p>
            <h1 className="mt-7 text-[1.55rem] font-medium leading-snug tracking-tight text-slate-800 sm:text-[1.85rem]">
              Practice that finds what you miss.
            </h1>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-slate-500">
              Chapter MCQs, full-length papers, and a tutor you can ask in Urdu
              — so tonight&apos;s revision isn&apos;t a guess.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/signup" className="landing-cta">
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="text-sm font-medium text-slate-500 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-800"
              >
                I already study here
              </Link>
            </div>
          </div>

          <div className="landing-reveal-delay relative z-10 mt-12 flex flex-1 justify-center lg:mt-0 lg:justify-end">
            <div className="landing-phone-orb" aria-hidden />
            <div className="landing-phone-float relative">
              <Phone>
                <ScreenAskUrdu />
              </Phone>
            </div>
          </div>
        </div>
      </section>

      {/* Features — clear, editorial list */}
      <section className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
          <p className="text-xs font-semibold tracking-[0.22em] text-slate-400">
            WHAT YOU GET
          </p>
          <h2 className="font-display mt-3 max-w-xl text-3xl font-bold tracking-tight text-slate-900 sm:text-[2.5rem] sm:leading-tight">
            Everything you need between now and the paper.
          </h2>

          <ol className="mt-14">
            <FeatureRow
              n="01"
              title="Ask in Urdu"
              text="Type or tap the mic. Ask like you would a senior — mitochondria, cycles, genetics. Plain Roman Urdu answers, with textbook page cites when the book covers it."
            />
            <FeatureRow
              n="02"
              title="100 MCQs per chapter"
              text="Each set mixes KIPS, STEP, FLPs, past papers, and most-repeated banks. Not one academy PDF on loop — closer to how the real paper feels."
            />
            <FeatureRow
              n="03"
              title="81-question Biology FLP"
              text="Our own full-length mix from the whole bank. Timed (~70 min) for pressure, or practice mode. Then review every question: answer, explain, Ask AI."
            />
            <FeatureRow
              n="04"
              title="Build a custom paper"
              text="Pick Part 1 and Part 2 chapters, set how many from each. Example: Cell Structure 30 + Homeostasis 30 + Genetics 30."
            />
            <FeatureRow
              n="05"
              title="Weak spots → tomorrow's plan"
              text="Wrong answers update your map. The daily plan pushes chapters you keep missing — so you stop wasting hours on what you already know."
            />
          </ol>
        </div>
      </section>

      {/* Product peeks */}
      <section className="landing-peek border-t border-slate-200/70">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
            <div>
              <p className="text-xs font-semibold tracking-[0.22em] text-slate-400">
                INSIDE
              </p>
              <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
                Practice.
                <br />
                See why.
                <br />
                Ask again.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-slate-500">
                Instant feedback on chapter practice. Explanations in the mix of
                English and Roman Urdu students actually revise with. Ask AI when
                an option still doesn&apos;t click.
              </p>
            </div>
            <div className="landing-ui-stack space-y-3">
              <UiMcq />
              <UiExplain />
              <UiVoice />
            </div>
          </div>
        </div>
      </section>

      {/* FLP */}
      <section className="border-t border-slate-200/70 bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:py-28">
          <div className="order-2 flex justify-center lg:order-1 lg:justify-start">
            <div className="landing-phone-tilt">
              <Phone>
                <ScreenFlp />
              </Phone>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-semibold tracking-[0.22em] text-slate-400">
              FULL-LENGTH
            </p>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              Sit a Biology paper before the real one.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-slate-500">
              Eighty-one mixed questions. A live timer when you want pressure.
              Practice mode when you want feedback as you go. You finish with a
              full review — not a score and a shrug.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-slate-700">
              {[
                "Practice mode or timed exam mode",
                "End review with correct answers + explanations",
                "Ask AI on any question you still don't get",
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Close CTA */}
      <section className="bg-brand-700 px-5 py-20 text-center sm:px-8 sm:py-24">
        <h2 className="mx-auto max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[2.75rem] lg:leading-tight">
          Ready to secure your white coat?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-slate-300 sm:text-lg">
          Join the next generation of doctors using Uraan to ace the MDCAT.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-flex items-center justify-center rounded-full bg-accent-blue px-8 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-600"
        >
          Create account
        </Link>
        <p className="mt-5 text-sm text-slate-400">
          No credit card required. Start free today.
        </p>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-5 py-8 sm:px-8 lg:flex-row lg:justify-between lg:gap-6">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-8 w-8" />
            <div className="flex items-baseline gap-2.5">
              <span className="font-display text-xl font-bold tracking-tight text-brand">
                uraan
              </span>
              <span className="font-urdu text-lg text-brand">اڑان</span>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-slate-500">
            <Link href="/practice" className="transition hover:text-brand">
              Practice
            </Link>
            <Link href="#pricing" className="transition hover:text-brand">
              Pricing
            </Link>
            <Link href="#privacy" className="transition hover:text-brand">
              Privacy
            </Link>
            <Link href="#terms" className="transition hover:text-brand">
              Terms
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="https://x.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X (Twitter)"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand transition hover:bg-brand-100"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-current"
                aria-hidden
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.227-8.451L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
              </svg>
            </a>
            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand transition hover:bg-brand-100"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current"
                strokeWidth="1.75"
                aria-hidden
              >
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
          </div>
        </div>

        <div className="border-t border-slate-100">
          <p className="mx-auto max-w-6xl px-5 py-5 text-center text-xs leading-relaxed text-slate-400 sm:px-8">
            © {new Date().getFullYear()} Uraan Education Technologies. All
            rights reserved. MDCAT is a registered trademark of PMDC.
          </p>
        </div>
      </footer>
    </div>
  );
}

function FeatureRow({
  n,
  title,
  text,
}: {
  n: string;
  title: string;
  text: string;
}) {
  return (
    <li className="landing-feature-row grid gap-3 border-t border-slate-100 py-8 first:border-t-0 sm:grid-cols-[4.5rem_minmax(0,13rem)_1fr] sm:gap-8 sm:py-9">
      <span className="font-display text-2xl font-bold tabular-nums text-brand/20">
        {n}
      </span>
      <h3 className="text-lg font-semibold tracking-tight text-slate-900">
        {title}
      </h3>
      <p className="text-[15px] leading-relaxed text-slate-500 sm:max-w-xl">
        {text}
      </p>
    </li>
  );
}

function Phone({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-[228px] sm:w-[248px]">
      <div className="overflow-hidden rounded-[1.85rem] border-[9px] border-[#0B1220] bg-[#0B1220] shadow-[0_40px_80px_-28px_rgba(15,36,64,0.55)]">
        <div className="relative h-[455px] overflow-hidden bg-[#F8FAFC] sm:h-[490px]">
          <div className="absolute left-1/2 top-2 z-10 h-[17px] w-[84px] -translate-x-1/2 rounded-full bg-[#0B1220]" />
          <div className="flex h-full flex-col pt-9">{children}</div>
        </div>
      </div>
    </div>
  );
}

function ScreenAskUrdu() {
  return (
    <div className="flex h-full flex-col px-3.5 pb-3.5">
      <p className="text-center text-[11px] font-bold text-brand">uraan</p>
      <p className="mt-2 text-center text-[9px] font-medium uppercase tracking-wider text-slate-400">
        Ask Textbook · Urdu
      </p>

      {/* Live voice call */}
      <div className="mt-3 rounded-2xl bg-brand px-3 py-3.5 text-center text-white">
        <div className="relative mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/25">
          <span className="landing-voice-pulse absolute inset-0 rounded-full bg-sky-300/40" />
          <span className="relative text-[10px] font-bold tracking-wide">mic</span>
        </div>
        <p className="mt-2.5 text-[11px] font-semibold">Voice call · live</p>
        <p className="mt-0.5 font-mono text-[10px] text-sky-100/90">00:42</p>
        <div className="landing-wave mt-2.5 flex h-5 items-end justify-center gap-[3px]">
          {[4, 9, 14, 8, 16, 7, 12, 5, 11, 6].map((h, i) => (
            <span
              key={i}
              className="landing-wave-bar w-[3px] rounded-full bg-sky-200/90"
              style={{ height: h, animationDelay: `${i * 0.08}s` }}
            />
          ))}
        </div>
        <p className="mt-2 text-[9px] leading-snug text-sky-100/85">
          “Mitochondria ko powerhouse kyun…”
        </p>
      </div>

      {/* Chat transcript under the call */}
      <div className="mt-3 flex-1 space-y-2 overflow-hidden">
        <div className="rounded-2xl rounded-tl-md bg-white px-3 py-2 text-[10px] leading-relaxed text-slate-700 shadow-sm ring-1 ring-slate-100">
          Mitochondria ko powerhouse kyun kehte hain?
        </div>
        <div className="rounded-2xl rounded-tr-md bg-brand/10 px-3 py-2 text-[10px] leading-relaxed text-brand">
          Kyunki ATP yahan banta hai — cell ki energy.
        </div>
      </div>

      <p className="mt-auto pt-2 text-center text-[9px] text-slate-400">
        Speak or type · same thread
      </p>
    </div>
  );
}

function ScreenFlp() {
  return (
    <div className="flex h-full flex-col px-3.5 pb-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-brand">FLP · Timed</p>
        <p className="rounded bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-white">
          48:12
        </p>
      </div>
      <p className="mt-4 text-[10px] text-slate-400">Question 24 / 81</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full w-[30%] bg-brand" />
      </div>
      <p className="mt-4 text-[12px] font-medium leading-snug text-slate-800">
        Vitamin K in the large intestine is formed by activity of:
      </p>
      <div className="mt-3 space-y-2">
        {["E. coli", "Obligate bacteria", "Parasites", "Facultative"].map(
          (t, i) => (
            <div
              key={t}
              className={`rounded-xl px-3 py-2 text-[11px] ${
                i === 0
                  ? "bg-brand/10 font-medium text-brand ring-1 ring-brand/25"
                  : "bg-white text-slate-600 ring-1 ring-slate-100"
              }`}
            >
              {["A", "B", "C", "D"][i]}. {t}
            </div>
          )
        )}
      </div>
      <p className="mt-auto text-center text-[9px] text-slate-400">
        Full review after you submit
      </p>
    </div>
  );
}

function UiMcq() {
  return (
    <div className="landing-ui-panel">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
        Chapter · Homeostasis
      </p>
      <p className="mt-2 text-sm font-medium leading-snug text-slate-800">
        Which organelle is the powerhouse of the cell?
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {["Ribosome", "Mitochondria", "Golgi", "Lysosome"].map((t, i) => (
          <div
            key={t}
            className={`rounded-lg px-3 py-2 text-xs ${
              i === 1
                ? "bg-emerald-50 font-medium text-emerald-800 ring-1 ring-emerald-200"
                : "bg-slate-50 text-slate-600"
            }`}
          >
            {["A", "B", "C", "D"][i]}. {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function UiExplain() {
  return (
    <div className="landing-ui-panel">
      <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-600">
        Explanation
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Correct. Mitochondria ATP banati hai — is liye powerhouse kehlati hai.
      </p>
    </div>
  );
}

function UiVoice() {
  return (
    <div className="landing-ui-panel flex items-center justify-between gap-4">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          Ask AI
        </p>
        <p className="mt-1 text-sm font-medium text-slate-800">
          Bol ke poocho — Urdu OK
        </p>
      </div>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold uppercase tracking-wide text-white">
        mic
      </div>
    </div>
  );
}
