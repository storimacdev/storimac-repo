"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type PendingConflict = {
  element_id: string;
  old_value: unknown;
  new_value: unknown;
};

const WELCOME =
  "Hi — I'm your Story Development Editor. Tell me about the story you want to build. " +
  "A single sentence is plenty to start; we'll shape it together from there.";

export default function ChatInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [stageName, setStageName] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load this Story Canvas.");
          return;
        }
        setMessages(
          (data.messages as { role: "user" | "assistant"; content: string }[]).map((m) => ({
            role: m.role,
            content: m.content,
          }))
        );
        if (data.story?.currentStage) {
          setStageName(`Stage ${data.story.currentStage}`);
        }
        if (data.story?.pendingConflict) {
          setConflict(data.story.pendingConflict);
        }
      } catch {
        if (!cancelled) setError("Couldn't reach the server. Is the dev server running?");
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, canvasId]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      if (data.currentStageName) setStageName(data.currentStageName);
      setConflict(data.conflict ?? null);
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

  if (!workspaceId || !canvasId) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center text-neutral-100">
        <p className="text-lg font-medium">No Story Canvas selected.</p>
        <p className="max-w-sm text-sm text-neutral-400">
          The interview needs a Workspace and Story Canvas to save your progress to. Start from onboarding to create one.
        </p>
        <Link
          href="/onboarding"
          className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-neutral-900 hover:bg-amber-300"
        >
          Go to onboarding
        </Link>
      </div>
    );
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
          Story Foundation Interview{stageName ? ` · ${stageName}` : ""}
        </div>
        <div className="w-10" />
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-6 py-8">
        {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
        {!resuming && messages.length === 0 && <Bubble role="assistant" content={WELCOME} />}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {loading && <Bubble role="assistant" content="…" pending />}
        {conflict && (
          <div className="mb-4 rounded-lg border border-amber-800 bg-amber-950/60 px-4 py-3 text-sm text-amber-200">
            Waiting on your choice for the conflict on <b>{conflict.element_id}</b> above.
          </div>
        )}
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
            disabled={loading || resuming || !input.trim()}
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
