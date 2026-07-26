import type { DepthMode } from "./types";

/**
 * Pure stage-definition data for Project 1's 8-stage workflow — split out of
 * stageFsm.ts so client components (the Canon side panel, issue #11) can
 * import it without dragging stageFsm's server-only canonStore/firebaseAdmin
 * dependency chain into the client bundle. stageFsm re-exports everything
 * here, so server code keeps importing from stageFsm unchanged.
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
