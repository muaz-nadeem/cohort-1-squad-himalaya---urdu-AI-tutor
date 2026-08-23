"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Phone, PhoneOff, X, Volume2, Loader2 } from "lucide-react";
import { api, speechStreamUrl, type McqContext } from "@/lib/api";
import { useVoiceCall } from "@/lib/useVoiceCall";
import type { DoctorPersona } from "@/lib/doctorPersona";
import DoctorAvatar from "@/components/DoctorAvatar";
import SpeechControls from "@/components/SpeechControls";

interface Turn {
  role: "user" | "assistant";
  content: string;
  speechUrl?: string | null;
}

export default function AskAI({
  concept,
  mcq,
  doctor,
  embedded = false,
  onClose,
}: {
  concept: string;
  /** The MCQ on screen, so follow-ups stay anchored to this question. */
  mcq?: McqContext;
  /** Persistent Pakistani doctor persona for this student. */
  doctor: DoctorPersona;
  /** Render chat+call inside a parent card (no launcher, no extra outer card). */
  embedded?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(embedded);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const reqSeqRef = useRef(0);
  const mcqRef = useRef<McqContext | undefined>(mcq);

  useEffect(() => {
    mcqRef.current = mcq;
  }, [mcq]);

  useEffect(() => {
    setTurns([]);
    historyRef.current = [];
  }, [mcq?.question_text]);

  function pushTurn(
    role: "user" | "assistant",
    content: string,
    speechUrl?: string | null
  ) {
    if (!content) return;
    setTurns((prev) => [...prev, { role, content, speechUrl }]);
    historyRef.current.push({ role, content });
  }

  const handleClip = useCallback(
    async (blob: Blob, signal: AbortSignal) => {
      const seq = ++reqSeqRef.current;
      try {
        const res = await api.askVoice(
          blob,
          concept,
          mcqRef.current,
          historyRef.current.slice(-6),
          signal
        );
        if (signal.aborted || seq !== reqSeqRef.current) return { audio: null };
        if (res.no_speech) return { audio: null, noSpeech: true };
        if (res.error) {
          setError(res.error);
          return { audio: null };
        }
        setError("");
        if (res.transcript) pushTurn("user", res.transcript);
        const speechUrl = await speechStreamUrl(res.speech_id);
        if (signal.aborted || seq !== reqSeqRef.current) return { audio: null };
        if (res.answer) pushTurn("assistant", res.answer, speechUrl);
        return { audio: res.audio, speechUrl };
      } catch (e) {
        if (
          signal.aborted ||
          seq !== reqSeqRef.current ||
          (e as Error)?.name === "AbortError"
        ) {
          return { audio: null };
        }
        throw e;
      }
    },
    [concept]
  );

  const call = useVoiceCall({ onClip: handleClip });

  async function askText() {
    const question = text.trim();
    if (!question) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const seq = ++reqSeqRef.current;

    setLoading(true);
    setError("");
    setText("");
    pushTurn("user", question);
    try {
      const res = await api.ask(
        {
          concept,
          student_question: question,
          history: historyRef.current.slice(-6),
          mcq: mcqRef.current,
        },
        ac.signal
      );
      if (ac.signal.aborted || seq !== reqSeqRef.current) return;
      if (res.error) {
        setError(res.error);
        return;
      }
      const speechUrl = await speechStreamUrl(res.speech_id);
      if (ac.signal.aborted || seq !== reqSeqRef.current) return;
      pushTurn("assistant", res.answer, speechUrl);
    } catch (e) {
      if (ac.signal.aborted || seq !== reqSeqRef.current) return;
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to ask");
    } finally {
      if (seq === reqSeqRef.current) setLoading(false);
    }
  }

  if (!open) {
    if (embedded) return null;
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-brand/20 bg-brand-50 px-4 py-3 text-left transition hover:bg-brand-100"
      >
        <DoctorAvatar doctor={doctor} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-brand">
            Ask {doctor.displayName}
          </span>
          <span className="block text-[11px] text-slate-500">
            Your MDCAT Biology tutor
          </span>
        </span>
        <Volume2 className="h-4 w-4 shrink-0 text-brand" />
      </button>
    );
  }

  const statusLabel =
    call.status === "listening"
      ? "Listening… bolna shuru karein"
      : call.status === "processing"
        ? "Samajh raha hoon…"
        : call.status === "speaking"
          ? `${doctor.displayName} bol rahe hain…`
          : "Connecting…";

  return (
    <div
      className={
        embedded
          ? "border-t border-slate-100 bg-slate-50/90 p-4"
          : "rounded-2xl border border-brand/20 bg-white p-5 shadow-sm"
      }
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <DoctorAvatar doctor={doctor} />
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">
              {doctor.displayName}
            </p>
            <p className="text-[11px] text-slate-400">MDCAT Biology tutor</p>
          </div>
        </div>
        <button
          onClick={() => {
            abortRef.current?.abort();
            reqSeqRef.current += 1;
            call.endCall();
            setOpen(false);
            setLoading(false);
            onClose?.();
          }}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600"
          aria-label="Close Ask AI"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {mcq?.question_text && !embedded && (
        <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold tracking-wider text-slate-400">
            DISCUSSING THIS QUESTION
          </p>
          <p className="mt-1 line-clamp-2 text-xs text-slate-600">
            {mcq.question_text}
          </p>
        </div>
      )}

      {turns.length > 0 && (
        <div className="mb-3 max-h-64 space-y-2 overflow-y-auto">
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === "user"
                  ? "rounded-lg bg-slate-50 p-3 text-sm text-slate-500"
                  : "whitespace-pre-line rounded-lg bg-brand-50 p-3 text-sm text-slate-700"
              }
            >
              {t.role === "user" ? (
                <span className="font-medium">You: </span>
              ) : (
                <span className="font-medium">{doctor.name}: </span>
              )}
              {t.content}
              {t.role === "assistant" && t.speechUrl && (
                <SpeechControls url={t.speechUrl} />
              )}
            </div>
          ))}
        </div>
      )}

      {(error || call.error) && (
        <p className="mb-3 text-sm text-red-500">{error || call.error}</p>
      )}

      {call.inCall ? (
        <div className="rounded-xl border-2 border-brand/30 bg-brand-50 p-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-brand" />
            </span>
            <span className="flex-1 text-sm font-semibold text-brand-700">
              {statusLabel}
            </span>
            {call.status === "processing" && (
              <Loader2 className="h-4 w-4 animate-spin text-brand" />
            )}
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-100"
              style={{
                width: `${Math.min(100, Math.round(call.level * 600))}%`,
              }}
            />
          </div>

          <button
            onClick={call.endCall}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600"
          >
            <PhoneOff className="h-4 w-4" /> End call
          </button>
          <p className="mt-2 text-center text-[11px] text-slate-500">
            Naya sawal poochein — pehla jawab rok kar latest ka jawab milega.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askText()}
              placeholder={`Ask ${doctor.displayName}...`}
              className="!py-2.5 min-w-0"
            />
            <button
              onClick={askText}
              disabled={!text.trim()}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl bg-brand px-4 text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>

          <button
            onClick={() => {
              abortRef.current?.abort();
              reqSeqRef.current += 1;
              setLoading(false);
              call.startCall();
            }}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark"
          >
            <Phone className="h-4 w-4" /> Call {doctor.displayName} (Urdu)
          </button>
        </>
      )}
    </div>
  );
}
