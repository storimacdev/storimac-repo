"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import { downloadText, downloadBlob } from "@/lib/download";
import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";
import type { P4CascadeReviewEntry } from "@/lib/storyArchitectureEngine/canonRevision";
import Link from "next/link";
import UserMenu from "@/components/UserMenu";
import { useScrollToLatest } from "@/lib/useScrollToLatest";
import ArchitectureLedgerPanel from "@/components/ArchitectureLedgerPanel";

type ChatMessage = { role: "user" | "assistant"; content: string };

// Issue #151: the server response's `unit` field already returns the
// full StructuralUnit object (causalTag included) - UnitSummary just
// never carried it through to the UI. Surfacing it is the only way an
// author could currently see that a Step-1-exempt Confirmed unit is
// still causalTag "UNVALIDATED" without running a full compile.
type UnitSummary = { unitId: string; type: string; status: string; causalTag?: "Therefore" | "But" | "UNVALIDATED" };

type SceneDensity = { count: number; projectedTotal: number | null; alert: "under" | "over" | null };

// Issue #173 - strictly advisory, mirrors SceneDensity's own shape but
// with no dismissal state: a dangling setup is normal mid-development
// state, re-shown every turn/resume rather than acknowledged once.
type SetupPayoffAdvisory = { danglingSetups: string[]; orphanedPayoffs: string[] };

type ThematicAnchorFinding = { id: string; status: "pass" | "flag"; detail: string };
type ThematicAnchorAudit = { findings: ThematicAnchorFinding[]; gapFound: boolean };
type PreCompilationAudit = { findings: ThematicAnchorFinding[]; failed: boolean };

// Issue #71 - the partial-compile draft route's response shape.
type DraftCompiled = {
  draftId: string;
  scopeKey: string;
  scope: { type: "act"; act_id: string };
  draftVersion: number;
  date: string;
  markdown: string;
  outstandingCount: number;
};

const DRAFT_ACTS: { id: "1" | "2A" | "2B" | "3"; label: string }[] = [
  { id: "1", label: "Act 1 - THE THESIS" },
  { id: "2A", label: "Act 2A - THE INVERSION" },
  { id: "2B", label: "Act 2B - THE DESCENT" },
  { id: "3", label: "Act 3 - THE SYNTHESIS" },
];

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
  cascadeReview: P4CascadeReviewEntry[] | null;
  sceneDensity: SceneDensity;
  setupPayoffAdvisory: SetupPayoffAdvisory;
  structuralVectorOptions: StructuralVectorOptions | null;
}

