"use client";

import { useRef, useState } from "react";
import { Send, Mic, Square, X, Volume2, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

function playBase64Audio(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play().catch(() => {});
}

export default function AskAI({ concept }: { concept: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  async function askText() {
    if (!text.trim()) return;
    setLoading(true);
    setError("");
    setTranscript("");
    abortRef.current = new AbortController();
    const timeout = setTimeout(() => abortRef.current?.abort(), 60000);
    try {
      const res = await api.ask({
        concept,
        student_question: text,
        history: historyRef.current,
      });
      handleResponse(text, res.answer, res.audio);
      setText("");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setError("Request timed out. Try again.");
      } else {
        setError(e instanceof Error ? e.message : "Failed to ask");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function startRecording() {
    setError("");
    setAnswer("");
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await sendVoice(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Microphone access denied.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function sendVoice(blob: Blob) {
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 60000);

      const form = new FormData();
      form.append("audio", blob, "question.webm");
      form.append("concept", concept);
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const resp = await fetch(`${API_URL}/api/ask-voice`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        setError(`Server error: ${resp.status}`);
        return;
      }
      const res = await resp.json();
      if (res.error) {
        setError(res.error);
        return;
      }
      setTranscript(res.transcript || "");
      handleResponse(res.transcript || "", res.answer || "", res.audio);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") {
        setError("Voice processing timed out. Try a shorter question or use text.");
      } else {
        setError(e instanceof Error ? e.message : "Voice request failed");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleResponse(question: string, ans: string, audio: string | null) {
    setAnswer(ans);
    if (question) historyRef.current.push({ role: "user", content: question });
    if (ans) historyRef.current.push({ role: "assistant", content: ans });
    if (audio) playBase64Audio(audio);
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

  return (
    <div className="rounded-2xl border border-brand/20 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="font-semibold text-slate-800">Ask AI</p>
        <button
          onClick={() => {
            abortRef.current?.abort();
            setOpen(false);
            setLoading(false);
          }}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {transcript && (
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
          <span className="font-medium">Heard:</span> {transcript}
        </div>
      )}

      {answer && (
        <div className="mb-3 whitespace-pre-line rounded-lg bg-brand-50 p-3 text-sm text-slate-700">
          {answer}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      {loading && (
        <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {recording ? "Recording..." : "Processing your question..."}
        </div>
      )}

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
          <Send className="h-4 w-4" />
        </button>
      </div>

      <button
        onClick={recording ? stopRecording : startRecording}
        disabled={loading && !recording}
        className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
          recording
            ? "animate-pulse bg-red-500 text-white"
            : loading
              ? "bg-slate-100 text-slate-400"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        {recording ? (
          <>
            <Square className="h-4 w-4" /> Stop & send
          </>
        ) : loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Processing...
          </>
        ) : (
          <>
            <Mic className="h-4 w-4" /> Tap to speak (Urdu)
          </>
        )}
      </button>
    </div>
  );
}
