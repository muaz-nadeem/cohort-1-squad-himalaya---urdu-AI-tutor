"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStudentId } from "@/lib/student";
import { getDoctorPersona, type DoctorPersona } from "@/lib/doctorPersona";
import DoctorAvatar from "@/components/DoctorAvatar";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Menu,
  MessageSquarePlus,
  MoreVertical,
  Pencil,
  Phone,
  PhoneOff,
  Send,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import {
  api,
  speechStreamUrl,
  type RagSource,
  type TextbookChatSummary,
} from "@/lib/api";
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

function historyPayload(messages: Message[]) {
  return messages
    .filter((m) => !m.streaming && m.content.trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));
}

export default function ChatPage() {
  const router = useRouter();
  const doctor = useMemo(() => getDoctorPersona(getStudentId()), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [bookFilter, setBookFilter] = useState<string | undefined>(undefined);
  const [chats, setChats] = useState<TextbookChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bookFilterRef = useRef<string | undefined>(undefined);
  const messagesRef = useRef<Message[]>([]);
  const activeChatIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!getStudentId()) router.replace("/");
  }, [router]);

  useEffect(() => {
    bookFilterRef.current = bookFilter;
  }, [bookFilter]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeChatId]);

  const refreshChats = useCallback(async () => {
    try {
      const res = await api.listTextbookChats();
      setChats(res.chats || []);
      setHistoryError("");
    } catch (e) {
      setHistoryError(
        e instanceof Error
          ? e.message
          : "Chat history unavailable. Run Supabase migration 003."
      );
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useEffect(() => {
    void refreshChats();
  }, [refreshChats]);

  async function ensureChatId(): Promise<string | null> {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    try {
      const chat = await api.createTextbookChat({
        book_filter: bookFilterRef.current,
      });
      setActiveChatId(chat.id);
      activeChatIdRef.current = chat.id;
      setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)]);
      return chat.id;
    } catch (e) {
      setHistoryError(
        e instanceof Error ? e.message : "Could not create chat"
      );
      return null;
    }
  }

  async function persistTurn(
    chatId: string,
    userContent: string,
    assistant: {
      content: string;
      sources?: RagSource[];
      citation?: string | null;
    },
    isFirst: boolean
  ) {
    try {
      const res = await api.appendTextbookChatMessages(chatId, {
        messages: [
          { role: "user", content: userContent },
          {
            role: "assistant",
            content: assistant.content,
            sources: assistant.sources || [],
            citation: assistant.citation,
          },
        ],
        title: isFirst ? userContent : undefined,
      });
      if (res.chat) {
        setChats((prev) => {
          const rest = prev.filter((c) => c.id !== res.chat.id);
          return [res.chat, ...rest];
        });
      }
    } catch (e) {
      console.error("Failed to save chat turn", e);
    }
  }

  async function startNewChat() {
    if (loading || loadingChat) return;
    setMessages([]);
    setActiveChatId(null);
    activeChatIdRef.current = null;
    setSidebarOpen(false);
    try {
      const chat = await api.createTextbookChat({ book_filter: bookFilter });
      setActiveChatId(chat.id);
      activeChatIdRef.current = chat.id;
      setChats((prev) => [chat, ...prev.filter((c) => c.id !== chat.id)]);
    } catch (e) {
      setHistoryError(
        e instanceof Error ? e.message : "Could not start a new chat"
      );
    }
    inputRef.current?.focus();
  }

  async function openChat(chatId: string) {
    if (chatId === activeChatId && messages.length > 0) {
      setSidebarOpen(false);
      return;
    }
    setLoadingChat(true);
    setSidebarOpen(false);
    try {
      const detail = await api.getTextbookChat(chatId);
      setActiveChatId(detail.id);
      activeChatIdRef.current = detail.id;
      if (detail.book_filter) setBookFilter(detail.book_filter);
      else setBookFilter(undefined);
      setMessages(
        (detail.messages || []).map((m) => ({
          id: m.id,
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
          sources: (m.sources || undefined) as RagSource[] | undefined,
          citation: m.citation,
        }))
      );
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Could not load chat");
    } finally {
      setLoadingChat(false);
    }
  }

  async function removeChat(chatId: string) {
    try {
      await api.deleteTextbookChat(chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        activeChatIdRef.current = null;
        setMessages([]);
      }
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Could not delete chat");
    }
  }

  async function renameChat(chatId: string, title: string) {
    const cleaned = title.trim();
    if (!cleaned) return;
    try {
      const updated = await api.renameTextbookChat(chatId, cleaned);
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, ...updated } : c))
      );
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Could not rename chat");
    }
  }

  const searchLabel =
    bookFilter === "fsc_bio_part1"
      ? "BIOLOGY · PART 1"
      : bookFilter === "fsc_bio_part2"
        ? "BIOLOGY · PART 2"
        : "BIOLOGY · BOTH PARTS";

  async function handleSend(question?: string) {
    const q = (question || input).trim();
    if (!q || loading) return;

    const prior = historyPayload(messagesRef.current);
    const isFirst = messagesRef.current.length === 0;

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

    const chatId = await ensureChatId();

    try {
      const res = await api.ragAskStream({
        question: q,
        book: bookFilter,
        top_k: 3,
        history: prior,
      });

      if (!res.ok) throw new Error(await res.text());

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";
      let finalSources: RagSource[] = [];
      let finalCitation: string | null = null;

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
              finalSources = event.sources || [];
              finalCitation = event.citation || null;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === botId
                    ? { ...m, sources: finalSources, citation: finalCitation }
                    : m
                )
              );
            } else if (event.type === "text") {
              fullText += event.content;
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

      if (!fullText.trim()) {
        fullText =
          "I found textbook pages but the AI did not return an answer. This is often a Groq rate limit — wait a few seconds and ask again.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === botId ? { ...m, content: fullText, streaming: false } : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) => (m.id === botId ? { ...m, streaming: false } : m))
        );
      }

      if (chatId && fullText.trim()) {
        await persistTurn(
          chatId,
          q,
          {
            content: fullText.trim(),
            sources: finalSources,
            citation: finalCitation,
          },
          isFirst
        );
      }
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
    const prior = historyPayload(messagesRef.current);
    const isFirst = messagesRef.current.length === 0;
    setMessages((prev) => [
      ...prev,
      { id: botId, role: "assistant", content: "", streaming: true },
    ]);

    try {
      const chatId = await ensureChatId();
      const res = await api.ragAskVoice(blob, bookFilterRef.current, 3);

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

      let userContent = res.transcript || "";
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

      const speechUrl = await speechStreamUrl(res.speech_id);
      const answer = res.answer || "No answer received.";

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botId
            ? {
                ...m,
                content: answer,
                sources,
                citation: res.citation,
                speechUrl: speechUrl || undefined,
                streaming: false,
              }
            : m
        )
      );

      if (chatId && userContent && answer) {
        await persistTurn(
          chatId,
          userContent,
          { content: answer, sources, citation: res.citation },
          isFirst
        );
      }

      // history currently unused by voice endpoint; kept for future wiring
      void prior;

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

  const activeTitle =
    chats.find((c) => c.id === activeChatId)?.title || "New chat";

  return (
    <Navbar>
      <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-6xl bg-[#F4F7FB] lg:h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white md:flex">
          <div className="border-b border-slate-100 p-3">
            <button
              type="button"
              onClick={startNewChat}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
            >
              <MessageSquarePlus className="h-4 w-4" />
              New chat
            </button>
          </div>
          <ChatList
            chats={chats}
            activeChatId={activeChatId}
            loading={loadingChats}
            onOpen={openChat}
            onDelete={removeChat}
            onRename={renameChat}
          />
        </aside>

        {/* Mobile drawer */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40"
              aria-label="Close history"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="absolute inset-y-0 left-0 flex w-[min(20rem,88vw)] flex-col bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-3">
                <p className="text-sm font-semibold text-slate-700">Chats</p>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="border-b border-slate-100 p-3">
                <button
                  type="button"
                  onClick={startNewChat}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  New chat
                </button>
              </div>
              <ChatList
                chats={chats}
                activeChatId={activeChatId}
                loading={loadingChats}
                onOpen={openChat}
                onDelete={removeChat}
                onRename={renameChat}
              />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600 md:hidden"
                aria-label="Open chat history"
              >
                <Menu className="h-5 w-5" />
              </button>
              <Link
                href="/dashboard"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div className="min-w-0">
                <h1 className="font-display text-lg font-bold text-brand-700">
                  Ask Textbook
                </h1>
                <p className="truncate text-xs text-slate-400">{activeTitle}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startNewChat}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 md:hidden"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                New
              </button>
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
          </div>

          {historyError && (
            <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800 sm:px-6">
              {historyError}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            {loadingChat ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading conversation…
              </div>
            ) : messages.length === 0 ? (
              <EmptyState doctor={doctor} onAsk={handleSend} />
            ) : (
              <div className="mx-auto max-w-3xl space-y-4">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} doctor={doctor} message={msg} />
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
                      style={{
                        width: `${Math.min(100, Math.round(call.level * 600))}%`,
                      }}
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
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about MDCAT syllabus..."
                    disabled={loading}
                    className="min-w-0 flex-1 !border-0 !bg-transparent !px-3 !py-2 !shadow-none !ring-0 focus:!ring-0"
                  />
                  <button
                    type="button"
                    onClick={call.startCall}
                    disabled={loading}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand transition hover:bg-brand hover:text-white disabled:opacity-40"
                    title="Ask by voice (Urdu)"
                    aria-label="Ask by voice"
                  >
                    <Phone className="h-5 w-5" />
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white transition hover:bg-brand-dark disabled:opacity-40"
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Send className="h-5 w-5" />
                    )}
                  </button>
                </form>
              )}
              {call.error && (
                <p className="mt-2 text-center text-xs text-red-500">
                  {call.error}
                </p>
              )}
              <p className="mt-3 text-center text-xs text-slate-400">
                AI-generated · verify with textbook for final MDCAT preparation.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Navbar>
  );
}

