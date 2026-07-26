"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import CanonPanel, { type PanelElement } from "@/components/CanonPanel";

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

export default function ChatInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");
  const debug = searchParams.get("debug") === "1";

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

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-y-auto px-6 py-8">
            {resuming && <Bubble role="assistant" content="Loading your canvas…" pending />}
            {!resuming && messages.length === 0 && <Bubble role="assistant" content={WELCOME} />}
            {messages.map((m, i) => (
              <Bubble key={i} role={m.role} content={m.content} />
            ))}
            {loading && <Bubble role="assistant" content="…" pending />}
            {conflict && !loading && (
              <div
                data-testid="conflict-card"
                className="mb-4 rounded-xl border-2 border-amber-500/60 bg-amber-950/40 px-4 py-4"
              >
                <p className="text-xs font-bold uppercase tracking-widest text-amber-300">
                  ⚠ Canon conflict — your call
                </p>
                <p className="mt-1 text-sm text-amber-100/90">
                  <b>{conflict.element_id.replace(/_/g, " ")}</b> is already confirmed. Pick how to resolve it:
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {CONFLICT_CHOICES.map((c) => (
                    <button
                      key={c.letter}
                      onClick={() => sendMessage(c.message)}
                      disabled={loading}
                      className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/25 disabled:opacity-40"
                    >
                      <span className="mr-1.5 inline-block rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-neutral-900">
                        {c.letter}
                      </span>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {currentStage >= 8 && !loading && (
              <div
                data-testid="document-card"
                className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-4"
              >
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                  Stage 8 — Story Foundation Document
                </p>
                {!doc && (
                  <>
                    <p className="mt-1 text-sm text-emerald-100/80">
                      Your foundation is ready to compile. Only confirmed canon goes in — parked items land in Outstanding Questions.
                    </p>
                    <button
                      onClick={generateDocument}
                      disabled={generating}
                      className="mt-3 rounded-lg bg-emerald-400 px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-emerald-300 disabled:opacity-40"
                    >
                      {generating ? "Compiling…" : "Generate document"}
                    </button>
                  </>
                )}
                {doc && (
                  <>
                    <p className="mt-1 text-sm text-emerald-100/80">
                      v{doc.version} · {doc.date} — {doc.summary_of_changes}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => download(`story-foundation-v${doc.version}.md`, doc.markdown, "text/markdown")}
                        className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-emerald-300"
                      >
                        Download .md
                      </button>
                      <button
                        onClick={() => download(`story-foundation-v${doc.version}.json`, JSON.stringify(doc.json, null, 2), "application/json")}
                        className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-emerald-300"
                      >
                        Download .json
                      </button>
                      <button
                        onClick={generateDocument}
                        disabled={generating}
                        className="rounded-lg border border-emerald-500/50 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-40"
                      >
                        {generating ? "Compiling…" : "Regenerate"}
                      </button>
                    </div>
                    {versions.length > 1 && (
                      <div className="mt-3 text-[11px] text-emerald-100/60">
                        {versions.map((v) => (
                          <div key={v.version}>
                            v{v.version} · {v.date} — {v.summary_of_changes}
                          </div>
                        ))}
                      </div>
                    )}
                    <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-neutral-900/80 p-3 text-[11px] leading-relaxed text-neutral-300">
                      {doc.markdown}
                    </pre>
                  </>
                )}
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
                onClick={() => sendMessage()}
                disabled={loading || resuming || !input.trim()}
                className="rounded-xl bg-amber-400 px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        <CanonPanel elements={elements} currentStage={currentStage} debug={debug} />
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
