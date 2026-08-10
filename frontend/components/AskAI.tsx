"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Phone, PhoneOff, X, Volume2, Loader2 } from "lucide-react";
import { api, speechStreamUrl, type McqContext } from "@/lib/api";
import { useVoiceCall } from "@/lib/useVoiceCall";

function playAudioUrl(url: string) {
  const audio = new Audio(url);
  audio.play().catch(() => {});
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export default function AskAI({
  concept,
  mcq,
}: {
  concept: string;
  /** The MCQ on screen, so follow-ups stay anchored to this question. */
  mcq?: McqContext;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const mcqRef = useRef<McqContext | undefined>(mcq);

  // Keep the live MCQ available inside the long-running voice call loop
  useEffect(() => {
    mcqRef.current = mcq;
  }, [mcq]);

  // Reset the conversation when the student moves to a different question
  useEffect(() => {
    setTurns([]);
    historyRef.current = [];
  }, [mcq?.question_text]);

  function pushTurn(role: "user" | "assistant", content: string) {
    if (!content) return;
    setTurns((prev) => [...prev, { role, content }]);
    historyRef.current.push({ role, content });
  }

  const handleClip = useCallback(
    async (blob: Blob) => {
      const res = await api.askVoice(blob, concept, mcqRef.current);
      if (res.no_speech) return { audio: null, noSpeech: true };
      if (res.error) {
        setError(res.error);
        return { audio: null };
      }
      setError("");
      if (res.transcript) pushTurn("user", res.transcript);
      if (res.answer) pushTurn("assistant", res.answer);
      const speechUrl = await speechStreamUrl(res.speech_id);
      return { audio: res.audio, speechUrl };
    },
    [concept]
  );

  const call = useVoiceCall({ onClip: handleClip });

  async function askText() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError("");
    const question = text;
    setText("");
    pushTurn("user", question);
    try {
      const res = await api.ask({
        concept,
        student_question: question,
        history: historyRef.current.slice(-6),
        mcq: mcqRef.current,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      pushTurn("assistant", res.answer);
      const speechUrl = await speechStreamUrl(res.speech_id);
      if (speechUrl) playAudioUrl(speechUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to ask");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand/20 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand transition hover:bg-brand-100"
      >
        <Volume2 className="h-4 w-4" /> Ask AI
      </button>
    );
  }

  const statusLabel =
    call.status === "listening"
      ? "Listening… bolna shuru karein"
      : call.status === "processing"
        ? "Samajh raha hoon…"
        : call.status === "speaking"
          ? "Ustaad bol rahe hain…"
          : "Connecting…";

  return (
    <div className="rounded-2xl border border-brand/20 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-semibold text-slate-800">Ask AI</p>
        <button
          onClick={() => {
            abortRef.current?.abort();
            call.endCall();
            setOpen(false);
            setLoading(false);
          }}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {mcq?.question_text && (
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
              {t.role === "user" && <span className="font-medium">You: </span>}
              {t.content}
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
            Sawal poochein — jawab Urdu mein sunaya jayega. Call chalti rahegi.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && askText()}
              placeholder="Type your question..."
              disabled={loading}
              className="!py-2.5 !text-sm"
            />
            <button
              onClick={askText}
              disabled={loading || !text.trim()}
              className="rounded-xl bg-brand px-4 text-white transition hover:bg-brand-dark disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>

          <button
            onClick={call.startCall}
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            <Phone className="h-4 w-4" /> Start voice call (Urdu)
          </button>
        </>
      )}
    </div>
  );
}
