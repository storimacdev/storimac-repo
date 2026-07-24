import type { CanonElement, DepthMode } from "./types";
import { listDependents } from "./canonStore";

/**
 * 8-stage FSM — GitHub issue #7, PRD §5.4/§5.5. Project-1-specific (unlike
 * the rest of canonEngine/, which is generic across Projects 1-4) since the
 * stage list and required elements are Project 1's own workflow.
 *
 * Scope boundary, stated plainly: this module gates *forward advancement*
 * and computes depth defaults. It does not itself run Stage 7's audit logic
 * (issue #16) or the Conflict Resolution 3-way choice (issue #10) - it
 * exposes listDownstreamImpact for #10 to use, and leaves Stage 7's gate
 * intentionally empty (systemRun: true) for #16 to extend.
 */

export interface StageDefinition {
  stage: number;
  name: string;
  requiredElementIds: string[];
  /** Stage 7: no author-facing required elements: gating comes from the audit issue, not this FSM. */
  systemRun?: boolean;
}

export const PROJECT1_STAGES: StageDefinition[] = [
  {
    stage: 1,
    name: "Discover the Story",
    requiredElementIds: ["concept", "inspiration", "target_audience", "emotional_engine"],
  },
  {
    stage: 2,
    name: "Diagnose Story Format",
    // supporting_formats is 0-2, optional - only primary_format is a hard gate.
    requiredElementIds: ["primary_format"],
  },
  {
    stage: 3,
    name: "Build the Core Story",
    requiredElementIds: [
      "genre",
      "subgenre",
      "tone",
      "style",
      "audience",
      "scale",
      "core_dramatic_question",
      "theme_statement",
    ],
  },
  {
    stage: 4,
    name: "Build the Dramatic Engine",
    requiredElementIds: [
      "protagonist",
      "antagonistic_force",
      "central_conflict",
      "primary_stakes",
      "transformation_arc",
    ],
  },
  {
    stage: 5,
    name: "Define the Story World",
    requiredElementIds: ["time_period", "primary_settings", "environmental_rules", "premise_assumptions"],
  },
  {
    stage: 6,
    name: "Build the Story Spine",
    requiredElementIds: [
      "opening_image",
      "inciting_incident",
      "first_turning_point",
      "midpoint",
      "second_turning_point",
      "climax",
      "closing_image",
    ],
  },
  {
    stage: 7,
    name: "Creative Audit & Pitfall Check",
    requiredElementIds: [],
    systemRun: true,
  },
  {
    stage: 8,
    name: "Generate Story Foundation Document",
    requiredElementIds: [],
  },
];

// Coarse per-stage default, PRD §5.5's "Default depth" column.
const STAGE_DEFAULT_DEPTH: Record<number, DepthMode> = {
  1: "Develop",
  2: "Develop",
  3: "Refine",
  4: "Develop",
  5: "Refine",
  6: "Develop",
  7: "Confirm",
  8: "Confirm",
};

// Per-element overrides, PRD §5.4's own worked examples - more specific
// than the coarse stage-level default above, and wins over it.
const ELEMENT_DEPTH_OVERRIDES: Record<string, DepthMode> = {
  // "Confirm - fast validation only (e.g., genre label, title, audience)"
  genre: "Confirm",
  subgenre: "Confirm",
  audience: "Confirm",
  scale: "Confirm",
  // "Refine - build on an established idea with 1-2 sharp questions (e.g., tone, stakes)"
  tone: "Refine",
  style: "Refine",
  primary_stakes: "Refine",
  // "Develop - dive deep, challenge assumptions (e.g., format diagnosis, dramatic engine, story spine)"
  primary_format: "Develop",
  core_dramatic_question: "Develop",
  theme_statement: "Develop",
  protagonist: "Develop",
  antagonistic_force: "Develop",
  central_conflict: "Develop",
  transformation_arc: "Develop",
};

export function getDefaultDepthMode(stage: number, elementId: string): DepthMode {
  return ELEMENT_DEPTH_OVERRIDES[elementId] ?? STAGE_DEFAULT_DEPTH[stage] ?? "Refine";
}

export function getStageDefinition(stage: number): StageDefinition {
  const def = PROJECT1_STAGES.find((s) => s.stage === stage);
  if (!def) throw new Error(`Unknown stage: ${stage}`);
  return def;
}

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
