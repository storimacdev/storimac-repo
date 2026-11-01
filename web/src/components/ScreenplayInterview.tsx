"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/UserProvider";
import UserMenu from "@/components/UserMenu";
import Link from "next/link";
import { useScrollToLatest } from "@/lib/useScrollToLatest";
import { determineActiveSceneNumber } from "@/lib/screenplayEngine/sceneLedger";

type ChatMessage = { role: "user" | "assistant"; content: string };

interface SceneSummary {
  sceneNumber: number;
  status: "Exploring" | "Working" | "Confirmed" | "Parked";
  phase: "assignment_gate" | "drafting" | "qa_delivery" | "revision";
  assignmentSummary: string | null;
  signedOff: boolean;
  draftText: string | null;
  confirmedText: string | null;
}

interface TurnResponse {
  reply: string;
  context: string;
  sceneNumber: number | null;
  phase: string | null;
  scene: SceneSummary | null;
  summaryFormatIssue: string | null;
  continuityViolations: { kind: string; message: string }[] | null;
  draftValidation: {
    ok: boolean;
    blockingReasons: string[];
    advisoryFindings: { leanParagraphs: unknown[]; visualDiscipline: unknown[] };
  } | null;
  structuralDeviation: { deviates: boolean; explanation: string } | null;
  delivery: string | null;
  pendingConflict: { kind: "structural_deviation" | "continuity_contradiction"; sceneNumber: number } | null;
  downstreamContinuityDamage: string[] | null;
  gaps: { project: string; field: string; reason: string }[];
  deferredItems: { item: string; defer_to_project: string | null; notes: string }[];
}

/**
 * Project 5 (Screenplay Edition) chat UI — GitHub issues #93-#96
 * (Phases 1-4), #98 (Conflict Intercept), and #100 (persisted session
 * state & resume). Deliberately smaller than ArchitectureInterview.tsx/
 * WorldInterview.tsx: P5 has no compiled-document export concern
 * (issue #102 is explicitly out of scope for this build), so there is
 * no compile/.docx/.pdf panel to carry over.
 */
