"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Markdown from "@/components/Markdown";
import UserMenu from "@/components/UserMenu";
import type { P3State } from "@/lib/canonEngine/storyStore";
import { WCL_LABELS, WCL_LEVELS, type WclLevel } from "@/lib/worldEngine/wcl";
import { pillarElementId } from "@/lib/worldEngine/pillarElementId";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonStatus } from "@/lib/canonEngine/types";

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

type PillarStatus = "Exploring" | "Working" | "Confirmed" | "Deferred";

const PILLAR_STATUSES: PillarStatus[] = ["Exploring", "Working", "Confirmed", "Deferred"];

const STATUS_BADGE_STYLES: Record<PillarStatus, string> = {
  Exploring: "bg-neutral-700 text-neutral-300",
  Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  Deferred: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
};

// The shared Canon Engine's status type uses "Parked"; every P3 boundary
// (this UI, the canon-status route) speaks "Deferred" instead, matching
// the same translation convention already used by character-chat/route.ts.
function toCanonStatus(status: PillarStatus): CanonStatus {
  return status === "Deferred" ? "Parked" : status;
}

function toPillarStatus(status: CanonStatus): PillarStatus {
  return status === "Parked" ? "Deferred" : status;
}

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
  const [wclState, setWclState] = useState<P3State | null>(null);
  const [wclUpdating, setWclUpdating] = useState(false);
  const [pillarDraft, setPillarDraft] = useState<string[]>([]);
  const [pillarDraftTouched, setPillarDraftTouched] = useState(false);
  const [pillarsUpdating, setPillarsUpdating] = useState(false);
  const [newPillarInput, setNewPillarInput] = useState("");
  const [elementStatuses, setElementStatuses] = useState<Record<string, PillarStatus>>({});
  const [elementStatusUpdating, setElementStatusUpdating] = useState(false);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}?worldMessages=1&worldElements=1`);
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
        setWclState((data.story?.p3 as P3State | undefined) ?? null);
        const rawElements = (data.worldElements ?? []) as { element_id: string; status: CanonStatus }[];
        setElementStatuses(
          Object.fromEntries(rawElements.map((e) => [e.element_id, toPillarStatus(e.status)]))
        );
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

  // Mirrors `pillars` once adopted (live-edit mode); before adoption,
  // mirrors the model's latest `proposedPillars` unless the author has
  // already started editing the pre-adoption draft locally - once
  // touched, the local draft is the author's own and stops following
  // new model proposals, the same "final authority once decided"
  // posture the WCL confirm/change split already established one step
  // later in that flow.
  useEffect(() => {
    if (!wclState) return;
    // Mirrors external p3 state (server-confirmed or model-proposed
    // pillars) into the local draft - the "sync from an external
    // source" case the set-state-in-effect rule permits.
    if (wclState.pillars !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPillarDraft(wclState.pillars);
      setPillarDraftTouched(false);
    } else if (!pillarDraftTouched) {
      setPillarDraft(wclState.proposedPillars ?? []);
    }
    // Deliberately granular deps so an unrelated wclState field change
    // (e.g. WCL) doesn't reset this effect's decision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wclState?.pillars, wclState?.proposedPillars, pillarDraftTouched]);

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
      if (data.p3) {
        const incoming = data.p3 as P3State;
        setWclState((prev) => ({
          proposedWorldComplexityLevel: incoming.proposedWorldComplexityLevel,
          worldComplexityLevel: prev?.worldComplexityLevel ?? null,
          proposedPillars: incoming.proposedPillars,
          pillars: prev?.pillars ?? null,
        }));
      }
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setLoading(false);
      requestAnimationFrame(() =>
        listEndRef.current?.scrollIntoView({ behavior: "smooth" })
      );
    }
  }

  async function applyWcl(level: WclLevel) {
    if (!canvasId || wclUpdating) return;
    setWclUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/world-chat/wcl", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, level }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update the World Complexity Level.");
        return;
      }
      setWclState((data.p3 as P3State | undefined) ?? null);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setWclUpdating(false);
    }
  }

  function handleWclChange(level: WclLevel) {
    if (wclState?.worldComplexityLevel && level !== wclState.worldComplexityLevel) {
      const confirmed = window.confirm(
        "Changing the World Complexity Level after it's set affects downstream depth budgets. Continue?"
      );
      if (!confirmed) return;
    }
    applyWcl(level);
  }

  async function applyPillars(pillars: string[]) {
    if (!canvasId || pillarsUpdating) return;
    setPillarsUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/world-chat/pillars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, pillars }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update the pillar list.");
        return;
      }
      setWclState((data.p3 as P3State | undefined) ?? null);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setPillarsUpdating(false);
    }
  }

  // Before adoption (wclState.pillars === null), edits only touch the
  // local draft - Confirm below is what first writes it to the server.
  // After adoption, every edit immediately PATCHes the resulting array,
  // since the author already owns this field (no confirm step needed).
  function mutatePillars(next: string[]) {
    setPillarDraft(next);
    setPillarDraftTouched(true);
    if (wclState && wclState.pillars !== null) {
      applyPillars(next);
    }
  }

  function addPillar() {
    const name = newPillarInput.trim();
    if (!name) return;
    mutatePillars([...pillarDraft, name]);
    setNewPillarInput("");
  }

  function removePillar(index: number) {
    mutatePillars(pillarDraft.filter((_, i) => i !== index));
  }

  function movePillar(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pillarDraft.length) return;
    const next = [...pillarDraft];
    [next[index], next[target]] = [next[target], next[index]];
    mutatePillars(next);
  }

  function confirmPillarDraft() {
    applyPillars(pillarDraft);
  }

  async function changeElementStatus(elementId: string, nextStatus: PillarStatus) {
    if (!canvasId || elementStatusUpdating) return;
    setElementStatusUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/world-chat/canon-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, elementId, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update that pillar's status.");
        return;
      }
      setElementStatuses((prev) => ({ ...prev, [elementId]: data.status as PillarStatus }));
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setElementStatusUpdating(false);
    }
  }

  function handleElementStatusChange(elementId: string, currentStatus: PillarStatus, nextStatus: PillarStatus) {
    if (currentStatus === "Confirmed" && nextStatus !== currentStatus) {
      const confirmed = window.confirm(
        "This pillar is Confirmed. Deferring it moves it out of active canon. Continue?"
      );
      if (!confirmed) return;
    }
    changeElementStatus(elementId, nextStatus);
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
                {wclState?.worldComplexityLevel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400">
                      WCL: Level {wclState.worldComplexityLevel} ({WCL_LABELS[wclState.worldComplexityLevel]})
                    </span>
                    <select
                      value=""
                      disabled={wclUpdating || loading}
                      onChange={(e) => {
                        const level = Number(e.target.value) as WclLevel;
                        if (level) handleWclChange(level);
                        e.target.value = "";
                      }}
                      className="rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-40"
                    >
                      <option value="">Change ▾</option>
                      {WCL_LEVELS.filter((level) => level !== wclState.worldComplexityLevel).map((level) => (
                        <option key={level} value={level}>
                          Level {level} ({WCL_LABELS[level]})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : wclState?.proposedWorldComplexityLevel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400">
                      Proposed: Level {wclState.proposedWorldComplexityLevel} ({WCL_LABELS[wclState.proposedWorldComplexityLevel]})
                    </span>
                    <button
                      onClick={() => applyWcl(wclState.proposedWorldComplexityLevel as WclLevel)}
                      disabled={wclUpdating || loading}
                      className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                    >
                      Confirm
                    </button>
                    <select
                      value=""
                      disabled={wclUpdating || loading}
                      onChange={(e) => {
                        const level = Number(e.target.value) as WclLevel;
                        if (level) applyWcl(level);
                        e.target.value = "";
                      }}
                      className="rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-40"
                    >
                      <option value="">Pick a different level ▾</option>
                      {WCL_LEVELS.filter((level) => level !== wclState.proposedWorldComplexityLevel).map((level) => (
                        <option key={level} value={level}>
                          Level {level} ({WCL_LABELS[level]})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing this world…</p>
                  </div>
                )}

                {!resuming && wclState && (
                  <div
                    data-testid="pillars-panel"
                    className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
                  >
                    <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                      {wclState.pillars !== null
                        ? "World Pillars"
                        : (wclState.proposedPillars?.length ?? 0) > 0
                          ? "Proposed World Pillars"
                          : "World Pillars"}
                    </p>
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {pillarDraft.map((name, i) => {
                        const elementId = pillarElementId(name);
                        const status = elementStatuses[elementId] ?? "Exploring";
                        const statusOptions = PILLAR_STATUSES.filter(
                          (candidate) =>
                            candidate !== status &&
                            isValidTransition(toCanonStatus(status), toCanonStatus(candidate))
                        );
                        return (
                          <li
                            key={i}
                            className="flex items-center gap-2 rounded-lg bg-neutral-900/60 px-3 py-1.5 text-[13px] text-neutral-200"
                          >
                            <span className="flex-1">
                              {i + 1}. {name}
                            </span>
                            {wclState.pillars !== null && (
                              <>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${STATUS_BADGE_STYLES[status]}`}
                                >
                                  {status}
                                </span>
                                <select
                                  value=""
                                  disabled={
                                    elementStatusUpdating || pillarsUpdating || loading || statusOptions.length === 0
                                  }
                                  onChange={(e) => {
                                    const next = e.target.value as PillarStatus;
                                    if (next) handleElementStatusChange(elementId, status, next);
                                    e.target.value = "";
                                  }}
                                  className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-300 disabled:opacity-30"
                                  aria-label={`Change status for ${name}`}
                                >
                                  <option value="">→</option>
                                  {statusOptions.map((candidate) => (
                                    <option key={candidate} value={candidate}>
                                      {candidate}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                            <button
                              onClick={() => movePillar(i, -1)}
                              disabled={pillarsUpdating || loading || i === 0}
                              className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                              aria-label={`Move ${name} up`}
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => movePillar(i, 1)}
                              disabled={pillarsUpdating || loading || i === pillarDraft.length - 1}
                              className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                              aria-label={`Move ${name} down`}
                            >
                              ▼
                            </button>
                            <button
                              onClick={() => removePillar(i)}
                              disabled={pillarsUpdating || loading}
                              className="rounded px-1.5 text-red-400 hover:text-red-300 disabled:opacity-30"
                              aria-label={`Remove ${name}`}
                            >
                              ✕
                            </button>
                          </li>
                        );
                      })}
                      {pillarDraft.length === 0 && (
                        <li className="text-[13px] text-neutral-500">No pillars yet — add one below.</li>
                      )}
                    </ul>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        value={newPillarInput}
                        onChange={(e) => setNewPillarInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addPillar();
                          }
                        }}
                        placeholder="Add a pillar…"
                        disabled={pillarsUpdating || loading}
                        className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[13px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:opacity-40"
                      />
                      <button
                        onClick={addPillar}
                        disabled={pillarsUpdating || loading || !newPillarInput.trim()}
                        className="shrink-0 rounded-lg border border-red-500/50 px-3 py-1.5 text-[12px] font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                    {wclState.pillars === null && (
                      <button
                        onClick={confirmPillarDraft}
                        disabled={pillarsUpdating || loading || pillarDraft.length === 0}
                        className="mt-3 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                      >
                        Confirm pillar list
                      </button>
                    )}
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
