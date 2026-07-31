import { getElement, listElements, upsertElement, type ElementUpdate } from "./canonStore";
import { listDownstreamImpact } from "./stageFsm";
import type { CanonElement } from "./types";

/**
 * Conflict Detection & Resolution flow — GitHub issue #10, reference
 * implementation of the shared Canon Engine's ConflictResolution flow
 * (ARCHITECTURE.md §2). PRD §5.7/§6.4.
 *
 * Detection itself is already enforced at write time by canonStore's
 * applyStateDelta (throws CanonConflictError without
 * allowConfirmedOverride — see #6). detectConflict here is a read-only
 * *pre-check* that runs before attempting a write, so the caller gets
 * structured old/new values to inject into the next model turn instead of
 * just a caught error's message string.
 */

export type ConflictResolutionChoice = "keep_canon" | "accept_and_update" | "park";

export interface PendingConflict {
  element_id: string;
  old_value: unknown;
  new_value: unknown;
}

export async function detectConflict(
  storyId: string,
  updates: ElementUpdate[]
): Promise<PendingConflict | null> {
  const elements = await listElements(storyId);
  const byId = new Map(elements.map((e) => [e.element_id, e]));

  for (const u of updates) {
    if (u.allowConfirmedOverride) continue;
    const existing = byId.get(u.element_id);
    if (!existing || existing.status !== "Confirmed") continue;

    const hasNewValue = u.patch.value !== undefined;
    const changingValue = hasNewValue && JSON.stringify(u.patch.value) !== JSON.stringify(existing.value);
    const changingStatus = u.patch.status !== undefined && u.patch.status !== existing.status;

    if (changingValue || changingStatus) {
      return {
        element_id: u.element_id,
        old_value: existing.value,
        new_value: hasNewValue ? u.patch.value : existing.value,
      };
    }
  }
  return null;
}

/**
 * Context block to inject into the next model call once a conflict is
 * detected — PRD §5.7: "force the next model turn to run the Conflict
 * Resolution flow... with both old and new values injected into context."
 */
export function buildConflictContextMessage(conflict: PendingConflict): string {
  return [
    "[CONFLICT DETECTED — system note, not from the author]",
    `The element "${conflict.element_id}" is already Confirmed as: ${JSON.stringify(conflict.old_value)}`,
    `The author's latest input implies a different value: ${JSON.stringify(conflict.new_value)}`,
    "Stop the interview. State this contradiction explicitly, in plain language, in `context` - that's where the full explanation belongs.",
    "In `reply`, present exactly three choices as the short numbered list: (A) Keep Canon, (B) Accept the new idea and update Canon, (C) Park it for later. Point to the contradiction, don't restate it there.",
    "Your next structured output must set resolution to one of keep_canon | accept_and_update | park, matching the author's pick.",
  ].join("\n");
}

export interface CascadeReviewEntry {
  element_id: string;
  value: unknown;
  rationale: string;
}

/**
 * "On (B): app produces a list of potentially-invalidated downstream
 * Confirmed elements... for the author to re-confirm or re-open." Two
 * sources, unioned: structural dependents (depends_on array-contains, via
 * canonStore/stageFsm's listDownstreamImpact) and a plain-text scan of
 * every Confirmed element's own rationale for a mention of the changed
 * element_id, per this AC's specific wording ("whose stored rationale
 * references the changed element").
 */
export async function findCascadeReview(
  storyId: string,
  changedElementId: string
): Promise<CascadeReviewEntry[]> {
  const [structural, allElements] = await Promise.all([
    listDownstreamImpact(storyId, changedElementId),
    listElements(storyId),
  ]);

  const byRationale = allElements.filter(
    (e) =>
      e.status === "Confirmed" &&
      e.element_id !== changedElementId &&
      e.rationale.includes(changedElementId)
  );

  const merged = new Map<string, CanonElement>();
  for (const e of [...structural, ...byRationale]) {
    if (e.status === "Confirmed") merged.set(e.element_id, e);
  }

  return Array.from(merged.values()).map((e) => ({
    element_id: e.element_id,
    value: e.value,
    rationale: e.rationale,
  }));
}

export interface ResolveConflictParams {
  storyId: string;
  conflict: PendingConflict;
  choice: ConflictResolutionChoice;
  turnId: string;
  /** Only used when choice === "accept_and_update"; falls back to conflict.new_value. */
  newValue?: unknown;
  /** Only used when choice === "accept_and_update". Not persisted (left as-is) if omitted — e.g. the resolution turn changed the value without re-diagnosing a format. */
  newRetrievalCode?: string | string[] | null;
}

export interface ResolveConflictResult {
  updatedElement: CanonElement;
  cascadeReview: CascadeReviewEntry[];
}

/**
 * Applies the author's resolution choice. All three paths write through
 * canonStore with allowConfirmedOverride, so a history entry with a
 * timestamp is always appended — AC: "Resolution and the author's choice
 * are recorded in the element's history."
 */
export async function resolveConflict(params: ResolveConflictParams): Promise<ResolveConflictResult> {
  const { storyId, conflict, choice, turnId } = params;

  if (choice === "keep_canon") {
    const current = await getElement(storyId, conflict.element_id);
    if (!current) throw new Error(`Element "${conflict.element_id}" not found.`);
    const updatedElement = await upsertElement(
      storyId,
      conflict.element_id,
      {
        status: "Confirmed",
        value: current.value,
        rationale: `${current.rationale} [Conflict resolved ${new Date().toISOString()}: kept canon]`.trim(),
      },
      turnId,
      true
    );
    return { updatedElement, cascadeReview: [] };
  }

  if (choice === "park") {
    const updatedElement = await upsertElement(
      storyId,
      conflict.element_id,
      { status: "Parked" },
      turnId,
      true
    );
    return { updatedElement, cascadeReview: [] };
  }

  // accept_and_update
  const cascadeReview = await findCascadeReview(storyId, conflict.element_id);
  const updatedElement = await upsertElement(
    storyId,
    conflict.element_id,
    {
      status: "Confirmed",
      value: params.newValue ?? conflict.new_value,
      ...(params.newRetrievalCode !== undefined ? { retrieval_code: params.newRetrievalCode } : {}),
    },
    turnId,
    true
  );
  return { updatedElement, cascadeReview };
}