export default function ArchitectureInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");
  const { setLastProject } = useUser();
  const { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest } = useScrollToLatest();

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
  const [cascadeReview, setCascadeReview] = useState<P4CascadeReviewEntry[] | null>(null);
  const [sceneDensity, setSceneDensity] = useState<SceneDensity | null>(null);
  const [setupPayoffAdvisory, setSetupPayoffAdvisory] = useState<SetupPayoffAdvisory | null>(null);
  const [structuralVectorOptions, setStructuralVectorOptions] = useState<StructuralVectorOptions | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiled, setCompiled] = useState<{
    markdown: string;
    outstandingCount: number;
    json: unknown;
    version: number;
  } | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [thematicAnchorAudit, setThematicAnchorAudit] = useState<ThematicAnchorAudit | null>(null);
  const [compileNeedsAcknowledgment, setCompileNeedsAcknowledgment] = useState(false);
  const [docxGenerating, setDocxGenerating] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [preCompilationAudit, setPreCompilationAudit] = useState<PreCompilationAudit | null>(null);
  // Issue #71 - partial/incremental compilation. Fully independent of
  // the full-compile state above: a draft never touches `compiled`,
  // `thematicAnchorAudit`, or `preCompilationAudit`.
  const [draftActId, setDraftActId] = useState<"1" | "2A" | "2B" | "3">("1");
  const [draftCompiling, setDraftCompiling] = useState(false);
  const [draftCompiled, setDraftCompiled] = useState<DraftCompiled | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

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
        // Issue #142: activeStepNumber is now persisted on Story.p4 -
        // previously nothing here ever read it, so it always reset to
        // null on reload even mid-conversation.
        setActiveStep((data.story?.p4?.activeStepNumber as number | null | undefined) ?? null);
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
        // Same "compute fresh on resume" precedent sceneDensity directly
        // above already established (issue #173).
        setSetupPayoffAdvisory((data.setupPayoffAdvisory as SetupPayoffAdvisory | undefined) ?? null);
        requestAnimationFrame(() => scrollToLatest("auto"));
      } catch {
        if (!cancelled) setError("Couldn't reach the server. Is the dev server running?");
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, canvasId, scrollToLatest]);

  // Shared by sendMessage and retryLastTurn's success path (issue #138)
  // so both apply the exact same state updates from a TurnResponse.
  function applyTurnResponse(data: TurnResponse) {
    setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    requestAnimationFrame(() => scrollToLatest("smooth"));
    setRoutingChoice(data.routing_choice);
    setActiveStep(data.active_step_number);
    setPlacementFlag(data.placementFlag.flagged ? data.placementFlag : null);
    setValidationResult(data.validationResult);
    setValidationReason(data.validationReason);
    setStatusAccepted(data.statusAccepted);
    setPendingConflict(data.pendingConflict);
    setCascadeReview(data.cascadeReview);
    setSceneDensity(data.sceneDensity);
    setSetupPayoffAdvisory(data.setupPayoffAdvisory);
    setStructuralVectorOptions(data.structuralVectorOptions);
    const turnUnit = data.unit;
    if (turnUnit) {
      setUnits((prev) => {
        const index = prev.findIndex((u) => u.unitId === turnUnit.unitId);
        if (index === -1) return [...prev, turnUnit];
        return prev.map((u, i) => (i === index ? turnUnit : u));
      });
    }
  }

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
        // Issue #150: a stale rejection banner (statusAccepted: false,
        // or a failed validationResult) from an EARLIER successful-but-
        // rejected turn previously stayed visible after a later turn's
        // request failed outright (network error, 502, etc.) - clear
        // both here so the banner never outlives the turn that produced it.
        setStatusAccepted(null);
        setValidationReason(null);
        return;
      }
      applyTurnResponse(data);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  // Recovers a "dangling" turn (issue #138, mirroring world-chat's own
  // issue #108 fix): if a prior turn's model call failed after the
  // user's message was already persisted, the resumed history ends in a
  // user message with no reply. Unlike sendMessage, this does not
  // optimistically append a user bubble (it's already in `messages`
  // from the resume fetch) and sends no `message` field - the server
  // re-runs the turn against the already-persisted history.
  async function retryLastTurn() {
    if (loading || !canvasId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/architecture-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, retry: true }),
      });
      const data: TurnResponse & { error?: string } = await res.json();
      if (res.status === 409) return; // benign: someone else already resolved this dangling turn
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setStatusAccepted(null);
        setValidationReason(null);
        return;
      }
      applyTurnResponse(data);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
    }
  }

  // Issue #138: recovers a "dangling" turn on load - if the model call
  // for the last turn failed after the user's message was already
  // persisted, the resumed history ends in a user message with no
  // reply. Mirrors WorldInterview.tsx's own equivalent effect exactly.
  useEffect(() => {
    if (resuming || !canvasId || error) return;
    if (messages.length > 0 && messages[messages.length - 1].role === "user") {
      // retryLastTurn's setError(null)/setLoading(true) only ever run
      // once, guarded by the conditions above (never on every render) -
      // functionally identical, already-accepted pattern as
      // WorldInterview.tsx's/CharacterInterview.tsx's own
      // dangling-turn-recovery effects, which call the exact same shape
      // of function from an effect without tripping this rule; the
      // react-compiler-based linter's static analysis appears not to
      // inline-trace a named function reference consistently here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      retryLastTurn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId, error]);

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

  async function downloadArchitectureDocx() {
    if (!compiled) return;
    setDocxGenerating(true);
    setCompileError(null);
    try {
      const { generateScreenplayArchitectureDocxBlob } = await import("@/lib/docx/screenplayArchitectureDocx");
      const blob = await generateScreenplayArchitectureDocxBlob(compiled.json as ScreenplayArchitectureDocument);
      downloadBlob(`screenplay-architecture-v${compiled.version}.docx`, blob);
    } catch {
      setCompileError("Couldn't generate the .docx file.");
    } finally {
      setDocxGenerating(false);
    }
  }

  async function downloadArchitecturePdf() {
    if (!compiled) return;
    setPdfGenerating(true);
    setCompileError(null);
    try {
      const { generateScreenplayArchitecturePdfBlob } = await import("@/lib/pdf/ScreenplayArchitecturePdfDocument");
      const blob = await generateScreenplayArchitecturePdfBlob(compiled.json as ScreenplayArchitectureDocument);
      downloadBlob(`screenplay-architecture-v${compiled.version}.pdf`, blob);
    } catch {
      setCompileError("Couldn't generate the .pdf file.");
    } finally {
      setPdfGenerating(false);
    }
  }

  async function compileDraft() {
    if (!canvasId || draftCompiling) return;
    setDraftCompiling(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/architecture-chat/document/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, actId: draftActId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDraftError(data.error ?? "Draft compile failed.");
        setDraftCompiled(null);
        return;
      }
      setDraftCompiled(data);
    } catch {
      setDraftError("Couldn't reach the server.");
    } finally {
      setDraftCompiling(false);
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
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
            ← Back
          </Link>
          <p className="text-sm font-semibold text-neutral-200">Story Architecture</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>Routing: {routingChoice ?? "not chosen yet"}</span>
          <span>Active Step: {activeStep ?? "—"}</span>
          {/* Issue #151: causalTag is already on the wire (the server's
              `unit` field returns the full StructuralUnit), but nothing
              rendered it - a Step-1-exempt Confirmed unit's causalTag
              "UNVALIDATED" was otherwise invisible without a full
              compile. A plain <details> disclosure, since no per-unit
              list view exists yet elsewhere in this UI. */}
          <details className="relative">
            <summary className="cursor-pointer list-none">Units: {units.length}</summary>
            {units.length > 0 && (
              <ul className="absolute right-0 top-full z-20 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-left text-xs text-neutral-300 shadow-lg">
                {units.map((u) => (
                  <li key={u.unitId} className="border-b border-neutral-800 py-1 last:border-0">
                    <span className="font-semibold text-neutral-200">{u.unitId}</span> · {u.type} · {u.status}
                    {u.causalTag && (
                      <span className={u.causalTag === "UNVALIDATED" ? "ml-1 text-amber-400" : "ml-1 text-emerald-400"}>
                        {" "}
                        · {u.causalTag}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </details>
          {validationResult && <span>Validation: {validationResult}</span>}
          <button
            onClick={() => compileDocument(false)}
            disabled={compiling}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {compiling ? "Compiling…" : "Compile"}
          </button>
          {/* Issue #71 - partial/incremental compilation: a fully
              separate action from "Compile" above, producing a
              versioned DRAFT of one named Act, never final canon. */}
          <select
            value={draftActId}
            onChange={(e) => setDraftActId(e.target.value as "1" | "2A" | "2B" | "3")}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200"
          >
            {DRAFT_ACTS.map((act) => (
              <option key={act.id} value={act.id}>
                {act.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => compileDraft()}
            disabled={draftCompiling}
            className="rounded-lg border border-cyan-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {draftCompiling ? "Compiling Draft…" : "Compile Draft"}
          </button>
          <UserMenu />
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
          {/* Issue #155: previously leaked the internal "Canon Revision
              Path" name and read as an instruction TO THE MODEL ("present
              the three choices and wait for the author's pick"), which
              sp04 Section 8 explicitly forbids narrating. Plain,
              author-facing language instead - the conflict itself is
              described to the model separately via its own grounding, so
              this banner only needs to tell the author something is
              waiting on them. */}
          {pendingConflict.kind === "unit_regression"
            ? "A previously confirmed choice is in question - reply to see your three options."
            : "Something you've already confirmed may conflict with a new idea - reply to see your three options."}
        </div>
      )}
      {cascadeReview && cascadeReview.length > 0 && (
        <div className="border-b border-orange-500/30 bg-orange-950/20 px-6 py-2 text-xs text-orange-200">
          <p className="mb-1">Also worth reviewing:</p>
          <ul className="list-disc pl-4">
            {cascadeReview.map((entry, i) => (
              // Issue #160: entry.id alone could collide (a Project 3
              // element_id and a P4 unitId are separate id spaces that
              // could coincidentally match) - the index namespaces it
              // cheaply without needing a real cross-space-safe id.
              <li key={`${i}-${entry.id}`}>
                {entry.id} - {entry.description}
              </li>
            ))}
          </ul>
        </div>
      )}
      {setupPayoffAdvisory &&
        (setupPayoffAdvisory.danglingSetups.length > 0 || setupPayoffAdvisory.orphanedPayoffs.length > 0) && (
          <div className="border-b border-sky-500/30 bg-sky-950/20 px-6 py-2 text-xs text-sky-200">
            {setupPayoffAdvisory.danglingSetups.length > 0 && (
              <p>Planted, not yet paid off: {setupPayoffAdvisory.danglingSetups.join(", ")}</p>
            )}
            {setupPayoffAdvisory.orphanedPayoffs.length > 0 && (
              <p>Paid off, but no matching [SETUP: ...] tag found: {setupPayoffAdvisory.orphanedPayoffs.join(", ")}</p>
            )}
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
            onClick={() => downloadText(`screenplay-architecture-v${compiled.version}.md`, compiled.markdown, "text/markdown")}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
          >
            Download .md
          </button>
          <button
            onClick={() =>
              downloadText(
                `screenplay-architecture-v${compiled.version}.json`,
                JSON.stringify(compiled.json, null, 2),
                "application/json"
              )
            }
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40"
          >
            Download .json
          </button>
          <button
            onClick={downloadArchitectureDocx}
            disabled={docxGenerating}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {docxGenerating ? "Generating…" : "Download .docx"}
          </button>
          <button
            onClick={downloadArchitecturePdf}
            disabled={pdfGenerating}
            className="rounded-lg border border-purple-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:bg-purple-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pdfGenerating ? "Generating…" : "Download .pdf"}
          </button>
        </div>
      )}
      {compileError && <p className="border-b border-red-500/30 px-6 py-2 text-xs text-red-400">{compileError}</p>}

      {draftCompiled && (
        <div className="border-b border-cyan-500/30 bg-cyan-950/20 px-6 py-3 text-xs text-cyan-200">
          <p className="mb-2 font-semibold">
            Draft - Act {draftCompiled.scope.act_id} (draft-v{draftCompiled.draftVersion}) - not final canon.{" "}
            {draftCompiled.outstandingCount} outstanding item{draftCompiled.outstandingCount === 1 ? "" : "s"} in scope.
          </p>
          <button
            onClick={() =>
              downloadText(
                `screenplay-architecture-draft-${draftCompiled.scopeKey}-v${draftCompiled.draftVersion}.md`,
                draftCompiled.markdown,
                "text/markdown"
              )
            }
            className="rounded-lg border border-cyan-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40"
          >
            Download draft .md
          </button>
        </div>
      )}
      {draftError && <p className="border-b border-red-500/30 px-6 py-2 text-xs text-red-400">{draftError}</p>}

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
        {!resuming && <ArchitectureLedgerPanel storyId={canvasId} refreshToken={messages.length} />}
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
        <div ref={endRef} />
        {!isNearBottom && (
          <button
            onClick={() => scrollToLatest("smooth")}
            className="sticky bottom-3 z-10 self-center rounded-full border border-purple-500/50 bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-purple-200 shadow-lg hover:bg-purple-900/40"
          >
            ↓ Jump to latest
          </button>
        )}
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
