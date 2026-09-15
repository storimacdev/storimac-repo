"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import { downloadText } from "@/lib/download";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface TurnResponse {
  reply: string;
  context: string;
  routing_choice: "A" | "B" | "C" | null;
  active_step_number: number | null;
  unit: { unitId: string; type: string; status: string } | null;
  placementFlag: { flagged: boolean; message: string | null };
  deferredItems: { item: string; defer_to_project: string | null; notes: string }[];
}

export default function ArchitectureInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");
  const { setLastProject } = useUser();

  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    setLastProject("story-architecture");
  }, [workspaceId, canvasId, setLastProject]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routingChoice, setRoutingChoice] = useState<"A" | "B" | "C" | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [placementFlag, setPlacementFlag] = useState<{ flagged: boolean; message: string | null } | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<{ markdown: string; outstandingCount: number } | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  async function sendMessage() {
    if (!canvasId || !input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/architecture-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, message: text }),
      });
      const data: TurnResponse & { error?: string } = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't reach the server.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setRoutingChoice(data.routing_choice);
      setActiveStep(data.active_step_number);
      setPlacementFlag(data.placementFlag.flagged ? data.placementFlag : null);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  async function compileDocument() {
    if (!canvasId || compiling) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const res = await fetch("/api/architecture-chat/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompileError(data.error ?? "Compile failed.");
        return;
      }
      setCompiled(data);
    } catch {
      setCompileError("Couldn't reach the server.");
    } finally {
      setCompiling(false);
    }
  }

  if (!workspaceId || !canvasId) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4 bg-neutral-950 text-neutral-100">
        <p className="text-sm text-neutral-400">
          No Story Canvas selected. Start from onboarding to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <p className="text-sm font-semibold text-neutral-200">Story Architecture</p>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>Routing: {routingChoice ?? "not chosen yet"}</span>
          <span>Active Step: {activeStep ?? "—"}</span>
          <button
            onClick={compileDocument}
            disabled={compiling}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compiling ? "Compiling…" : "Compile"}
          </button>
        </div>
      </div>

      {placementFlag?.message && (
        <div className="border-b border-amber-500/30 bg-amber-950/30 px-6 py-2 text-xs text-amber-200">
          {placementFlag.message}
        </div>
      )}

      {compiled && (
        <div className="border-b border-purple-500/30 bg-purple-950/20 px-6 py-3 text-xs text-purple-200">
          <p className="mb-2">
            Compiled — {compiled.outstandingCount} outstanding item{compiled.outstandingCount === 1 ? "" : "s"}.
          </p>
          <button
            onClick={() => downloadText("screenplay-architecture.md", compiled.markdown, "text/markdown")}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
          >
            Download .md
          </button>
        </div>
      )}
      {compileError && <p className="border-b border-red-500/30 px-6 py-2 text-xs text-red-400">{compileError}</p>}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.map((m, i) => (
          <div key={i} className={`mb-4 ${m.role === "user" ? "text-right" : "text-left"}`}>
            <p className="inline-block max-w-2xl rounded-xl bg-neutral-900 px-4 py-2 text-sm text-neutral-200">
              {m.content}
            </p>
          </div>
        ))}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <div className="border-t border-neutral-800 px-6 py-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            disabled={loading}
            placeholder="Message the Screenplay Structural Architect…"
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-4 py-2 text-sm font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
