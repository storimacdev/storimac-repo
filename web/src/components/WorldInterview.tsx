"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Markdown from "@/components/Markdown";
import UserMenu from "@/components/UserMenu";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const WELCOME =
  "Hi — I'm your World Development Consultant. Let's expand your Story Foundation into a World Bible, one pillar at a time.";

const AMBIENT_GRADIENT =
  "linear-gradient(115deg, #2a0707 0%, #7f1d1d 18%, #dc2626 38%, #ea580c 52%, #7e22ce 76%, #312e81 100%)";
const BORDER_GRADIENT =
  "linear-gradient(135deg, #f87171, #dc2626, #ea580c, #a855f7, #6366f1)";

export default function WorldInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<number | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(380);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}?worldMessages=1`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load this Story Canvas.");
          return;
        }
        const rawMessages = (data.worldMessages ?? []) as {
          role: "user" | "assistant";
          content: string;
          context?: string;
          current_stage?: number;
        }[];
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          setContext(lastAssistant.context ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
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

  // Fires the opening turn (sp03 §10: structural assessment + WCL proposal
  // + first discovery questions) automatically, once, the first time a
  // genuinely new session loads - otherwise the session sits waiting for
  // the author to type something before the model ever speaks.
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId]);

  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/world-chat", {
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
      setContext(data.context ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
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

  function handleResizeStart(e: React.PointerEvent) {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;

    function handlePointerMove(ev: PointerEvent) {
      const next = Math.min(800, Math.max(280, startWidth + (ev.clientX - startX)));
      setLeftWidth(next);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  if (!workspaceId || !canvasId) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: AMBIENT_GRADIENT }}>
        <div className="rounded-2xl p-[1.5px]" style={{ background: BORDER_GRADIENT }}>
          <div className="flex flex-col items-center gap-4 rounded-[14px] bg-neutral-950 px-10 py-12 text-center text-neutral-100">
            <p className="text-lg font-medium">No Story Canvas selected.</p>
            <p className="max-w-sm text-sm text-neutral-400">
              The World Bible needs a Workspace and Story Canvas with a completed Story Foundation. Start from your dashboard.
            </p>
            <Link
              href="/dashboard"
              className="rounded-xl bg-gradient-to-r from-red-600 to-orange-500 px-5 py-3 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh p-2 sm:p-4" style={{ background: AMBIENT_GRADIENT }}>
      <div className="mx-auto h-[calc(100dvh-1rem)] max-w-[1600px] rounded-2xl p-[1.5px] sm:h-[calc(100dvh-2rem)]" style={{ background: BORDER_GRADIENT }}>
        <div className="flex h-full flex-col overflow-hidden rounded-[14px] bg-neutral-950 text-neutral-100">
          <header className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-3">
            <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
              ← Back
            </Link>
            <div className="text-sm font-medium tracking-wide text-neutral-300">
              World Bible{currentStage ? ` · Stage ${currentStage}/5` : ""}
            </div>
            <UserMenu />
          </header>

          <div className="flex min-h-0 flex-1">
            <div
              data-testid="left-panel"
              className="flex shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
              style={{ width: leftWidth }}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
                {!resuming && messages.length === 0 && <Bubble role="assistant" content={WELCOME} />}
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

              <div className="shrink-0 border-t border-red-900/40 p-3">
                <div className="rounded-xl p-[1px]" style={{ background: BORDER_GRADIENT }}>
                  <div className="flex items-end gap-2 rounded-[11px] bg-neutral-900 p-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      rows={2}
                      placeholder="Type your answer… (Enter to send)"
                      className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
                    />
                    <button
                      onClick={() => sendMessage()}
                      disabled={loading || resuming || !input.trim()}
                      className="shrink-0 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-red-500 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div
              data-testid="resize-handle"
              onPointerDown={handleResizeStart}
              className="w-1 shrink-0 cursor-col-resize bg-neutral-800 transition hover:bg-gradient-to-b hover:from-red-500 hover:to-orange-500 active:bg-gradient-to-b active:from-red-500 active:to-orange-500"
            />

            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
              <div className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">preview · World Overview</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing this world…</p>
                  </div>
                )}

                {!loading && !resuming && context && (
                  <div
                    data-testid="notes-card"
                    className="rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
                  >
                    <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                      Notes
                    </p>
                    <div className="mt-3">
                      <Markdown className="text-[13px] leading-relaxed text-neutral-300">{context}</Markdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
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
  const renderMarkdown = !isUser && !pending;
  return (
    <div className={`mb-3 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? "whitespace-pre-wrap bg-gradient-to-r from-red-600 to-orange-600 text-white"
            : "bg-neutral-800 text-neutral-100"
        } ${pending ? "whitespace-pre-wrap animate-pulse" : ""}`}
      >
        {renderMarkdown ? <Markdown className="text-[13px] leading-relaxed text-neutral-100">{content}</Markdown> : content}
      </div>
    </div>
  );
}