export default function ScreenplayInterview() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");
  const canvasId = searchParams.get("canvasId");
  const { setLastProject } = useUser();
  const { containerRef, endRef, handleScroll, scrollToLatest } = useScrollToLatest();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(() => Boolean(workspaceId && canvasId));
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<SceneSummary | null>(null);
  const [gaps, setGaps] = useState<{ project: string; field: string; reason: string }[]>([]);
  const [summaryFormatIssue, setSummaryFormatIssue] = useState<string | null>(null);
  const [continuityViolations, setContinuityViolations] = useState<{ kind: string; message: string }[] | null>(null);
  const [structuralDeviation, setStructuralDeviation] = useState<{ deviates: boolean; explanation: string } | null>(
    null
  );
  const [draftBlockingReasons, setDraftBlockingReasons] = useState<string[]>([]);
  const [delivery, setDelivery] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{
    kind: "structural_deviation" | "continuity_contradiction";
    sceneNumber: number;
  } | null>(null);
  const [downstreamDamage, setDownstreamDamage] = useState<string[]>([]);

  // Resume/hydration on mount (issue #100) - mirrors
  // ArchitectureInterview.tsx's own resume effect exactly in shape:
  // without this, a page reload always started with empty messages/
  // scene/pendingConflict state even though the server had been
  // persisting everything all along (Story.p5Scenes,
  // p5ContinuityMatrix, p5PendingConflict - all already written by
  // screenplay-chat/route.ts since issues #93-#98). Restores the full
  // transcript plus the active scene and any open Conflict Intercept
  // conflict; the Continuity Matrix itself is never shown directly in
  // this UI, but is already read fresh from Firestore by the route on
  // every turn (no client-side caching), so a resumed session's next
  // turn reflects its current state automatically - AC3's "not a
  // stale snapshot."
  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}?screenplayMessages=1`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load this Story Canvas.");
          return;
        }
        const rawMessages = (data.screenplayMessages ?? []) as { role: "user" | "assistant"; content: string }[];
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));

        const sceneList = (data.story?.p5Scenes as SceneSummary[] | undefined) ?? [];
        // Same determineActiveSceneNumber rule the server applies
        // (sceneLedger.ts) - shared, not re-derived, so this UI's pick
        // of "which scene to show" can never drift from the server's
        // own "which scene is active" pointer.
        const activeSceneNumber = sceneList.length > 0 ? determineActiveSceneNumber(sceneList, null) : null;
        const activeScene = sceneList.find((s) => s.sceneNumber === activeSceneNumber) ?? null;
        setScene(activeScene);

        const pending = data.story?.p5PendingConflict as
          | { kind: "structural_deviation" | "continuity_contradiction"; sceneNumber: number }
          | null
          | undefined;
        setPendingConflict(pending ?? null);

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

  async function sendMessage(text: string) {
    if (!canvasId || !text.trim() || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screenplay-chat", {
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
      requestAnimationFrame(() => scrollToLatest("smooth"));
      setScene(data.scene);
      setGaps(data.gaps);
      setSummaryFormatIssue(data.summaryFormatIssue);
      setContinuityViolations(data.continuityViolations);
      setStructuralDeviation(data.structuralDeviation?.deviates ? data.structuralDeviation : null);
      setDraftBlockingReasons(data.draftValidation?.ok === false ? data.draftValidation.blockingReasons : []);
      setDelivery(data.delivery);
      setPendingConflict(data.pendingConflict);
      setDownstreamDamage(data.downstreamContinuityDamage ?? []);
      setLastProject("screenplay");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-200">
            ← Dashboard
          </Link>
          <h1 className="text-sm font-semibold">Screenplay Edition</h1>
        </div>
        <UserMenu />
      </header>

      {gaps.length > 0 && (
        <div className="border-b border-amber-700/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          {gaps.length} canon gap{gaps.length === 1 ? "" : "s"}:{" "}
          {gaps.map((g) => `${g.project} ${g.field}`).join(", ")}
        </div>
      )}

      {pendingConflict && (
        <div className="border-b border-red-700/40 bg-red-950/40 px-4 py-3 text-xs text-red-200">
          <p className="font-semibold">
            Conflict Intercept — Scene {pendingConflict.sceneNumber} ({pendingConflict.kind.replace("_", " ")})
          </p>
          {downstreamDamage.length > 0 && (
            <p className="mt-1 text-red-300">Downstream impact: {downstreamDamage.join(" ")}</p>
          )}
          <p className="mt-1">Drafting is frozen for this scene until you choose how to proceed.</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => sendMessage("Revert the proposal and keep the scene as it was.")}
              disabled={loading || resuming}
              className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50"
            >
              A: Revert
            </button>
            <button
              onClick={() => sendMessage("Accept the new idea as correct going forward, and log the change.")}
              disabled={loading || resuming}
              className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50"
            >
              B: Accept &amp; update
            </button>
            <button
              onClick={() => sendMessage("Park this idea for later as an outstanding decision.")}
              disabled={loading || resuming}
              className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10 disabled:opacity-50"
            >
              C: Park
            </button>
          </div>
        </div>
      )}

      {summaryFormatIssue && (
        <div className="border-b border-red-700/40 bg-red-950/30 px-4 py-2 text-xs text-red-200">
          Assignment summary format issue: {summaryFormatIssue}
        </div>
      )}

      {continuityViolations && continuityViolations.length > 0 && (
        <div className="border-b border-red-700/40 bg-red-950/30 px-4 py-2 text-xs text-red-200">
          Continuity Matrix violation(s): {continuityViolations.map((v) => v.message).join(" ")}
        </div>
      )}

      {structuralDeviation && (
        <div className="border-b border-amber-700/40 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          Structural deviation from the Project 4 blueprint flagged — this requires the Conflict Intercept protocol
          before drafting can proceed: {structuralDeviation.explanation}
        </div>
      )}

      {draftBlockingReasons.length > 0 && (
        <div className="border-b border-red-700/40 bg-red-950/30 px-4 py-2 text-xs text-red-200">
          Draft did not clear the Screenplay Narrative Execution Standards: {draftBlockingReasons.join(" ")}
        </div>
      )}

      {scene?.status === "Confirmed" && (
        <div className="border-b border-emerald-700/40 bg-emerald-950/30 px-4 py-2 text-xs text-emerald-200">
          Scene {scene.sceneNumber} is Confirmed — its text is now frozen, immutable canon.
        </div>
      )}

      {(delivery || (scene?.draftText && scene.status === "Working")) && scene && scene.status === "Working" && (
        <div className="max-h-64 overflow-y-auto border-b border-neutral-800 bg-neutral-900/60 px-4 py-2 text-xs">
          <p className="mb-1 font-semibold text-neutral-400">
            Phase 3 delivery (Scene {scene.sceneNumber}) — THE SCREENPLAY / COMPLIANCE REPORT:
          </p>
          <pre className="whitespace-pre-wrap text-neutral-300">{delivery ?? scene.draftText}</pre>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => sendMessage("I approve this scene exactly as drafted. Please confirm it.")}
              disabled={loading || resuming}
              className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-50"
            >
              Approve scene
            </button>
          </div>
        </div>
      )}

      {scene && (
        <div className="border-b border-neutral-800 bg-neutral-900/40 px-4 py-2 text-xs text-neutral-300">
          Scene {scene.sceneNumber} — status: {scene.status} · phase: {scene.phase} ·{" "}
          {scene.signedOff ? "signed off" : "awaiting sign-off"}
          {scene.assignmentSummary && !scene.signedOff && (
            <div className="mt-2 rounded-lg border border-neutral-700 bg-neutral-900 p-3">
              <p className="whitespace-pre-wrap text-neutral-200">{scene.assignmentSummary}</p>
              <button
                onClick={() => sendMessage("I sign off on this scene assignment. Please proceed.")}
                disabled={loading || resuming}
                className="mt-2 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-50"
              >
                Sign off on this scene
              </button>
            </div>
          )}
        </div>
      )}

      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4">
        {!workspaceId || !canvasId ? (
          <p className="text-sm text-neutral-500">Open this screen from a Story Canvas on the dashboard.</p>
        ) : resuming ? (
          <p className="text-sm text-neutral-500">Resuming session…</p>
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "text-right" : "text-left"}
              >
                <div
                  className={
                    m.role === "user"
                      ? "inline-block max-w-[80%] rounded-xl bg-red-600/80 px-3 py-2 text-sm"
                      : "inline-block max-w-[80%] rounded-xl bg-neutral-800 px-3 py-2 text-sm"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-neutral-800 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!canvasId || loading || resuming}
          placeholder="Message the Screenwriter…"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm focus:outline-none"
        />
        <button
          type="submit"
          disabled={!canvasId || loading || resuming || !input.trim()}
          className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
