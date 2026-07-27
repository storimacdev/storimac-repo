"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CanonPanel, { type PanelElement } from "@/components/CanonPanel";
import UserMenu from "@/components/UserMenu";
import { useUser } from "@/components/UserProvider";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type PendingConflict = {
  element_id: string;
  old_value: unknown;
  new_value: unknown;
};

type GeneratedDoc = {
  version: number;
  date: string;
  summary_of_changes: string;
  markdown: string;
  json: unknown;
};

type VersionRow = { version: number; date: string; summary_of_changes: string };

const WELCOME =
  "Hi — I'm your Story Development Editor. Tell me about the story you want to build. " +
  "A single sentence is plenty to start; we'll shape it together from there.";

// The three Conflict Resolution choices (issue #10/#11). Clicking a button
// sends the choice through the normal chat flow — the model is already
// primed (via the injected conflict context) to read the pick and set
// `resolution` in its structured output.
const CONFLICT_CHOICES: { letter: string; label: string; message: string }[] = [
  { letter: "A", label: "Keep Canon", message: "A — Keep the canon as it is." },
  { letter: "B", label: "Accept & Update", message: "B — Accept the new idea and update the canon." },
  { letter: "C", label: "Park It", message: "C — Park this for later." },
];

// Mood-based deep-red gradient frame (per design reference): ambient
// backdrop + a thin gradient border wrapping the whole app window.
const AMBIENT_GRADIENT =
  "linear-gradient(115deg, #2a0707 0%, #7f1d1d 18%, #dc2626 38%, #ea580c 52%, #7e22ce 76%, #312e81 100%)";
const BORDER_GRADIENT =
  "linear-gradient(135deg, #f87171, #dc2626, #ea580c, #a855f7, #6366f1)";

