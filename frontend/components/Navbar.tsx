"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronDown, LogOut } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { getStudentName, clearStudent } from "@/lib/student";

export default function Navbar() {
  const router = useRouter();
  const [name, setName] = useState("Student");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(getStudentName() || "Student");
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleLogout() {
    clearStudent();
    router.replace("/");
  }

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white">
              <BookOpen className="h-4 w-4" />
            </div>
            <span className="text-lg font-bold text-brand">uraan</span>
          </Link>
          <span className="hidden rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand sm:inline-block">
            MDCAT 2026
          </span>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
              {initials}
            </div>
            <span className="hidden text-sm font-medium text-slate-700 sm:inline">
              {name.split(" ")[0]}
            </span>
            <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:inline" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 w-48 rounded-xl border border-slate-100 bg-white p-1 shadow-lg">
              <Link
                href="/dashboard"
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Dashboard
              </Link>
              <Link
                href="/practice"
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Chapter practice
              </Link>
              <Link
                href="/exam"
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Full-length
              </Link>
              <Link
                href="/custom-quiz"
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Custom quiz
              </Link>
              <Link
                href="/chat"
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Ask Textbook
              </Link>
              <Link
                href="/weak-spots"
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Weak Spots
              </Link>
              <Link
                href="/weekly-plan"
                className="block rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setMenuOpen(false)}
              >
                Weekly Plan
              </Link>
              <hr className="my-1 border-slate-100" />
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
