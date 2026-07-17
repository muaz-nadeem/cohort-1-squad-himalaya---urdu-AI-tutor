"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Send,
  BookOpen,
  FileText,
  ArrowLeft,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { api, type RagSource } from "@/lib/api";
import Navbar from "@/components/Navbar";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: RagSource[];
  citation?: string | null;
  streaming?: boolean;
}

const SUGGESTED_QUESTIONS = [
  "What is the structure of mitochondria?",
  "Explain the process of photosynthesis",
  "What are the phases of mitosis?",
  "How does osmosis differ from diffusion?",
  "Describe the lock and key model of enzymes",
  "What is the role of DNA polymerase?",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bookFilter, setBookFilter] = useState<string | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

      if (!res.ok) {
        throw new Error(await res.text());
      }

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
            // skip malformed JSON
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId ? { ...m, streaming: false } : m
        )
      );
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? {
                ...m,
                content: `Error: ${e instanceof Error ? e.message : "Failed to get answer"}. Make sure the backend is running.`,
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

  return (
    <Navbar>
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-4xl flex-col lg:h-screen">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 font-semibold text-slate-800">
                <Sparkles className="h-4 w-4 text-brand-light" />
                Ask from Textbook
              </h1>
              <p className="text-xs text-slate-400">
                FSc Biology RAG — answers grounded in your textbook with page references
              </p>
            </div>
          </div>

          <select
            value={bookFilter || ""}
            onChange={(e) => setBookFilter(e.target.value || undefined)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-brand"
          >
            <option value="">Both Parts</option>
            <option value="fsc_bio_part1">Part 1</option>
            <option value="fsc_bio_part2">Part 2</option>
          </select>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {messages.length === 0 ? (
            <EmptyState onAsk={handleSend} />
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-3"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask any Biology question..."
              disabled={loading}
              className="!rounded-xl !border-slate-200 !bg-slate-50 !py-3"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition hover:bg-brand-dark disabled:opacity-40"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
          <p className="mt-2 text-center text-xs text-slate-400">
            Answers are generated from FSc Biology textbook passages via RAG. Always verify with your book.
          </p>
        </div>
      </div>
    </Navbar>
  );
}

function EmptyState({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50">
        <BookOpen className="h-8 w-8 text-brand" />
      </div>
      <h2 className="text-lg font-semibold text-slate-800">Ask from your Textbook</h2>
      <p className="mt-1 max-w-sm text-center text-sm text-slate-500">
        Ask any Biology question and get an answer grounded in your FSc textbook, with exact page references.
      </p>

      <div className="mt-8 w-full max-w-lg">
        <p className="mb-3 text-center text-xs font-medium uppercase tracking-wider text-slate-400">
          Try asking
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => onAsk(q)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-600 transition hover:border-brand/30 hover:bg-brand-50"
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-tr-none bg-brand px-4 py-3 text-sm text-white">
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
        <div className="rounded-2xl rounded-tl-none bg-white px-4 py-3 shadow-sm ring-1 ring-slate-100">
          {message.content ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {message.content}
              {message.streaming && (
                <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-brand" />
              )}
            </p>
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
            <div key={i} className="rounded-lg bg-white p-2.5 ring-1 ring-slate-100">
              <div className="mb-1 flex items-center justify-between">
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
                  {src.content_type && src.content_type !== "text" && ` · ${src.content_type}`}
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
