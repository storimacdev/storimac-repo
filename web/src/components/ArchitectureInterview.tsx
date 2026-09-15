"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import { downloadText } from "@/lib/download";

type ChatMessage = { role: "user" | "assistant"; content: string };

type UnitSummary = { unitId: string; type: string; status: string };

interface TurnResponse {
  reply: string;
  context: string;
  routing_choice: "A" | "B" | "C" | null;
  active_step_number: number | null;
  unit: UnitSummary | null;
  placementFlag: { flagged: boolean; message: string | null };
  deferredItems: { item: string; defer_to_project: string | null; notes: string }[];
  validationResult: "passed" | "failed" | "not_applicable";
  validationReason: string;
  statusAccepted: boolean | null;
  pendingConflict: { kind: "unit_regression" | "canon_contradiction"; unitId: string } | null;
  cascadeReview: { id: string; description: string }[] | null;
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
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [routingChoice, setRoutingChoice] = useState<"A" | "B" | "C" | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [placementFlag, setPlacementFlag] = useState<{ flagged: boolean; message: string | null } | null>(null);
  const [validationResult, setValidationResult] = useState<"passed" | "failed" | "not_applicable" | null>(null);
  const [validationReason, setValidationReason] = useState<string | null>(null);
  const [statusAccepted, setStatusAccepted] = useState<boolean | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{ kind: string; unitId: string } | null>(null);
  const [cascadeReview, setCascadeReview] = useState<{ id: string; description: string }[] | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<{ markdown: string; outstandingCount: number } | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);

  // Resume/hydration on mount (issue #111, final whole-branch review
  // finding I4/R1) - mirrors WorldInterview.tsx's own resume effect
  // exactly in shape: without this, a page reload always started with
  // empty messages/routingChoice/units even though the server had been
  // remembering everything all along, and setLastProject's server-side
  // half (written by /api/workspaces/.../canvases/[canvasId]'s own
  // setLastVisited call) could never actually be reached, since nothing
  // ever called that route with architectureMessages=1.
  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}?architectureMessages=1`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load this Story Canvas.");
          return;
        }
        const rawMessages = (data.architectureMessages ?? []) as {
          role: "user" | "assistant";
          content: string;
        }[];
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        setRoutingChoice((data.story?.p4?.routing?.routingChoice as "A" | "B" | "C" | undefined) ?? null);
        setUnits((data.story?.p4Units as UnitSummary[] | undefined) ?? []);
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
      setValidationResult(data.validationResult);
      setValidationReason(data.validationReason);
      setStatusAccepted(data.statusAccepted);
      setPendingConflict(data.pendingConflict);
      setCascadeReview(data.cascadeReview);
      const turnUnit = data.unit;
      if (turnUnit) {
        setUnits((prev) => {
          const index = prev.findIndex((u) => u.unitId === turnUnit.unitId);
          if (index === -1) return [...prev, turnUnit];
          return prev.map((u, i) => (i === index ? turnUnit : u));
        });
      }
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
          <span>Units: {units.length}</span>
          {validationResult && <span>Validation: {validationResult}</span>}
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

      {(statusAccepted === false || validationResult === "failed") && validationReason && (
        <div className="border-b border-red-500/30 bg-red-950/30 px-6 py-2 text-xs text-red-200">
          {statusAccepted === false ? "Status change blocked" : "Validation failed"}: {validationReason}
        </div>
      )}

      {pendingConflict && (
        <div className="border-b border-orange-500/30 bg-orange-950/30 px-6 py-2 text-xs text-orange-200">
          Canon Revision Path open for unit &quot;{pendingConflict.unitId}&quot;
          {pendingConflict.kind === "unit_regression" ? " (status regression)" : " (canon contradiction)"} -
          present the three choices and wait for the author&apos;s pick.
        </div>
      )}
      {cascadeReview && cascadeReview.length > 0 && (
        <div className="border-b border-orange-500/30 bg-orange-950/20 px-6 py-2 text-xs text-orange-200">
          <p className="mb-1">Also worth reviewing:</p>
          <ul className="list-disc pl-4">
            {cascadeReview.map((entry) => (
              <li key={entry.id}>
                {entry.id} - {entry.description}
              </li>
            ))}
          </ul>
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
        {resuming && (
          <div className="mb-4 text-left">
            <p className="inline-block max-w-2xl rounded-xl bg-neutral-900 px-4 py-2 text-sm text-neutral-400">
              Loading your canvas…
            </p>
          </div>
        )}
        {!resuming &&
          messages.map((m, i) => (
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
            disabled={loading || resuming}
            placeholder="Message the Screenplay Structural Architect…"
            className="flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
          />
          <button
            onClick={sendMessage}
            disabled={loading || resuming}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-4 py-2 text-sm font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
