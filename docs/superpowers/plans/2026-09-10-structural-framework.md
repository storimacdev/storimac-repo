# Structural Framework Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-code Screenplay Structural Architecture Framework v3.0 §4
(the 10-Step Cinematic Narrative Structure) as a typed TypeScript
constants module for Project 4 (issue #58) — no system prompt or chat
agent exists yet, so this issue produces the structured data future
issues (#59 validation, #66 scene-formatting) will consume.

**Architecture:** One new file, `web/src/lib/storyArchitectureEngine/structuralFramework.ts`,
following the existing registry-constant convention
(`characterEngine/factRegistry.ts`, `canonEngine/elementRegistry.ts`):
typed interfaces, then a plain `const` array of 4 Acts, then a plain
`const` array of 10 Steps (the framework's own text, transcribed
verbatim per the design's disclosed exception for freestanding
placement parentheticals), then a small derived lookup built by folding
over the steps array — never hand-duplicated.

**Tech Stack:** TypeScript. No test runner is configured in this repo
(`npm test` has no script) — verification is `npm run lint` (must be
clean), `npm run build` (must succeed), and manual/code-trace
verification against concrete expected values, matching every other
feature in this codebase.

## Global Constraints

- This module covers **only** Framework v3.0 §4 (the 10-Step structure
  and its critical beats). No scene-density thresholds (§2, issue #56),
  routing options (§5, issues #59/#61), or pre-compilation audit checks
  (§6, issue #91) belong in this file.
- `corePurpose` text is the framework's own wording, verbatim, with one
  disclosed exception: a freestanding trailing placement parenthetical
  (e.g. `(~5% mark)`) is omitted because it's represented structurally
  in `placementMark`/`criticalBeats[].placementMark` instead. Inline
  `[CRITICAL BEAT: ...]` bracket mentions that are grammatically part of
  a sentence, and substantive (non-placement) parentheticals, are never
  touched.
- `CRITICAL_BEAT_LOOKUP` must be derived by folding over
  `STRUCTURAL_STEPS` — never a second, independently hand-typed literal
  — so the two can never drift out of sync.
- No LLM call, no Firestore read/write, no import from any other
  project's engine module — this is pure, static, in-memory data.

---

### Task 1: Types, Acts, and the 10 Steps

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/structuralFramework.ts`

**Interfaces:**
- Produces (used by Task 2): `export type ActId = "1" | "2A" | "2B" | "3";`; `export interface CriticalBeat { tag: string; placementMark: string | null; }`; `export interface FinalePhase { order: number; name: string; criticalBeat: CriticalBeat | null; }`; `export interface StructuralStep { stepNumber: number; actId: ActId; type: "Plot Point" | "Set Piece"; pointNumber: number; title: string; corePurpose: string; placementMark: string | null; criticalBeats: CriticalBeat[]; finalePhases: FinalePhase[] | null; }`; `export const STRUCTURAL_STEPS: StructuralStep[]` (10 entries, in stepNumber order 1-10).

- [ ] **Step 1: Create the file with types, `STRUCTURAL_ACTS`, and `STRUCTURAL_STEPS`**

```ts
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
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings).
Run `npm run build` from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these against the file by hand:

- **Exactly 10 steps, exactly 4 acts:** `STRUCTURAL_STEPS.length === 10`,
  `STRUCTURAL_ACTS.length === 4`.
- **Every `stepNumber` 1-10 appears exactly once** across
  `STRUCTURAL_STEPS`, in that order (`STRUCTURAL_STEPS[i].stepNumber ===
  i + 1` for every index).
- **`STRUCTURAL_ACTS`' `stepNumbers` partition 1-10 with no gaps or
  overlaps:** concatenating all four acts' `stepNumbers` arrays in
  order (`[1,2,3]`, `[4,5]`, `[6,7]`, `[8,9,10]`) yields `[1,2,...,10]`.
- **Every step's `actId` matches the act that lists its `stepNumber`:**
  e.g. step 4's `actId: "2A"` and `STRUCTURAL_ACTS` entry `"2A"` lists
  `4` in its `stepNumbers` — spot-check all 10.
- **`pointNumber` sequences are independently correct per type:** Plot
  Points in step order are numbered 1, 2, 3, 4 (steps 1, 3, 6, 10); Set
  Pieces in step order are numbered 1, 2, 3, 4, 5, 6 (steps 2, 4, 5, 7,
  8, 9).
- **Step 9 is the only step with non-null `finalePhases`,** and it has
  exactly 5 entries in `order` 1-5, with `criticalBeat` non-null only on
  the entry with `order: 4` (`name: "Dig Deep Down"`).
- **Every step's `criticalBeats` array has exactly 0 or 1 entries** (in
  this framework, every step has exactly 1) — confirm none are empty
  and none have more than 1.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/structuralFramework.ts
git commit -m "feat: hard-code the 10-Step Cinematic Narrative Structure (Framework v3.0 §4)"
```

---

### Task 2: Derived critical-beat lookup

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/structuralFramework.ts`

**Interfaces:**
- Consumes: `STRUCTURAL_STEPS` (Task 1).
- Produces (the module's remaining public API, consumed by future issue
  #66's scene-formatting logic): `export interface CriticalBeatLookupEntry { tag: string; stepNumber: number; actId: ActId; placementMark: string | null; }`; `export const CRITICAL_BEAT_LOOKUP: Record<string, CriticalBeatLookupEntry>`.

- [ ] **Step 1: Add the lookup type, builder, and export**

Add at the end of the file, after `STRUCTURAL_STEPS`:

```ts
export interface CriticalBeatLookupEntry {
  tag: string;
  stepNumber: number;
  actId: ActId;
  placementMark: string | null;
}

/**
 * Derived from `STRUCTURAL_STEPS` — never hand-duplicated, so it can't
 * drift out of sync (issue #58's AC3: "the 10 tags exposed as a
 * lookup"). Every step's own `criticalBeats` array already carries
 * every one of the 10 tags (including Step 9's, which also appears in
 * `finalePhases[3].criticalBeat` for phase-ordering detail that this
 * lookup doesn't need) - folding only over `criticalBeats` is
 * sufficient and simpler than also walking `finalePhases`.
 */
function buildCriticalBeatLookup(): Record<string, CriticalBeatLookupEntry> {
  const lookup: Record<string, CriticalBeatLookupEntry> = {};
  for (const step of STRUCTURAL_STEPS) {
    for (const beat of step.criticalBeats) {
      lookup[beat.tag] = {
        tag: beat.tag,
        stepNumber: step.stepNumber,
        actId: step.actId,
        placementMark: beat.placementMark,
      };
    }
  }
  return lookup;
}

export const CRITICAL_BEAT_LOOKUP: Record<string, CriticalBeatLookupEntry> = buildCriticalBeatLookup();
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings).
Run `npm run build` from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

- **Exactly 10 keys:** `Object.keys(CRITICAL_BEAT_LOOKUP).length === 10`.
- **All 10 expected tags are present:** `"THE FRAME"`, `"THEMATIC CORE"`,
  `"THE SPARK"`, `"BREAK INTO 2"`, `"B STORY INTRO"`, `"MIDPOINT"`,
  `"ALL IS LOST"`, `"BREAK INTO 3"`, `"DIG DEEP DOWN"`, `"FINAL IMAGE"`.
- **Spot-check 3 entries' full shape:**
  - `CRITICAL_BEAT_LOOKUP["MIDPOINT"]` → `{ tag: "MIDPOINT", stepNumber: 6, actId: "2B", placementMark: "50% mark" }`.
  - `CRITICAL_BEAT_LOOKUP["DIG DEEP DOWN"]` → `{ tag: "DIG DEEP DOWN", stepNumber: 9, actId: "3", placementMark: null }`.
  - `CRITICAL_BEAT_LOOKUP["THEMATIC CORE"]` → `{ tag: "THEMATIC CORE", stepNumber: 2, actId: "1", placementMark: "~5% mark" }`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/structuralFramework.ts
git commit -m "feat: add derived critical-beat lookup to structural framework module"
```
