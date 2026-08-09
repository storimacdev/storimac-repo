"use client";

import { PROJECT1_STAGES, getDefaultDepthMode, type StageDefinition } from "@/lib/canonEngine/stageDefinitions";

/**
 * Read-only Story Canon panel — GitHub issue #11, PRD §7. Shows all 8
 * stages with the current one highlighted; per-element status badges for the
 * current and prior stages; no editing. `debug` additionally shows each
 * element's depth_mode (dev/QA only — gated on a ?debug=1 query param at the
 * call site, never shown to end authors).
 *
 * `orientation="horizontal"` (added alongside the view-pane relocation) is a
 * compact stepper strip instead of the full vertical stage list — each
 * stage pill's fill color is an aggregate of its required elements' status
 * (aggregateStageStatus below), not a per-element breakdown; the vertical
 * mode's per-element badges aren't reproduced there, by design (a "which
 * stage am I in" glance, not the full detail view).
 */

export type PanelElement = {
  element_id: string;
  status: "Exploring" | "Working" | "Confirmed" | "Parked";
  depth_mode?: string;
  value?: unknown;
};

export type GuardrailFlag = { turnId: string; questionCount: number; ts: string };

const STATUS_STYLES: Record<PanelElement["status"], string> = {
  Exploring: "bg-neutral-700 text-neutral-300",
  Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  Parked: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
};

type AggregateStatus = "Exploring" | "Working" | "Confirmed";

// Same three-color family as STATUS_STYLES above (muted/amber/emerald),
// applied to the whole stage pill instead of one element's badge.
const AGGREGATE_STYLES: Record<AggregateStatus, string> = {
  Exploring: "bg-neutral-800 text-neutral-400 border border-neutral-700",
  Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
};

/** Rolls a stage's requiredElementIds up into one status: Confirmed only if
 * every required element is Confirmed, Working if any element has been
 * touched at all (Working/Confirmed/Parked), else the muted Exploring
 * default. Stages with no required elements (7, 8) have nothing to
 * aggregate — the caller falls back to current/past/future positioning. */
function aggregateStageStatus(stage: StageDefinition, byId: Map<string, PanelElement>): AggregateStatus {
  if (stage.requiredElementIds.length === 0) return "Exploring";
  let confirmedCount = 0;
  let touchedCount = 0;
  for (const id of stage.requiredElementIds) {
    const status = byId.get(id)?.status;
    if (status === "Confirmed") confirmedCount++;
    if (status && status !== "Exploring") touchedCount++;
  }
  if (confirmedCount === stage.requiredElementIds.length) return "Confirmed";
  if (touchedCount > 0) return "Working";
  return "Exploring";
}

function HorizontalCanonStrip({
  byId,
  currentStage,
}: {
  byId: Map<string, PanelElement>;
  currentStage: number;
}) {
  return (
    <div data-testid="canon-strip" className="flex items-center gap-1.5 overflow-x-auto px-1 py-1">
      {PROJECT1_STAGES.map((stage, i) => {
        const isCurrent = stage.stage === currentStage;
        const isFuture = stage.stage > currentStage;
        const noElements = stage.requiredElementIds.length === 0;
        const aggClass = noElements
          ? isCurrent || stage.stage < currentStage
            ? AGGREGATE_STYLES.Confirmed
            : AGGREGATE_STYLES.Exploring
          : AGGREGATE_STYLES[aggregateStageStatus(stage, byId)];
        return (
          <div key={stage.stage} className="flex shrink-0 items-center gap-1.5">
            <div
              data-stage={stage.stage}
              data-current={isCurrent}
              title={stage.name}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${aggClass} ${
                isCurrent ? "ring-2 ring-red-500/70" : ""
              } ${isFuture ? "opacity-40" : ""}`}
            >
              <span>{stage.stage}</span>
              <span className="hidden sm:inline">{stage.name}</span>
            </div>
            {i < PROJECT1_STAGES.length - 1 && <span className="h-px w-3 shrink-0 bg-neutral-700" />}
          </div>
        );
      })}
    </div>
  );
}

export default function CanonPanel({
  elements,
  currentStage,
  debug = false,
  guardrailFlags,
  orientation = "vertical",
}: {
  elements: PanelElement[];
  currentStage: number;
  debug?: boolean;
  guardrailFlags?: GuardrailFlag[];
  orientation?: "vertical" | "horizontal";
}) {
  const byId = new Map(elements.map((e) => [e.element_id, e]));

  if (orientation === "horizontal") {
    return <HorizontalCanonStrip byId={byId} currentStage={currentStage} />;
  }

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      {debug && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            Questionnaire-dump flags: {guardrailFlags?.length ?? 0}
          </p>
          {guardrailFlags && guardrailFlags.length > 0 && (
            <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
              {guardrailFlags.map((f, i) => (
                <li key={`${f.turnId}-${i}`} className="flex items-center justify-between gap-2 text-[10px] text-neutral-400">
                  <span className="truncate font-mono">{f.turnId.slice(0, 8)}</span>
                  <span>{f.questionCount} questions</span>
                  <span>{new Date(f.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {PROJECT1_STAGES.map((stage) => {
        const isCurrent = stage.stage === currentStage;
        const isPast = stage.stage < currentStage;
        const showElements = (isCurrent || isPast) && stage.requiredElementIds.length > 0;
        return (
          <div
            key={stage.stage}
            data-stage={stage.stage}
            data-current={isCurrent}
            className={`mb-2 rounded-lg px-3 py-2 ${
              isCurrent
                ? "border border-red-500/50 bg-red-500/10"
                : isPast
                  ? "bg-neutral-800/60"
                  : "bg-neutral-900/40 opacity-50"
            }`}
          >
            <div className="flex items-baseline gap-2">
              <span className={`text-xs font-bold ${isCurrent ? "text-red-300" : "text-neutral-500"}`}>
                {stage.stage}
              </span>
              <span className={`text-xs ${isCurrent ? "font-semibold text-neutral-100" : "text-neutral-400"}`}>
                {stage.name}
              </span>
            </div>
            {showElements && (
              <ul className="mt-2 space-y-1">
                {stage.requiredElementIds.map((id) => {
                  const el = byId.get(id);
                  const status = el?.status ?? "Exploring";
                  return (
                    <li key={id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-neutral-300">{id.replace(/_/g, " ")}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {debug && (
                          <span className="rounded bg-neutral-800 px-1 py-0.5 text-[9px] text-neutral-500">
                            {el?.depth_mode ?? getDefaultDepthMode(stage.stage, id)}
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${STATUS_STYLES[status]}`}>
                          {status}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
