"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { completeAuthFromUrl } from "@/lib/auth";

/**
 * Landing page for Supabase email-confirmation (and recovery) links.
 *
 * The client reads `?code=` / hash tokens from the URL, stores the session,
 * then sends the student on. Must stay a client page so we don't strip the
 * hash before supabase-js can see it.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Confirming your email…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const error =
      params.get("error_description") ||
      params.get("error") ||
      hash.get("error_description") ||
      hash.get("error");
    if (error) {
      setStatus("That confirmation link didn't work.");
      router.replace(
        `/login?error=${encodeURIComponent(error.replace(/\+/g, " "))}`
      );
      return;
    }

    void completeAuthFromUrl()
      .then((id) => {
        if (id) {
          router.replace("/dashboard");
          return;
        }
        router.replace("/login?confirmed=1");
      })
      .catch((e) => {
        const msg =
          e instanceof Error ? e.message : "Could not confirm this email.";
        router.replace(`/login?error=${encodeURIComponent(msg)}`);
      });
  }, [router]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F7F9FC]">
      <p className="text-sm text-slate-500">{status}</p>
    </div>
  );
}
