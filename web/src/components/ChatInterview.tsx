"use client";

import { useRef, useState } from "react";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const WELCOME =
  "Hi — I'm your Story Development Editor. Tell me about the story you want to build. " +
  "A single sentence is plenty to start; we'll shape it together from there.";

export default function ChatInterview() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setMessages([
        ...nextMessages,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <Link
          href="/"
          className="text-sm text-neutral-400 hover:text-neutral-200"
        >
          ← Back
        </Link>
        <div className="text-sm font-medium tracking-wide text-neutral-300">
          Story Foundation Interview
        </div>
        <div className="w-10" />
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-6 py-8">
        <Bubble role="assistant" content={WELCOME} />
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {loading && <Bubble role="assistant" content="…" pending />}
        {error && (
          <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
        <div ref={listEndRef} />
      </div>

      <div className="border-t border-neutral-800 px-6 py-4">
        <div className="mx-auto flex w-full max-w-2xl items-end gap-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Type your answer… (Enter to send, Shift+Enter for a new line)"
            className="flex-1 resize-none rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  pending,
}: {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`mb-4 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-amber-400 text-neutral-900"
            : "bg-neutral-800 text-neutral-100"
        } ${pending ? "animate-pulse" : ""}`}
      >
        {content}
      </div>
    </div>
  );
}
