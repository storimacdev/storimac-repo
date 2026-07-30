"use client";

import { PROJECT1_STAGES } from "@/lib/canonEngine/stageDefinitions";
import type { PanelElement } from "@/components/CanonPanel";

/**
 * "Story so far" synthesis for the interview's right-hand pane - the
 * narrative-facing counterpart to CanonPanel's technical inspector (Canon
 * tab, left panel). Shows only Confirmed elements as label + value, grouped
 * by stage; Working/Exploring/Parked elements stay Canon-tab-only so this
 * always reads as settled fact, never a to-do list.
 */

function humanizeLabel(elementId: string): string {
  return elementId
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export default function StorySoFar({
  elements,
  currentStage,
}: {
  elements: PanelElement[];
  currentStage: number;
}) {
  const byId = new Map(elements.map((e) => [e.element_id, e]));

  const stages = PROJECT1_STAGES.filter(
    (stage) => stage.stage <= currentStage && stage.requiredElementIds.length > 0
  )
    .map((stage) => ({
      ...stage,
      confirmed: stage.requiredElementIds.filter((id) => byId.get(id)?.status === "Confirmed"),
    }))
    .filter((stage) => stage.confirmed.length > 0);

  if (stages.length === 0) {
    return (
      <div className="mx-auto max-w-3xl text-center text-sm text-neutral-500">
        Your story is just getting started — confirmed details will appear here as you go.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {stages.map((stage) => (
        <div key={stage.stage}>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">{stage.name}</p>
          <dl className="space-y-2">
            {stage.confirmed.map((id) => {
              const el = byId.get(id)!;
              return (
                <div key={id} className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                    {humanizeLabel(id)}
                  </dt>
                  <dd className="mt-1 text-sm leading-relaxed text-neutral-200">{formatValue(el.value)}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </div>
  );
}
