/**
 * The 10-Step Cinematic Narrative Structure — GitHub issue #58,
 * Screenplay Structural Architecture Framework v3.0 §4. Hard-coded
 * verbatim, grouped under its 4 named Acts, never re-derived or
 * paraphrased at runtime (issue #58's AC1). See
 * docs/superpowers/specs/2026-09-10-structural-framework-design.md for
 * the one disclosed exception (freestanding placement parentheticals
 * extracted into `placementMark` fields instead of left inline).
 *
 * Scope: only Framework v3.0 §4. Scene-density monitoring (§2) is issue
 * #56; non-sequential routing (§5) is issues #59/#61; the
 * pre-compilation audit (§6) is issue #91 — none of that belongs here.
 */

export type ActId = "1" | "2A" | "2B" | "3";
export type StepType = "Plot Point" | "Set Piece";

export interface StructuralAct {
  id: ActId;
  name: string;
  subtitle: string;
  stepNumbers: number[];
}

export interface CriticalBeat {
  tag: string;
  placementMark: string | null;
}

export interface FinalePhase {
  order: number;
  name: string;
  criticalBeat: CriticalBeat | null;
}

export interface StructuralStep {
  stepNumber: number;
  actId: ActId;
  type: StepType;
  pointNumber: number;
  title: string;
  corePurpose: string;
  placementMark: string | null;
  criticalBeats: CriticalBeat[];
  finalePhases: FinalePhase[] | null;
}

export const STRUCTURAL_ACTS: StructuralAct[] = [
  { id: "1", name: "THE THESIS", subtitle: "Status Quo & Disruption", stepNumbers: [1, 2, 3] },
  { id: "2A", name: "THE INVERSION", subtitle: "Exploration & Trial", stepNumbers: [4, 5] },
  { id: "2B", name: "THE DESCENT", subtitle: "Pressure & Collapse", stepNumbers: [6, 7] },
  { id: "3", name: "THE SYNTHESIS", subtitle: "Rebirth & Triumph", stepNumbers: [8, 9, 10] },
];

