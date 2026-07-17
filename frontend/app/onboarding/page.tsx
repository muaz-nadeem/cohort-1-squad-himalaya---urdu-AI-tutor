"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStudentId } from "@/lib/student";

export default function OnboardingRedirect() {
  const router = useRouter();

  useEffect(() => {
    const id = getStudentId();
    router.replace(id ? "/dashboard" : "/signup");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-slate-400">Redirecting...</p>
    </div>
  );
}
