"use client";

import { getStudentId, getStudentName } from "@/lib/student";
import { signOut } from "@/lib/auth";
import { prefetchForRoute } from "@/lib/queries";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Layers,
  Timer,
  Puzzle,
  MessageCircle,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Target,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/practice", label: "Chapter practice", icon: Layers },
  { href: "/exam", label: "Full-length", icon: Timer },
  { href: "/custom-quiz", label: "Custom quiz", icon: Puzzle },
  { href: "/chat", label: "Ask Textbook", icon: MessageCircle },
  { href: "/weak-spots", label: "Weak Spots", icon: Target },
  // { href: "/weekly-plan", label: "Weekly Plan", icon: CalendarDays },
] as const;

export default function Navbar({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [name, setName] = useState("Student");
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    setName(getStudentName() || "Student");
  }, []);

  // Prefetch every main tab so switches feel instant
  useEffect(() => {
    for (const { href } of NAV) {
      router.prefetch(href);
    }
  }, [router]);

  // Hovering a tab is a strong signal it's about to be clicked — start its data
  // fetch now so the page has something to render the moment it mounts.
  const warmRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
      prefetchForRoute(queryClient, href, getStudentId());
    },
    [router, queryClient]
  );

  useEffect(() => {
    setOpen(false);
    setAccountOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await signOut();
    queryClient.clear();
    router.replace("/");
  }

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const sidebar = (
    <aside className="flex h-full w-[240px] flex-col border-r border-slate-100 bg-white">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <BrandMark className="h-9 w-9 shrink-0" />
          <div>
            <div className="flex items-baseline gap-2">
              <p className="font-display text-lg font-bold leading-none text-brand">
                uraan
              </p>
              <p className="font-urdu text-sm text-brand">اُڑان</p>
            </div>
            <p className="mt-1.5 text-[10px] font-semibold tracking-wide text-slate-400">
              MDCAT 2026
            </p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active =
            pathname === href ||
            (href !== "/dashboard" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              prefetch
              onMouseEnter={() => warmRoute(href)}
              onFocus={() => warmRoute(href)}
              onTouchStart={() => warmRoute(href)}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "bg-brand-50 text-brand"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${active ? "text-brand" : "text-slate-400"}`}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-100 px-3 py-3">
        <button
          type="button"
          onClick={() => setAccountOpen((v) => !v)}
          aria-expanded={accountOpen}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-slate-50"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
            {initials}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
            {name.split(" ")[0]}
          </p>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-slate-400 transition ${
              accountOpen ? "rotate-180" : ""
            }`}
          />
        </button>
        {accountOpen && (
          <button
            type="button"
            onClick={handleLogout}
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        )}
      </div>
    </aside>
  );

  return (
    <div className="min-h-dvh overflow-x-hidden bg-surface">
      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-100 bg-white/95 px-4 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-50"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/dashboard" className="inline-flex items-center gap-2 font-display text-lg font-bold text-brand">
          <BrandMark className="h-7 w-7" />
          uraan
        </Link>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
          {initials}
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 shadow-xl">
            <div className="relative h-full">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-4 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
              {sidebar}
            </div>
          </div>
        </div>
      )}

      <div className="lg:pl-[240px] min-w-0 overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
