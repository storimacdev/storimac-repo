import type { CanonElement } from "./types";
import { listDependents } from "./canonStore";
import { getStageDefinition } from "./stageDefinitions";

/**
 * 8-stage FSM — GitHub issue #7, PRD §5.4/§5.5. Project-1-specific (unlike
 * the rest of canonEngine/, which is generic across Projects 1-4) since the
 * stage list and required elements are Project 1's own workflow.
 *
 * Stage definitions + depth defaults live in stageDefinitions.ts (pure data,
 * importable from client components — issue #11's panel needs them); this
 * module keeps the gating/advancement logic and re-exports the data for
 * existing server-side callers.
 *
 * Scope boundary, stated plainly: this module gates *forward advancement*
 * and computes depth defaults. It does not itself run Stage 7's audit logic
 * (issue #16) or the Conflict Resolution 3-way choice (issue #10) - it
 * exposes listDownstreamImpact for #10 to use, and leaves Stage 7's gate
 * intentionally empty (systemRun: true) for #16 to extend.
 */

export {
  PROJECT1_STAGES,
  getDefaultDepthMode,
  getStageDefinition,
  type StageDefinition,
} from "./stageDefinitions";

export interface StageGateResult {
  canAdvance: boolean;
  /** Required elements still Exploring or Working - these block advancement. */
  blockingElementIds: string[];
  /** Required elements that are Parked - allowed through, but flagged. */
  parkedElementIds: string[];
}

export function checkStageGate(stage: number, elements: CanonElement[]): StageGateResult {
  const def = getStageDefinition(stage);
  const byId = new Map(elements.map((e) => [e.element_id, e]));

  const blockingElementIds: string[] = [];
  const parkedElementIds: string[] = [];

  for (const id of def.requiredElementIds) {
    const status = byId.get(id)?.status ?? "Exploring";
    if (status === "Exploring" || status === "Working") {
      blockingElementIds.push(id);
    } else if (status === "Parked") {
      parkedElementIds.push(id);
    }
  }

  return {
    canAdvance: blockingElementIds.length === 0,
    blockingElementIds,
    parkedElementIds,
  };
}

export interface OutstandingQuestion {
  item: string;
  defer_to: "Project 2" | "Project 3" | "Project 4" | "Project 5" | null;
  notes: string;
}

/**
 * Advances from `fromStage` to `fromStage + 1` if the gate allows it, and
 * generates an OutstandingQuestion for every Parked required element -
 * per this issue's own AC ("Parked required elements are allowed to pass
 * stage-gating, and generate an outstanding_questions entry"). defer_to is
 * left null here (still Project 1, revisit before Stage 8) rather than
 * guessed at - a genuinely cross-project deferral is tagged by whoever
 * detects that (the guardrail/scope-boundary logic), not this FSM.
 */
export function advanceStage(
  fromStage: number,
  elements: CanonElement[]
): { nextStage: number; outstandingQuestions: OutstandingQuestion[] } {
  const gate = checkStageGate(fromStage, elements);
  if (!gate.canAdvance) {
    throw new Error(
      `Cannot advance from Stage ${fromStage}: required elements still Exploring/Working: ${gate.blockingElementIds.join(", ")}`
    );
  }

  const stageName = getStageDefinition(fromStage).name;
  const outstandingQuestions: OutstandingQuestion[] = gate.parkedElementIds.map((id) => {
    const el = elements.find((e) => e.element_id === id);
    return {
      item: `${id}: ${JSON.stringify(el?.value ?? null)}`,
      defer_to: null,
      notes: `Parked in Stage ${fromStage} (${stageName}); revisit before Stage 8 compilation.`,
    };
  });

  return { nextStage: fromStage + 1, outstandingQuestions };
}

/**
 * Non-linear revision: jump the stage pointer to any valid stage without
 * re-running gate checks. Gating (checkStageGate/advanceStage) only
 * protects *forward* advancement; revisiting an earlier stage to reopen a
 * discussion doesn't need its entry criteria re-validated. Actually
 * changing a Confirmed element once there is canonStore's job (throws
 * CanonConflictError without allowConfirmedOverride) - this function only
 * moves the pointer.
 */
export function jumpToStage(targetStage: number): number {
  getStageDefinition(targetStage); // throws on an invalid stage number
  return targetStage;
}

/**
 * Elements that would be affected if `elementId` changes - what issue #10
 * (Conflict Resolution) shows the author before letting a revision to a
 * Confirmed element through.
 */
export async function listDownstreamImpact(storyId: string, elementId: string): Promise<CanonElement[]> {
  return listDependents(storyId, elementId);
}