export const STRUCTURAL_STEPS: StructuralStep[] = [
  // ACT 1: THE THESIS
  {
    stepNumber: 1,
    actId: "1",
    type: "Plot Point",
    pointNumber: 1,
    title: "The Frame (Opening Image)",
    corePurpose:
      "Active visual snapshot demonstrating the hero's flawed life and zone of comfort. Establishes visual style, tone, and mood through behavior in motion—no data dumps or internal monologues.",
    placementMark: "Scene 1",
    criticalBeats: [{ tag: "THE FRAME", placementMark: "Scene 1" }],
    finalePhases: null,
  },
  {
    stepNumber: 2,
    actId: "1",
    type: "Set Piece",
    pointNumber: 1,
    title: "World Building & Core Premise (Setup / Theme Stated)",
    corePurpose:
      'Explores the status quo world, external plot cast, and superficial "Want." Itemizes problems and severe stakes if static. Contains the [CRITICAL BEAT: THEMATIC CORE] where an ally or environment states the life lesson, which the hero blindly dismisses.',
    placementMark: null,
    criticalBeats: [{ tag: "THEMATIC CORE", placementMark: "~5% mark" }],
    finalePhases: null,
  },
  {
    stepNumber: 3,
    actId: "1",
    type: "Plot Point",
    pointNumber: 2,
    title: "The Spark (Catalyst)",
    corePurpose:
      "External, life-changing action beat targeting the hero that shatters status quo and makes returning to old life structurally impossible.",
    placementMark: "~10% mark",
    criticalBeats: [{ tag: "THE SPARK", placementMark: "~10% mark" }],
    finalePhases: null,
  },
  // ACT 2A: THE INVERSION
  {
    stepNumber: 4,
    actId: "2A",
    type: "Set Piece",
    pointNumber: 2,
    title: "The Crossroads & Gateway (Debate / Break into 2)",
    corePurpose:
      'Processing the spark via hesitation and weighing options. Concludes with the single-scene [CRITICAL BEAT: BREAK INTO 2], where the hero proactively crosses into the unfamiliar world pursuing the "Want" via a wrong solution.',
    placementMark: null,
    criticalBeats: [{ tag: "BREAK INTO 2", placementMark: "~20% mark" }],
    finalePhases: null,
  },
  {
    stepNumber: 5,
    actId: "2A",
    type: "Set Piece",
    pointNumber: 3,
    title: "The Crux (Fun and Games / B Story)",
    corePurpose:
      'Delivers the "promise of the premise" and core cinematic hooks using alternating high/low beats. Features [CRITICAL BEAT: B STORY INTRO], introducing the theme ambassador who guides internal transformation.',
    placementMark: null,
    criticalBeats: [{ tag: "B STORY INTRO", placementMark: "~22% mark" }],
    finalePhases: null,
  },
  // ACT 2B: THE DESCENT
  {
    stepNumber: 6,
    actId: "2B",
    type: "Plot Point",
    pointNumber: 3,
    title: "The Illusory Peak (Midpoint)",
    corePurpose:
      "Central 50% pivot point where plot and theme cross paths. Yields a false victory/defeat, escalates stakes, and forces a public declaration or demonstration of a new way of being.",
    placementMark: "50% mark",
    criticalBeats: [{ tag: "MIDPOINT", placementMark: "50% mark" }],
    finalePhases: null,
  },
  {
    stepNumber: 7,
    actId: "2B",
    type: "Set Piece",
    pointNumber: 4,
    title: "The Escalating Pressure (Bad Guys Close In / All Is Lost)",
    corePurpose:
      'Downward spiral driven by unaddressed flaws sabotaging relationships. Concludes with the devastating [CRITICAL BEAT: ALL IS LOST], underscored by a literal or figurative "Whiff of Death" that destroys the old identity.',
    placementMark: null,
    criticalBeats: [{ tag: "ALL IS LOST", placementMark: "~75% mark" }],
    finalePhases: null,
  },
  // ACT 3: THE SYNTHESIS
  {
    stepNumber: 8,
    actId: "3",
    type: "Set Piece",
    pointNumber: 5,
    title: "The Crucible (Dark Night of the Soul / Break into 3)",
    corePurpose:
      'Hopeless reaction phase. Hero returns to familiar spaces, realizing they no longer fit. Triggers an inner epiphany resulting in the single-scene [CRITICAL BEAT: BREAK INTO 3] to fix things the right way using the internal "Need."',
    placementMark: null,
    criticalBeats: [{ tag: "BREAK INTO 3", placementMark: "~80% mark" }],
    finalePhases: null,
  },
  {
    stepNumber: 9,
    actId: "3",
    type: "Set Piece",
    pointNumber: 6,
    title: "The Triumph (Finale)",
    corePurpose:
      "Multi-scene climax executing 5 required sequential phases: (1) Gathering Team/Tools, (2) Executing Plan, (3) High Tower Surprise, (4) [CRITICAL BEAT: DIG DEEP DOWN] (overcoming core flaw at source via theme), and (5) Execution of New Plan.",
    placementMark: null,
    criticalBeats: [{ tag: "DIG DEEP DOWN", placementMark: null }],
    finalePhases: [
      { order: 1, name: "Gathering Team/Tools", criticalBeat: null },
      { order: 2, name: "Executing Plan", criticalBeat: null },
      { order: 3, name: "High Tower Surprise", criticalBeat: null },
      { order: 4, name: "Dig Deep Down", criticalBeat: { tag: "DIG DEEP DOWN", placementMark: null } },
      { order: 5, name: "Execution of New Plan", criticalBeat: null },
    ],
  },
  {
    stepNumber: 10,
    actId: "3",
    type: "Plot Point",
    pointNumber: 4,
    title: "The New Baseline (Final Image)",
    corePurpose:
      "Single visual scene providing direct visual proof of permanent transformation. Acts as a stark visual opposite to the Opening Image.",
    placementMark: "Final Scene",
    criticalBeats: [{ tag: "FINAL IMAGE", placementMark: "Final Scene" }],
    finalePhases: null,
  },
];
