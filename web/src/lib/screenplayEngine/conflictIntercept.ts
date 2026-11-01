import type { P5PendingConflict, P5ConflictLogEntry } from "@/lib/canonEngine/storyStore";
import { appendP5ConflictLog } from "@/lib/canonEngine/storyStore";
import {
  applyContinuityMatrixUpdate,
  type ContinuityMatrix,
  type ContinuityMatrixUpdate,
} from "./continuityMatrix";
import { setDraftText, setPendingMatrixUpdate, parkScene, type SceneRecord } from "./sceneLedger";

/**
 * Conflict Intercept protocol — GitHub issue #98, PRD refs P5-Prompt5
 * SCREENPLAY EDITION v2.0 §7 (State Rules & Canon Management —
 * Conflict Intercept).
 *
 * Architecture note: mirrors the shared engine's ConflictResolution
 * flow pattern (ARCHITECTURE.md §2) already used by Projects 1-4 - the
 * same 3-way halt-and-choose shape as Project 4's own Canon Revision
 * Path (issue #64, storyArchitectureEngine/canonRevision.ts), the most
 * recent and closest precedent to mirror. Project-specific copy only:
 * P5's two conflict kinds (structural_deviation, from issue #94's own
 * model self-report; continuity_contradiction, from issue #97's
 * deterministic checkContinuityBeforeDraft) replace P4's
 * (unit_regression, canon_contradiction), and resolution applies to a
 * SceneRecord + ContinuityMatrix pair rather than a StructuralUnit[].
 */

/**
 * AC2: builds the internal grounding block instructing the model to
 * present the author with exactly the three required details (specific
 * contradiction, downstream continuity damage, request for explicit
 * override authorization) and the three resolution choices, in its own
 * words - mirrors canonRevision.ts's buildP4ConflictContextMessage
 * exactly in shape.
 */
export function buildP5ConflictContextMessage(
  conflict: P5PendingConflict,
  downstreamDamage: string[]
): string {
  const description =
    conflict.kind === "structural_deviation"
      ? `Scene ${conflict.sceneNumber}'s proposed draft requires altering a structural fact from the Project 4 blueprint, not just its visual execution: ${conflict.explanation}`
      : `Scene ${conflict.sceneNumber}'s proposed draft contradicts already-Confirmed continuity: ${conflict.violations.map((v) => v.message).join(" ")}`;
  const damageNote =
    downstreamDamage.length > 0
      ? ` Downstream continuity damage if this proceeds unresolved: ${downstreamDamage.join(" ")}`
      : " No downstream Confirmed scenes or Open Loops are currently tied to this point.";
  return `\n\n[CONFLICT INTERCEPT - internal grounding only, never narrate this raw data to the author. ${description}${damageNote} Present the author with exactly three choices in your own words: (A) Revert the proposal and keep the scene as it was, (B) Accept the new idea as correct going forward - this is logged, and the downstream continuity damage above is traced for the author's awareness, (C) Park the idea for later, logged as an outstanding decision. Once the author clearly picks one, set resolution to "revert", "accept_and_update", or "park" on your next structured output - draft no further content for this scene until this is resolved.]`;
}

/**
 * AC2: "downstream continuity damage (which later scenes/loops are
 * affected)" - a real, deterministic computation from already-tracked
 * state (Confirmed scenes numbered after this one, and any Open Loop
 * planted or paid off at this scene number), not a model guess.
 */
export function computeDownstreamContinuityDamage(
  matrix: ContinuityMatrix,
  scenes: SceneRecord[],
  sceneNumber: number
): string[] {
  const laterConfirmed = scenes.filter((s) => s.status === "Confirmed" && s.sceneNumber > sceneNumber);
  const involvedLoops = matrix.openLoops.filter(
    (l) => l.plantedSceneNumber === sceneNumber || l.closedSceneNumber === sceneNumber
  );

  const entries: string[] = [];
  if (laterConfirmed.length > 0) {
    entries.push(
      `${laterConfirmed.length} later Confirmed scene(s) (${laterConfirmed.map((s) => s.sceneNumber).join(", ")}) may need review if this scene's facts change.`
    );
  }
  for (const loop of involvedLoops) {
    entries.push(
      `Open Loop "${loop.description}" (${loop.kind}, id ${loop.id}) is tied to this scene (planted scene ${loop.plantedSceneNumber}${loop.closedSceneNumber !== null ? `, closed scene ${loop.closedSceneNumber}` : ""}).`
    );
  }
  return entries;
}

