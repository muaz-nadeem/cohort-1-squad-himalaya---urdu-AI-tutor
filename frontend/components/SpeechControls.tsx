"use client";

import { useEffect, useState } from "react";
import { Loader2, Pause, Square, Volume2 } from "lucide-react";
import { speechStreamUrl } from "@/lib/api";

let shared: HTMLAudioElement | null = null;
let sharedKey: string | null = null;
const listeners = new Set<() => void>();

function stopShared() {
  if (!shared) return;
  shared.pause();
  shared.src = "";
  shared = null;
  sharedKey = null;
  listeners.forEach((fn) => fn());
}

function notify() {
  listeners.forEach((fn) => fn());
}

/**
 * Manual playback only — never auto-starts. One clip at a time across the app.
 */
export default function SpeechControls({
  url,
  speechId,
  variant = "subtle",
}: {
  url?: string | null;
  speechId?: string | null;
  variant?: "subtle" | "primary";
}) {
  const [resolved, setResolved] = useState(url || "");
  const [state, setState] = useState<"idle" | "playing" | "paused">("idle");
  const [loading, setLoading] = useState(false);
  const key = resolved || speechId || "";

  useEffect(() => {
    if (url) setResolved(url);
    else if (speechId) {
      void speechStreamUrl(speechId).then((u) => {
        if (u) setResolved(u);
      });
    }
  }, [url, speechId]);

  useEffect(() => {
    const sync = () => {
      if (sharedKey !== key) setState("idle");
      else if (shared && !shared.paused && !shared.ended) setState("playing");
      else if (shared && shared.paused && shared.currentTime > 0)
        setState("paused");
      else setState("idle");
    };
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [key]);

  useEffect(() => {
    return () => {
      if (sharedKey === key) stopShared();
    };
  }, [key]);

  if (!resolved && !speechId) return null;

  async function listen() {
    if (!resolved) {
      if (!speechId) return;
      setLoading(true);
      const u = await speechStreamUrl(speechId);
      setLoading(false);
      if (!u) return;
      setResolved(u);
      await start(u);
      return;
    }
    await start(resolved);
  }

  async function start(src: string) {
    if (shared && sharedKey === key && shared.paused && shared.currentTime > 0) {
      await shared.play().catch(() => setState("idle"));
      setState("playing");
      notify();
      return;
    }
    stopShared();
    const audio = new Audio(src);
    shared = audio;
    sharedKey = key;
    audio.onended = () => {
      if (shared === audio) {
        shared = null;
        sharedKey = null;
      }
      setState("idle");
      notify();
    };
    audio.onerror = () => {
      setState("idle");
      notify();
    };
    try {
      await audio.play();
      setState("playing");
      notify();
    } catch {
      setState("idle");
    }
  }

  function pause() {
    if (shared && sharedKey === key) {
      shared.pause();
      setState("paused");
      notify();
    }
  }

  function stop() {
    if (sharedKey === key) stopShared();
    setState("idle");
  }

  const primary =
    "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50";
  const subtle =
    "inline-flex min-h-9 items-center gap-1.5 rounded-full bg-brand-50 px-3.5 py-2 text-xs font-semibold text-brand transition hover:bg-brand-100 disabled:opacity-50";
  const btn = variant === "primary" ? primary : subtle;

  return (
    <div
      className={
        variant === "primary"
          ? "flex flex-wrap items-center gap-1.5"
          : "mt-2 flex flex-wrap items-center gap-1.5"
      }
    >
      {state === "idle" || state === "paused" ? (
        <button
          type="button"
          onClick={() => void listen()}
          disabled={loading}
          className={btn}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Volume2 className="h-3.5 w-3.5" />
          )}
          {state === "paused" ? "Resume" : "Listen"}
        </button>
      ) : (
        <button
          type="button"
          onClick={pause}
          className={btn}
        >
          <Pause className="h-3.5 w-3.5" />
          Pause
        </button>
      )}
      {(state === "playing" || state === "paused") && (
        <button
          type="button"
          onClick={stop}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
        >
          <Square className="h-3 w-3 fill-current" />
          Stop
        </button>
      )}
    </div>
  );
}