export default function ChatInterview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");
  const debug = searchParams.get("debug") === "1";
  const { state: userState } = useUser();

  // Bare /interview: route signed-in users to their last canvas (issue #90)
  // instead of the dead-end empty state (which stays for guests).
  useEffect(() => {
    if (workspaceId && canvasId) return;
    if (userState.status === "authed" && userState.lastWorkspaceId && userState.lastCanvasId) {
      router.replace(
        `/interview?workspaceId=${userState.lastWorkspaceId}&canvasId=${userState.lastCanvasId}`
      );
    }
  }, [workspaceId, canvasId, userState, router]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [stageName, setStageName] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState(1);
  const [elements, setElements] = useState<PanelElement[]>([]);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [leftTab, setLeftTab] = useState<"chat" | "canon">("chat");
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
          setCurrentStage(data.story.currentStage);
          setStageName(`Stage ${data.story.currentStage}`);
        }
        if (Array.isArray(data.elements)) setElements(data.elements);
        if (data.story?.pendingConflict) setConflict(data.story.pendingConflict);
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

  async function sendMessage(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || loading || !canvasId) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    if (!preset) setInput("");
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

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
        ...(data.auditSummary ? [{ role: "assistant" as const, content: data.auditSummary }] : []),
      ]);
      if (data.currentStageName) setStageName(data.currentStageName);
      if (typeof data.currentStage === "number") setCurrentStage(data.currentStage);
      if (Array.isArray(data.elements)) setElements(data.elements);
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

  async function generateDocument() {
    if (!workspaceId || !canvasId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}/document`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Document generation failed.");
        return;
      }
      setDoc(data);
      const listRes = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}/document`);
      const listData = await listRes.json();
      if (listRes.ok && Array.isArray(listData.versions)) setVersions(listData.versions);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setGenerating(false);
    }
  }

  function download(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!workspaceId || !canvasId) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: AMBIENT_GRADIENT }}>
        <div className="rounded-2xl p-[1.5px]" style={{ background: BORDER_GRADIENT }}>
          <div className="flex flex-col items-center gap-4 rounded-[14px] bg-neutral-950 px-10 py-12 text-center text-neutral-100">
            <p className="text-lg font-medium">No Story Canvas selected.</p>
            <p className="max-w-sm text-sm text-neutral-400">
              The interview needs a Workspace and Story Canvas to save your progress to. Start from onboarding to create one.
            </p>
            <Link
              href="/onboarding"
              className="rounded-xl bg-gradient-to-r from-red-600 to-orange-500 px-5 py-3 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400"
            >
              Go to onboarding
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant") ?? null;

  return (
    <div className="min-h-dvh p-2 sm:p-4" style={{ background: AMBIENT_GRADIENT }}>
      <div className="mx-auto h-[calc(100dvh-1rem)] max-w-[1600px] rounded-2xl p-[1.5px] sm:h-[calc(100dvh-2rem)]" style={{ background: BORDER_GRADIENT }}>
        <div className="flex h-full flex-col overflow-hidden rounded-[14px] bg-neutral-950 text-neutral-100">
          <header className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-3">
            <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
              ← Back
            </Link>
            <div className="text-sm font-medium tracking-wide text-neutral-300">
              Story Foundation Interview{stageName ? ` · ${stageName}` : ""}
            </div>
            <UserMenu />
          </header>

          <div className="flex min-h-0 flex-1">
            {/* ---------- Left panel: chat / canon tabs + input ---------- */}
            <div
              data-testid="left-panel"
              className="flex w-[380px] shrink-0 flex-col border-r border-red-900/40 bg-neutral-900/40"
            >
              <div className="flex shrink-0 gap-1 border-b border-red-900/40 p-2">
                <button
                  onClick={() => setLeftTab("chat")}
                  data-active={leftTab === "chat"}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    leftTab === "chat"
                      ? "bg-gradient-to-r from-red-600/80 to-orange-600/60 text-white"
                      : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  }`}
                >
                  Chat
                </button>
                <button
                  onClick={() => setLeftTab("canon")}
                  data-active={leftTab === "canon"}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    leftTab === "canon"
                      ? "bg-gradient-to-r from-red-600/80 to-orange-600/60 text-white"
                      : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
                  }`}
                >
                  Story Canon
                </button>
              </div>

              {leftTab === "chat" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                  {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
                  {!resuming && messages.length === 0 && <Bubble role="assistant" content={WELCOME} />}
                  {messages.map((m, i) => (
                    <Bubble key={i} role={m.role} content={m.content} />
                  ))}
                  {loading && <Bubble role="assistant" content="…" pending />}
                  {conflict && !loading && (
                    <div
                      data-testid="conflict-card"
                      className="mb-4 rounded-xl border-2 border-red-500/60 bg-red-950/40 px-4 py-4"
                    >
                      <p className="text-xs font-bold uppercase tracking-widest text-red-300">
                        ⚠ Canon conflict — your call
                      </p>
                      <p className="mt-1 text-sm text-red-100/90">
                        <b>{conflict.element_id.replace(/_/g, " ")}</b> is already confirmed. Pick how to resolve it:
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {CONFLICT_CHOICES.map((c) => (
                          <button
                            key={c.letter}
                            onClick={() => sendMessage(c.message)}
                            disabled={loading}
                            className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/25 disabled:opacity-40"
                          >
                            <span className="mr-1.5 inline-block rounded bg-gradient-to-r from-red-500 to-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              {c.letter}
                            </span>
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {error && (
                    <div className="mt-2 rounded-lg border border-red-900 bg-red-950/60 px-4 py-3 text-sm text-red-200">
                      {error}
                    </div>
                  )}
                  <div ref={listEndRef} />
                </div>
              ) : (
                <div className="min-h-0 flex-1">
                  <CanonPanel elements={elements} currentStage={currentStage} debug={debug} />
                </div>
              )}

              <div className="shrink-0 border-t border-red-900/40 p-3">
                <div className="rounded-xl p-[1px]" style={{ background: BORDER_GRADIENT }}>
                  <div className="flex items-end gap-2 rounded-[11px] bg-neutral-900 p-2">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      rows={2}
                      placeholder="Type your answer… (Enter to send)"
                      className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none"
                    />
                    <button
                      onClick={() => sendMessage()}
                      disabled={loading || resuming || !input.trim()}
                      className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:from-red-500 hover:to-orange-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ---------- Right panel: response generation / preview ---------- */}
            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
              <div className="shrink-0 border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">
                  preview · {stageName ?? "Stage 1"}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                {currentStage >= 8 && !loading && (
                  <div
                    data-testid="document-card"
                    className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
                  >
                    <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                      Stage 8 — Story Foundation Document
                    </p>
                    {!doc && (
                      <>
                        <p className="mt-1 text-sm text-neutral-300">
                          Your foundation is ready to compile. Only confirmed canon goes in — parked items land in Outstanding Questions.
                        </p>
                        <button
                          onClick={generateDocument}
                          disabled={generating}
                          className="mt-3 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-xs font-semibold text-white transition hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                        >
                          {generating ? "Compiling…" : "Generate document"}
                        </button>
                      </>
                    )}
                    {doc && (
                      <>
                        <p className="mt-1 text-sm text-neutral-300">
                          v{doc.version} · {doc.date} — {doc.summary_of_changes}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => download(`story-foundation-v${doc.version}.md`, doc.markdown, "text/markdown")}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                          >
                            Download .md
                          </button>
                          <button
                            onClick={() => download(`story-foundation-v${doc.version}.json`, JSON.stringify(doc.json, null, 2), "application/json")}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                          >
                            Download .json
                          </button>
                          <button
                            onClick={generateDocument}
                            disabled={generating}
                            className="rounded-lg border border-red-500/50 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-40"
                          >
                            {generating ? "Compiling…" : "Regenerate"}
                          </button>
                        </div>
                        {versions.length > 1 && (
                          <div className="mt-3 text-[11px] text-neutral-500">
                            {versions.map((v) => (
                              <div key={v.version}>
                                v{v.version} · {v.date} — {v.summary_of_changes}
                              </div>
                            ))}
                          </div>
                        )}
                        <pre className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-neutral-900/80 p-4 text-[12px] leading-relaxed text-neutral-300">
                          {doc.markdown}
                        </pre>
                      </>
                    )}
                  </div>
                )}

                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing your story…</p>
                  </div>
                )}

                {!loading && !doc && lastAssistant && (
                  <div data-testid="latest-response" className="mx-auto max-w-3xl">
                    <p className="mb-3 text-[11px] uppercase tracking-widest text-neutral-500">Latest from your editor</p>
                    <div className="whitespace-pre-wrap rounded-xl border border-neutral-800 bg-neutral-900/50 px-6 py-5 text-[15px] leading-relaxed text-neutral-200">
                      {lastAssistant.content}
                    </div>
                  </div>
                )}

                {!loading && !doc && !lastAssistant && !resuming && (
                  <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600/30 via-orange-500/20 to-purple-600/30">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M12 21s-7-4.5-9.5-9C.9 8.5 2.5 5 6 5c2.2 0 3.5 1.2 4 2 .5-.8 1.8-2 4-2 3.5 0 5.1 3.5 3.5 7-2.5 4.5-9.5 9-9.5 9z"
                          stroke="url(#g)"
                          strokeWidth="1.5"
                          strokeLinejoin="round"
                        />
                        <defs>
                          <linearGradient id="g" x1="0" y1="0" x2="24" y2="24">
                            <stop stopColor="#f87171" />
                            <stop offset="1" stopColor="#a855f7" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                    <p className="text-sm text-neutral-500">Your editor&apos;s responses will appear here…</p>
                    <div className="space-y-2 text-left text-xs text-neutral-500">
                      <p>💬 &nbsp;Answer in the chat on the left</p>
                      <p>📖 &nbsp;Responses, audits, and canon updates render here</p>
                      <p>📄 &nbsp;Stage 8 compiles your Story Foundation Document here</p>
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
  return (
    <div className={`mb-3 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? "bg-gradient-to-r from-red-600 to-orange-600 text-white"
            : "bg-neutral-800 text-neutral-100"
        } ${pending ? "animate-pulse" : ""}`}
      >
        {content}
      </div>
    </div>
  );
}