export interface ResolveP5ConflictParams {
  storyId: string;
  conflict: P5PendingConflict;
  resolution: "revert" | "accept_and_update" | "park";
  turnId: string;
  resolvedBy: string;
  scenes: SceneRecord[];
  matrix: ContinuityMatrix;
}

export interface ResolveP5ConflictResult {
  scenes: SceneRecord[];
  matrix: ContinuityMatrix;
}

/**
 * AC3: applies the author's resolution choice, then logs it (matching
 * the Confirmed/Working/Exploring/Parked state tracking already built
 * for every other project's conflict log). "accept_and_update" writes
 * the originally requested draft text and matrix update directly via
 * sceneLedger.ts's plain updaters, bypassing the gates that originally
 * blocked it - the author has now explicitly authorized this, mirroring
 * canonRevision.ts's resolveP4Conflict's own "accept_and_update bypasses
 * the gates" precedent exactly. Never reaches Confirmed on its own -
 * accepting the conflict only ever lands the scene at Working; Phase
 * 4's own explicit approval (issue #96) is still required separately
 * to freeze it as canon, since accepting a conflict and approving a
 * scene's final text are two different author decisions.
 */
export async function resolveP5Conflict(params: ResolveP5ConflictParams): Promise<ResolveP5ConflictResult> {
  const { storyId, conflict, resolution, turnId, resolvedBy, scenes, matrix } = params;
  const existing = scenes.find((s) => s.sceneNumber === conflict.sceneNumber);
  let updatedScenes = scenes;
  let updatedMatrix = matrix;

  if (resolution === "park" && existing) {
    updatedScenes = scenes.map((s) => (s.sceneNumber === conflict.sceneNumber ? parkScene(s) : s));
  } else if (resolution === "accept_and_update" && existing) {
    const drafted = setPendingMatrixUpdate(
      setDraftText(existing, conflict.requestedDraftText),
      conflict.requestedMatrixUpdate
    );
    updatedScenes = scenes.map((s) => (s.sceneNumber === conflict.sceneNumber ? drafted : s));
    const update: ContinuityMatrixUpdate = { sceneNumber: conflict.sceneNumber, ...conflict.requestedMatrixUpdate };
    // Note (disclosed, same as canonRevision.ts's own precedent): this
    // applies the requested continuity outcomes to the matrix
    // immediately on accept, ahead of the normal "only on Confirm"
    // rule (issue #97 AC5) - the author's "accept the new idea"
    // override is exactly the authorization that rule exists to
    // require, so applying it here rather than waiting for a second,
    // separate Phase 4 approval is the correct reading of "accept and
    // update... trace all downstream structural units affected."
    updatedMatrix = applyContinuityMatrixUpdate(matrix, update);
  }
  // "revert" needs no scene/matrix write - it keeps existing state
  // untouched by definition, same as every other project's precedent.

  const logEntry: P5ConflictLogEntry = {
    kind: conflict.kind,
    sceneNumber: conflict.sceneNumber,
    description:
      conflict.kind === "structural_deviation"
        ? `Scene ${conflict.sceneNumber} proposed a structural deviation: ${conflict.explanation}`
        : `Scene ${conflict.sceneNumber} contradicted already-Confirmed continuity: ${conflict.violations.map((v) => v.message).join(" ")}`,
    resolution,
    resolvedBy,
    ts: new Date().toISOString(),
    turnId,
  };
  await appendP5ConflictLog(storyId, logEntry);

  return { scenes: updatedScenes, matrix: updatedMatrix };
}
