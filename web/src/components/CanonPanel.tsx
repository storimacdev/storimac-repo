"use client";

import { PROJECT1_STAGES, getDefaultDepthMode } from "@/lib/canonEngine/stageDefinitions";

/**
 * Read-only Story Canon panel — GitHub issue #11, PRD §7. Shows all 8
 * stages with the current one highlighted; per-element status badges for the
 * current and prior stages; no editing. Rendered inside the left panel's
 * Chat/Canon tab switcher (the tab acts as the collapse mechanism). `debug`
 * additionally shows each element's depth_mode (dev/QA only — gated on a
 * ?debug=1 query param at the call site, never shown to end authors).
 */

export type PanelElement = {
  element_id: string;
  status: "Exploring" | "Working" | "Confirmed" | "Parked";
  depth_mode?: string;
  value?: unknown;
};

const STATUS_STYLES: Record<PanelElement["status"], string> = {
  Exploring: "bg-neutral-700 text-neutral-300",
  Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  Parked: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
};

export default function CanonPanel({
  elements,
  currentStage,
  debug = false,
}: {
  elements: PanelElement[];
  currentStage: number;
  debug?: boolean;
}) {
  const byId = new Map(elements.map((e) => [e.element_id, e]));

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
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
