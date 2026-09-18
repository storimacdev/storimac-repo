"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import { downloadText } from "@/lib/download";

type ChatMessage = { role: "user" | "assistant"; content: string };

type UnitSummary = { unitId: string; type: string; status: string };

type SceneDensity = { count: number; projectedTotal: number | null; alert: "under" | "over" | null };

type ThematicAnchorFinding = { id: string; status: "pass" | "flag"; detail: string };
type ThematicAnchorAudit = { findings: ThematicAnchorFinding[]; gapFound: boolean };
type PreCompilationAudit = { findings: ThematicAnchorFinding[]; failed: boolean };

type StructuralVectorOption = {
  content: string;
  pacing_impact: string;
  downstream_requirements: string;
  thematic_impact: string;
};
type StructuralVectorOptions = { unit_id: string; options: StructuralVectorOption[] };

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
  sceneDensity: SceneDensity;
  structuralVectorOptions: StructuralVectorOptions | null;
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
  const [sceneDensity, setSceneDensity] = useState<SceneDensity | null>(null);
  const [structuralVectorOptions, setStructuralVectorOptions] = useState<StructuralVectorOptions | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<{ markdown: string; outstandingCount: number } | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [thematicAnchorAudit, setThematicAnchorAudit] = useState<ThematicAnchorAudit | null>(null);
  const [compileNeedsAcknowledgment, setCompileNeedsAcknowledgment] = useState(false);
  const [preCompilationAudit, setPreCompilationAudit] = useState<PreCompilationAudit | null>(null);

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
        // Final whole-branch review finding M4 - the canvas GET route
        // already spreads the whole story into its response, so this
        // was already on the wire and simply never read: without it, a
        // page reload while a Canon Revision Path conflict is open
        // silently dropped the banner even though the conflict was
        // still genuinely blocking the conversation server-side.
        setPendingConflict(
          (data.story?.p4PendingConflict as { kind: "unit_regression" | "canon_contradiction"; unitId: string } | null | undefined) ?? null
        );
        // Task 3's canvas GET route computes this fresh from the
        // persisted units/dismissal state every resume, so a page
        // reload shows the current reading without waiting for the
        // next chat turn - top-level on the response, a sibling of
        // `story`, not nested under it (matching guardrailFlags/
        // characterBibleGate's own shape).
        setSceneDensity((data.sceneDensity as SceneDensity | undefined) ?? null);
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
      setSceneDensity(data.sceneDensity);
      setStructuralVectorOptions(data.structuralVectorOptions);
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

  async function dismissSceneDensityAlert(direction: "under" | "over") {
    if (!canvasId) return;
    try {
      const res = await fetch("/api/architecture-chat/scene-density", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, direction }),
      });
      const data = await res.json();
      if (res.ok) {
        setSceneDensity(data.sceneDensity);
      } else {
        // Final whole-branch review finding: a non-network failure (e.g.
        // an expired session) previously left the Dismiss button
        // silently doing nothing - surface it the same way sendMessage
        // already does for its own fetch.
        setError(data.error ?? "Couldn't dismiss the pacing alert.");
      }
    } catch {
      // Best-effort - on a network failure the banner simply stays
      // visible until the next successful chat turn recomputes it,
      // same tolerance every other fetch in this component already has.
    }
  }

  async function compileDocument(acknowledged: boolean) {
    if (!canvasId || compiling) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const res = await fetch("/api/architecture-chat/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, acknowledged }),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsAcknowledgment) {
        setThematicAnchorAudit(data.thematicAnchorAudit);
        setPreCompilationAudit(data.preCompilationAudit);
        setCompileNeedsAcknowledgment(true);
        setCompiled(null);
        return;
      }
      if (!res.ok) {
        setCompileError(data.error ?? "Compile failed.");
        setCompiled(null);
        setThematicAnchorAudit(null);
        setPreCompilationAudit(null);
        setCompileNeedsAcknowledgment(false);
        return;
      }
      setThematicAnchorAudit(data.thematicAnchorAudit);
      setPreCompilationAudit(data.preCompilationAudit);
      setCompileNeedsAcknowledgment(false);
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
            onClick={() => compileDocument(false)}
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
      {structuralVectorOptions && structuralVectorOptions.options.length > 0 && (
        <div className="border-b border-teal-500/30 bg-teal-950/20 px-6 py-3 text-xs text-teal-200">
          <p className="mb-2 font-semibold">
            Structural options for unit &quot;{structuralVectorOptions.unit_id}&quot;:
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {structuralVectorOptions.options.map((option, i) => (
              <div key={i} className="rounded-lg border border-teal-500/30 bg-neutral-900 p-3">
                <p className="mb-1 font-semibold text-teal-100">Option {i + 1}</p>
                <p className="mb-2 text-teal-100">{option.content}</p>
                <p className="mb-1">
                  <span className="font-semibold">Pacing:</span> {option.pacing_impact}
                </p>
                <p className="mb-1">
                  <span className="font-semibold">Downstream:</span> {option.downstream_requirements}
                </p>
                <p>
                  <span className="font-semibold">Thematic:</span> {option.thematic_impact}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      {sceneDensity?.alert && (
        <div className="flex items-center justify-between gap-4 border-b border-sky-500/30 bg-sky-950/20 px-6 py-2 text-xs text-sky-200">
          <span>
            Pacing note: {sceneDensity.count} scene{sceneDensity.count === 1 ? "" : "s"} so far,
            projecting to about {sceneDensity.projectedTotal ?? "?"} total -{" "}
            {sceneDensity.alert === "under"
              ? "below the 75-150 scene target. Consider whether an escalation beat or extra sub-sequence is missing."
              : "above the 75-150 scene target. Consider whether any scenes could be merged or streamlined."}
          </span>
          <button
            onClick={() => {
              if (sceneDensity?.alert) dismissSceneDensityAlert(sceneDensity.alert);
            }}
            className="shrink-0 rounded-lg border border-sky-500/50 bg-neutral-900 px-2 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-900/40"
          >
            Dismiss
          </button>
        </div>
      )}

      {compileNeedsAcknowledgment && (thematicAnchorAudit || preCompilationAudit) && (
        <div className="border-b border-rose-500/30 bg-rose-950/30 px-6 py-3 text-xs text-rose-200">
          <p className="mb-2 font-semibold">These checks flagged issues before compiling:</p>
          <ul className="mb-2 list-disc pl-4">
            {[
              ...(thematicAnchorAudit?.findings ?? []).map((f) => ({ ...f, key: `thematic-${f.id}` })),
              ...(preCompilationAudit?.findings ?? []).map((f) => ({ ...f, key: `precompile-${f.id}` })),
            ]
              .filter((f) => f.status === "flag")
              .map((f) => (
                <li key={f.key}>{f.detail}</li>
              ))}
          </ul>
          <p className="mb-2 text-rose-300">
            Only Confirmed scenes are compiled - the pacing note elsewhere on this page (if shown) projects your
            Working + Confirmed total, which is a different, non-blocking estimate.
          </p>
          <button
            onClick={() => compileDocument(true)}
            disabled={compiling}
            className="rounded-lg border border-rose-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Compile anyway
          </button>
        </div>
      )}

      {compiled && (
        <div className="border-b border-purple-500/30 bg-purple-950/20 px-6 py-3 text-xs text-purple-200">
          <p className="mb-2">
            Compiled — {compiled.outstandingCount} outstanding item{compiled.outstandingCount === 1 ? "" : "s"}.
            {(thematicAnchorAudit || preCompilationAudit) &&
              (thematicAnchorAudit?.gapFound || preCompilationAudit?.failed
                ? " Pre-compile audits: overridden with issue(s) acknowledged."
                : " Pre-compile audits: passed.")}
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
