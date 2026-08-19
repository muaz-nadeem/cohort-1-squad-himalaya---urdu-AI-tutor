"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { syncStudentCacheFromSession } from "./auth";
import { getStudentId, getStudentName } from "./student";

type Options = {
  /** Where to send a visitor with no session. */
  redirectTo?: string;
};

/**
 * Resolve the signed-in student without blocking the first paint.
 *
 * The cached id in localStorage is read synchronously on mount so data queries
 * can fire on the very next tick; Supabase is only consulted in the background
 * to confirm, and a redirect happens solely once it says there is no session.
 * Awaiting that round-trip before rendering used to add a visible stall to
 * every tab switch.
 */
export function useStudentId({ redirectTo = "/login" }: Options = {}) {
  const router = useRouter();
  const [studentId, setStudentId] = useState<string | null>(null);

  useEffect(() => {
    const cached = getStudentId();
    if (cached) setStudentId(cached);

    void syncStudentCacheFromSession().then((verified) => {
      if (verified) {
        setStudentId(verified);
        return;
      }
      router.replace(redirectTo);
    });
  }, [router, redirectTo]);

  return studentId;
}

/** Display name from the local cache, hydration-safe. */
export function useStudentName(fallback = "Student") {
  const [name, setName] = useState(fallback);
  useEffect(() => {
    setName(getStudentName() || fallback);
  }, [fallback]);
  return name;
}
