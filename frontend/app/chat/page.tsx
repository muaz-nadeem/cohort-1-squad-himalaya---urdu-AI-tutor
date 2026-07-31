"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStudentId } from "@/lib/student";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Phone,
  PhoneOff,
  Send,
  Sparkles,
  Volume2,
} from "lucide-react";
import { api, speechStreamUrl, type RagSource } from "@/lib/api";
import { useVoiceCall } from "@/lib/useVoiceCall";
import Navbar from "@/components/Navbar";

function playAudioUrl(url: string) {
  const audio = new Audio(url);
  audio.play().catch(() => {});
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: RagSource[];
  citation?: string | null;
  streaming?: boolean;
  speechUrl?: string | null;
}

const SUGGESTED_QUESTIONS = [
  "Explain the Krebs cycle in simple terms.",
  "Where is the structure of the heart mentioned?",
  "What are the phases of mitosis?",
  "How does osmosis differ from diffusion?",
  "Compare DNA vs RNA from the textbook.",
  "Describe the lock and key model of enzymes.",
];

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bookFilter, setBookFilter] = useState<string | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bookFilterRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!getStudentId()) router.replace("/");
  }, [router]);

  useEffect(() => {
    bookFilterRef.current = bookFilter;
  }, [bookFilter]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const searchLabel =
    bookFilter === "fsc_bio_part1"
      ? "BIOLOGY · PART 1"
      : bookFilter === "fsc_bio_part2"
        ? "BIOLOGY · PART 2"
        : "BIOLOGY · BOTH PARTS";

  async function handleSend(question?: string) {
    const q = (question || input).trim();
    if (!q || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
    };

    const botId = crypto.randomUUID();
    const botMsg: Message = {
      id: botId,
      role: "assistant",
      content: "",
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, botMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await api.ragAskStream({
        question: q,
        book: bookFilter,
        top_k: 3,
      });

      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;

          try {
            const event = JSON.parse(payload);
            if (event.type === "sources") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? { ...m, sources: event.sources, citation: event.citation }
                    : m
                )
              );
            } else if (event.type === "text") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? { ...m, content: m.content + event.content }
                    : m
                )
              );
            }
          } catch {
            /* skip */
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === botId ? { ...m, streaming: false } : m))
      );
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? {
                ...m,
                content: `Error: ${
                  e instanceof Error ? e.message : "Failed to get answer"
                }. Make sure the backend is running.`,
                streaming: false,
              }
            : m
        )
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const handleClip = useCallback(async (blob: Blob) => {
    const botId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: botId, role: "assistant", content: "", streaming: true },
    ]);

    try {
      const res = await api.ragAskVoice(blob, bookFilterRef.current, 3);

      // Silence / unclear audio — drop the placeholder and keep listening
      if (res.no_speech) {
        setMessages((prev) => prev.filter((m) => m.id !== botId));
        return { audio: null, noSpeech: true };
      }

      if (res.error) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: res.error!, streaming: false } : m
          )
        );
        return { audio: null };
      }

      if (res.transcript) {
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: res.transcript,
        };
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === botId);
          if (idx === -1) return [...prev, userMsg];
          const updated = [...prev];
          updated.splice(idx, 0, userMsg);
          return updated;
        });
      }

      const sources = (res.sources || []).map((s) => ({
        ...s,
        similarity: s.similarity ?? 0,
        snippet: s.snippet ?? "",
      }));

      const speechUrl = speechStreamUrl(res.speech_id);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? {
                ...m,
                content: res.answer || "No answer received.",
                sources,
                citation: res.citation,
                speechUrl,
                streaming: false,
              }
            : m
        )
      );

      return { audio: res.audio, speechUrl };
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? {
                ...m,
                content: `Error: ${e instanceof Error ? e.message : "Voice request failed"}`,
                streaming: false,
              }
            : m
        )
      );
      return { audio: null };
    }
  }, []);

  const call = useVoiceCall({ onClip: handleClip });

  const callStatusLabel =
    call.status === "listening"
      ? "Listening… ask your question"
      : call.status === "processing"
        ? "Searching the textbook…"
        : call.status === "speaking"
          ? "Answering in Urdu…"
          : "Connecting…";

  return (
    <Navbar>
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-5xl flex-col bg-[#F4F7FB] lg:h-screen">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="font-display text-lg font-bold text-brand-700">
              Ask Textbook
            </h1>
          </div>

          <div className="inline-flex rounded-full bg-slate-100 p-1">
            {(
              [
                [undefined, "Both"],
                ["fsc_bio_part1", "Part 1"],
                ["fsc_bio_part2", "Part 2"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setBookFilter(id)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  bookFilter === id
                    ? "bg-brand text-white"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {messages.length === 0 ? (
            <EmptyState onAsk={handleSend} />
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-slate-200/80 bg-white px-4 py-4 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <p className="mb-2 text-center text-[10px] font-bold tracking-wider text-slate-400">
              SEARCHING: {searchLabel}
            </p>
            {call.inCall ? (
              <div className="rounded-2xl border-2 border-brand/30 bg-brand-50 px-4 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-brand" />
                  </span>
                  <span className="flex-1 text-sm font-semibold text-brand-700">
                    {callStatusLabel}
                  </span>
                  {call.status === "processing" && (
                    <Loader2 className="h-4 w-4 animate-spin text-brand" />
                  )}
                  <button
                    type="button"
                    onClick={call.endCall}
                    className="flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-red-600"
                  >
                    <PhoneOff className="h-3.5 w-3.5" /> End call
                  </button>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-100"
                    style={{ width: `${Math.min(100, Math.round(call.level * 600))}%` }}
                  />
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 shadow-sm"
              >
                <button
                  type="button"
                  onClick={call.startCall}
                  disabled={loading}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-brand-50 hover:text-brand disabled:opacity-40"
                  title="Start voice call (Urdu)"
                >
                  <Phone className="h-4 w-4" />
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about MDCAT syllabus..."
                  disabled={loading}
                  className="!border-0 !bg-transparent !px-0 !py-2 !shadow-none !ring-0 focus:!ring-0"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-dark disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </form>
            )}
            {call.error && (
              <p className="mt-2 text-center text-xs text-red-500">{call.error}</p>
            )}
            <p className="mt-3 text-center text-xs text-slate-400">
              AI-generated · verify with textbook for final MDCAT preparation.
            </p>
          </div>
        </div>
      </div>
    </Navbar>
  );
}

function EmptyState({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-sm">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="font-display text-2xl font-bold text-brand-700 sm:text-3xl">
        How can I help with your studies?
      </h2>
      <p className="mt-3 max-w-lg text-center text-sm leading-relaxed text-slate-500">
        Ask questions directly from your FSc Biology textbooks. I can find
        specific pages and explain complex concepts.
      </p>

      <div className="mt-8 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left text-sm text-slate-600 shadow-sm transition hover:border-brand/30 hover:bg-brand-50"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-brand px-4 py-3 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50">
        <BookOpen className="h-4 w-4 text-brand" />
      </div>
      <div className="max-w-[85%] space-y-2">
        <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
          {message.content ? (
            <div>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {message.content}
                {message.streaming && (
                  <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-brand" />
                )}
              </p>
              {!message.streaming && message.speechUrl && (
                <button
                  type="button"
                  onClick={() => playAudioUrl(message.speechUrl!)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand-100"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  Play audio
                </button>
              )}
            </div>
          ) : message.streaming ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching textbook...
            </div>
          ) : null}
        </div>

        {message.sources && message.sources.length > 0 && (
          <SourcesPanel sources={message.sources} citation={message.citation} />
        )}
      </div>
    </div>
  );
}

function SourcesPanel({
  sources,
  citation,
}: {
  sources: RagSource[];
  citation?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 text-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-slate-500 hover:text-slate-700"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {sources.length} source{sources.length !== 1 ? "s" : ""} found
          {citation && <span className="text-slate-400">· {citation}</span>}
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-slate-100 px-3 py-2">
          {sources.map((src, i) => (
            <div
              key={i}
              className="rounded-lg bg-white p-2.5 ring-1 ring-slate-100"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700">
                  {src.book_label || src.book || "FSc Biology"}
                  {src.page_number != null && ` · p. ${src.page_number}`}
                </span>
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand">
                  {(src.similarity * 100).toFixed(0)}% match
                </span>
              </div>
              {src.chapter && (
                <p className="text-slate-400">
                  {src.chapter}
                  {src.concept && ` · ${src.concept}`}
                </p>
              )}
              {src.snippet && (
                <p className="mt-1 line-clamp-3 text-slate-500">{src.snippet}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