function ChatList({
  chats,
  activeChatId,
  loading,
  onOpen,
  onDelete,
  onRename,
}: {
  chats: TextbookChatSummary[];
  activeChatId: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (!menuId) return;
    function onDocClick() {
      setMenuId(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [menuId]);

  function startRename(chat: TextbookChatSummary) {
    setMenuId(null);
    setRenamingId(chat.id);
    setRenameValue(chat.title || "New chat");
  }

  function submitRename(chatId: string) {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!next) return;
    onRename(chatId, next);
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      {loading ? (
        <p className="px-2 py-4 text-xs text-slate-400">Loading chats…</p>
      ) : chats.length === 0 ? (
        <p className="px-2 py-4 text-xs leading-relaxed text-slate-400">
          Your conversations will appear here so you can revise later.
        </p>
      ) : (
        <ul className="space-y-1">
          {chats.map((chat) => {
            const active = chat.id === activeChatId;
            const openMenu = menuId === chat.id;
            const renaming = renamingId === chat.id;
            return (
              <li key={chat.id} className="relative">
                {renaming ? (
                  <form
                    className="rounded-xl bg-brand-50 px-2 py-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      submitRename(chat.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => submitRename(chat.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="w-full rounded-lg border border-brand/30 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand/20"
                    />
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => onOpen(chat.id)}
                      className={`w-full rounded-xl px-3 py-2.5 pr-10 text-left text-sm transition ${
                        active
                          ? "bg-brand-50 font-semibold text-brand-700"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <span className="line-clamp-2">
                        {chat.title || "New chat"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuId(openMenu ? null : chat.id);
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                      title="Chat options"
                      aria-label="Chat options"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {openMenu && (
                      <div
                        className="absolute right-1 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => startRename(chat)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMenuId(null);
                            onDelete(chat.id);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({
  doctor,
  onAsk,
}: {
  doctor: DoctorPersona;
  onAsk: (q: string) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center">
      <DoctorAvatar doctor={doctor} size="lg" />
      <p className="mt-3 text-sm font-semibold text-brand">{doctor.displayName}</p>
      <h2 className="mt-2 font-display text-2xl font-bold text-brand-700 sm:text-3xl">
        How can I help with your studies?
      </h2>
      <p className="mt-3 max-w-lg text-center text-sm leading-relaxed text-slate-500">
        Ask questions directly from your FSc Biology textbooks. Conversations
        are saved so you can come back and revise.
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

function MessageBubble({
  message,
  doctor,
}: {
  message: Message;
  doctor: DoctorPersona;
}) {
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
      <DoctorAvatar doctor={doctor} size="sm" />
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
          ) : (
            <p className="text-sm text-slate-400">No answer received. Please ask again.</p>
          )}
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
