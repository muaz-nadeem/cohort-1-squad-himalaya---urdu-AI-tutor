"use client";

import { getStudentName } from "@/lib/student";
import { signOut } from "@/lib/auth";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
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
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/practice", label: "Chapter practice", icon: Layers },
  { href: "/exam", label: "Full-length", icon: Timer },
  { href: "/custom-quiz", label: "Custom quiz", icon: Puzzle },
  { href: "/chat", label: "Ask Textbook", icon: MessageCircle },
  // { href: "/weak-spots", label: "Weak Spots", icon: Target },
  // { href: "/weekly-plan", label: "Weekly Plan", icon: CalendarDays },
] as const;

export default function Navbar({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState("Student");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setName(getStudentName() || "Student");
  }, []);

  // Prefetch every main tab so switches feel instant
  useEffect(() => {
    for (const { href } of NAV) {
      router.prefetch(href);
    }
  }, [router]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await signOut();
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
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
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
        <div className="mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
            {initials}
          </div>
          <p className="truncate text-sm font-medium text-slate-700">
            {name.split(" ")[0]}
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-surface">
      {/* Desktop sidebar */}
      <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-100 bg-white/95 px-4 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-50"
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
                className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
              {sidebar}
            </div>
          </div>
        </div>
      )}

      <div className="lg:pl-[240px]">
        {children}
      </div>
    </div>
  );
}
