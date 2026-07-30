"use client";

import { PROJECT1_STAGES } from "@/lib/canonEngine/stageDefinitions";
import { stripCatalogCodes } from "@/lib/canonEngine/stripCatalogCodes";
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

/**
 * Formats a Confirmed element's value for display, or returns null if there's
 * nothing meaningful to show (null/undefined/empty). Mirrors foundationDoc.ts's
 * str/arr/formatEntry shape-handling (string, array, {name, reason} object) but
 * collapses each to a single readable line instead of a document section, and
 * scrubs internal catalog codes via stripCatalogCodes before formatting.
 */
function formatConfirmedValue(rawValue: unknown): string | null {
  if (rawValue === null || rawValue === undefined) return null;
  const value = stripCatalogCodes(rawValue);
  if (typeof value === "string") return value || null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.name === "string") {
      return typeof o.reason === "string" && o.reason ? `${o.name} — ${o.reason}` : o.name;
    }
    return JSON.stringify(o);
  }
  return String(value);
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
      confirmed: stage.requiredElementIds
        .map((id) => byId.get(id))
        .filter((el): el is PanelElement => el !== undefined && el.status === "Confirmed")
        .map((el) => ({ element: el, formatted: formatConfirmedValue(el.value) }))
        .filter(
          (entry): entry is { element: PanelElement; formatted: string } => entry.formatted !== null
        ),
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
            {stage.confirmed.map(({ element, formatted }) => (
              <div
                key={element.element_id}
                className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-4 py-3"
              >
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {humanizeLabel(element.element_id)}
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-200">
                  {formatted}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
