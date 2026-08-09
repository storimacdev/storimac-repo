"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import CanonPanel, { type PanelElement, type GuardrailFlag } from "@/components/CanonPanel";
import Markdown from "@/components/Markdown";
import StorySoFar from "@/components/StorySoFar";
import UserMenu from "@/components/UserMenu";
import { useUser } from "@/components/UserProvider";
import { downloadText, downloadBlob } from "@/lib/download";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";

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
  json: FoundationDocument;
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
  const [guardrailFlags, setGuardrailFlags] = useState<GuardrailFlag[]>([]);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [auditSummary, setAuditSummary] = useState<string | null>(null);
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [leftWidth, setLeftWidth] = useState(380);
  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [notesKey, setNotesKey] = useState<string | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  // Each new turn's notes start expanded - collapsing is a per-turn choice,
  // not a sticky "never show notes again" setting. Adjusting state during
  // render (React's documented pattern for "reset state when a value
  // changes") rather than in an effect, which would cascade an extra render.
  const currentNotesKey = auditSummary ?? context ?? null;
  if (currentNotesKey !== notesKey) {
    setNotesKey(currentNotesKey);
    setNotesCollapsed(false);
  }

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
        const rawMessages = data.messages as {
          role: "user" | "assistant";
          content: string;
          context?: string;
        }[];
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastWithContext = [...rawMessages].reverse().find((m) => m.role === "assistant" && m.context);
        if (lastWithContext) setContext(lastWithContext.context ?? null);
        if (data.story?.currentStage) {
          setCurrentStage(data.story.currentStage);
          setStageName(`Stage ${data.story.currentStage}`);
        }
        if (Array.isArray(data.elements)) setElements(data.elements);
        if (Array.isArray(data.guardrailFlags)) setGuardrailFlags(data.guardrailFlags);
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

      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setAuditSummary(data.auditSummary ?? null);
      if (data.currentStageName) setStageName(data.currentStageName);
      if (typeof data.currentStage === "number") setCurrentStage(data.currentStage);
      if (Array.isArray(data.elements)) setElements(data.elements);
      if (data.guardrailFlag) setGuardrailFlags((prev) => [...prev, data.guardrailFlag]);
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

  async function downloadPdf() {
    if (!doc || pdfGenerating) return;
    setPdfGenerating(true);
    setError(null);
    try {
      const { generateFoundationPdfBlob } = await import("@/lib/pdf/FoundationPdfDocument");
      const blob = await generateFoundationPdfBlob(doc.json);
      downloadBlob(`story-foundation-v${doc.version}.pdf`, blob);
    } catch {
      setError("Couldn't generate the PDF.");
    } finally {
      setPdfGenerating(false);
    }
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
                {doc && !loading && (
                  <div
                    data-testid="next-steps-card"
                    className="mb-4 rounded-xl border-2 border-red-500/40 bg-red-950/30 px-4 py-4"
                  >
                    <p className="text-xs font-bold uppercase tracking-widest text-red-300">
                      Story Foundation ready
                    </p>
                    <p className="mt-1 text-sm text-red-100/90">
                      Your Story Foundation Document is generated. Ready to move on?
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href={`/character-bible?workspaceId=${workspaceId}&canvasId=${canvasId}`}
                        className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white transition hover:from-red-500 hover:to-orange-400"
                      >
                        Continue to Character Development →
                      </Link>
                      <Link
                        href="/dashboard"
                        className="rounded-lg border border-red-500/50 px-3 py-2 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
                      >
                        Back to Dashboard
                      </Link>
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

            {/* ---------- Drag handle: resize left panel ---------- */}
            <div
              data-testid="resize-handle"
              onPointerDown={handleResizeStart}
              className="w-1 shrink-0 cursor-col-resize bg-neutral-800 transition hover:bg-gradient-to-b hover:from-red-500 hover:to-orange-500 active:bg-gradient-to-b active:from-red-500 active:to-orange-500"
            />

            {/* ---------- Right panel: response generation / preview ---------- */}
            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
              <div className="shrink-0 border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">
                  preview · {stageName ?? "Stage 1"}
                </span>
              </div>
              <div className="shrink-0 border-b border-red-900/40 bg-neutral-900/40 px-3">
                <CanonPanel
                  elements={elements}
                  currentStage={currentStage}
                  debug={debug}
                  guardrailFlags={guardrailFlags}
                  orientation="horizontal"
                />
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
                            onClick={() => downloadText(`story-foundation-v${doc.version}.md`, doc.markdown, "text/markdown")}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                          >
                            Download .md
                          </button>
                          <button
                            onClick={() => downloadText(`story-foundation-v${doc.version}.json`, JSON.stringify(doc.json, null, 2), "application/json")}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                          >
                            Download .json
                          </button>
                          <button
                            onClick={downloadPdf}
                            disabled={pdfGenerating}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                          >
                            {pdfGenerating ? "Generating…" : "Download .pdf"}
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
                        <div className="mt-4 max-h-[50vh] overflow-y-auto rounded-lg bg-neutral-900/80 p-4">
                          <Markdown className="text-[13px] leading-relaxed text-neutral-300">{doc.markdown}</Markdown>
                        </div>
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

                {!loading && !doc && !resuming && (
                  <>
                    {(auditSummary || context) &&
                      (notesCollapsed ? (
                        <button
                          data-testid="notes-card-collapsed"
                          onClick={() => setNotesCollapsed(false)}
                          className="mb-6 flex items-center gap-2 rounded-full border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-4 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950/60"
                        >
                          <span>{auditSummary ? "Creative Audit" : "Notes"}</span>
                          <span aria-hidden>▸</span>
                        </button>
                      ) : (
                        <div
                          data-testid="notes-card"
                          className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                              {auditSummary ? "Creative Audit" : "Notes"}
                            </p>
                            <button
                              onClick={() => setNotesCollapsed(true)}
                              aria-label="Collapse notes"
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-sm leading-none text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
                            >
                              ×
                            </button>
                          </div>
                          <div className="mt-3">
                            <Markdown className="text-[13px] leading-relaxed text-neutral-300">
                              {auditSummary ?? context ?? ""}
                            </Markdown>
                          </div>
                        </div>
                      ))}
                    <StorySoFar elements={elements} currentStage={currentStage} />
                  </>
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
