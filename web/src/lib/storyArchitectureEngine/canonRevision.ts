import { listDependents, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { appendP4CanonRevisionLog, type P4PendingConflict } from "@/lib/canonEngine/storyStore";
import {
  createUnit,
  findUnit,
  upsertUnit,
  setUnitStatus,
  setUnitContent,
  addCanonRefs,
  type StructuralUnit,
} from "./stateLedger";

/**
 * P4's own Canon Revision Path (issue #64) - a P4-local fork, not a
 * call-through to canonEngine/conflictResolution.ts (issue #10's
 * reference implementation) or worldEngine/conflictResolution.ts
 * (issue #47). Investigated first, following the same "reuse or fork"
 * precedent P2/P3 already established: P4's structural units live in
 * their own StructuralUnit[] array (stateLedger.ts), not in
 * canonEngine/canonStore.ts's generic `elements` collection, so
 * neither existing module's literal functions apply. See the design
 * doc (docs/superpowers/specs/2026-09-15-p4-canon-revision-path-design.md)
 * for the full reasoning, including why Option B never writes into
 * P1/P2/P3's own canon (P4 never has a structured replacement value
 * for another project's canon - only a free-text explanation).
 */

export function buildP4ConflictContextMessage(conflict: P4PendingConflict): string {
  const description =
    conflict.kind === "unit_regression"
      ? `Unit "${conflict.unitId}" is already Confirmed, but the latest proposal would move it back to ${conflict.requestedStatus} - that is not a plain revision, it needs this Canon Revision Path.`
      : `The proposed content for unit "${conflict.unitId}" contradicts already-locked ${conflict.sourceProject} canon ("${conflict.contradictedRef}"): ${conflict.explanation}`;
  return `\n\n[CANON REVISION PATH - internal grounding only, never narrate this raw data to the author. ${description} Present the author with exactly three choices in your reply, in your own words: (A) Revert the proposal and keep things as they are, (B) Accept the new idea as the correct one going forward - note clearly that the author will need to make the matching edit on the referenced project's own screen separately, this app will not do it for them, (C) Park the idea for later, logged as an outstanding decision. Once the author clearly picks one, set resolution to "revert", "accept_and_update", or "park" on your next structured output - do not develop any other structural content until this is resolved.]`;
}

export interface P4CascadeReviewEntry {
  id: string;
  description: string;
}

export interface ResolveP4ConflictParams {
  storyId: string;
  conflict: P4PendingConflict;
  resolution: "revert" | "accept_and_update" | "park";
  turnId: string;
  resolvedBy: string;
  units: StructuralUnit[];
}

export interface ResolveP4ConflictResult {
  units: StructuralUnit[];
  cascadeReview: P4CascadeReviewEntry[] | null;
}

/**
 * Applies the author's resolution choice. "accept_and_update" bypasses
 * attemptStatusTransition/evaluateCausalGate entirely and writes the
 * unit directly via stateLedger.ts's plain updaters - the author has
 * now explicitly authorized this, past the point of the automatic
 * gates, mirroring canonStore.ts's own allowConfirmedOverride
 * precedent. Never writes into P1/P2/P3's own canon for any source -
 * the log entry is the durable record. For a Project-3-sourced
 * contradiction only, surfaces an informational (never written)
 * dependents list via canonStore.ts's existing listDependents, whose
 * own comment already names this exact future use. Also scans P4's
 * OWN units for any other unit citing the same contradicted
 * reference - a cheap, P4-internal cascade check; a full cross-project
 * cascade is issue #72's scope, not this one's.
 */
export async function resolveP4Conflict(params: ResolveP4ConflictParams): Promise<ResolveP4ConflictResult> {
  const { storyId, conflict, resolution, turnId, resolvedBy, units } = params;
  const existing = findUnit(units, conflict.unitId);
  let updatedUnits = units;
  let cascadeReview: P4CascadeReviewEntry[] | null = null;

  if (resolution === "park") {
    if (existing) {
      updatedUnits = upsertUnit(units, setUnitStatus(existing, "Parked"));
    }
  } else if (resolution === "accept_and_update") {
    const base = existing ?? createUnit(conflict.unitId, conflict.type);
    const withContent = addCanonRefs(setUnitContent(base, conflict.requestedContent), conflict.requestedCanonRefs);
    const finalUnit = setUnitStatus(withContent, conflict.requestedStatus);
    updatedUnits = upsertUnit(units, finalUnit);

    if (conflict.kind === "canon_contradiction") {
      const p4Entries: P4CascadeReviewEntry[] = updatedUnits
        .filter((u) => u.unitId !== conflict.unitId && u.canonRefs.includes(conflict.contradictedRef))
        .map((u) => ({ id: u.unitId, description: `Another structural unit (${u.type}) in this screenplay that also cites this reference.` }));

      let p3Entries: P4CascadeReviewEntry[] = [];
      if (conflict.sourceProject === "Project 3") {
        const dependents = await listDependents(storyId, conflict.contradictedRef, WORLD_ELEMENTS_COLLECTION);
        p3Entries = dependents
          .filter((e) => e.status === "Confirmed")
          .map((e) => ({ id: e.element_id, description: "Confirmed World Bible element that currently depends on this pillar." }));
      }

      cascadeReview = [...p3Entries, ...p4Entries];
    }
  }
  // "revert" needs no unit write beyond the log below - it keeps existing state untouched by definition.

  await appendP4CanonRevisionLog(storyId, {
    kind: conflict.kind,
    unitId: conflict.unitId,
    description:
      conflict.kind === "unit_regression"
        ? `Unit "${conflict.unitId}" attempted regression to ${conflict.requestedStatus}`
        : `Unit "${conflict.unitId}" contradicted ${conflict.sourceProject} canon "${conflict.contradictedRef}"`,
    // Firestore rejects an explicit `undefined` field value unless
    // ignoreUndefinedProperties is set (it isn't, repo-wide) - a
    // conditional spread, matching worldEngine/conflictResolution.ts's
    // own fix for the exact same hazard (final whole-branch review
    // finding C1 there).
    ...(conflict.kind === "canon_contradiction"
      ? { sourceProject: conflict.sourceProject, contradictedRef: conflict.contradictedRef }
      : {}),
    resolution,
    resolvedBy,
    ts: new Date().toISOString(),
    turnId,
  });

  return { units: updatedUnits, cascadeReview };
}
