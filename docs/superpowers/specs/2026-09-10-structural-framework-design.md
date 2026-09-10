# Structural Framework Module (Issue #58) — Design

## Problem

Issue #58 requires the 10-Step Cinematic Narrative Structure (Screenplay
Structural Architecture Framework v3.0 §4) to be hard-coded verbatim —
not re-derived or paraphrased at runtime — and made available to two
future consumers: the development-loop validation logic (issue #59) and
the scene-formatting logic (issue #66).

No Project 4 chat agent or system prompt exists yet — only
`web/src/lib/storyArchitectureEngine/ingestCanon.ts` (issue #55). So
"hard-coded... into the agent's system prompt/config" (AC1) has no
system-prompt file to land in today. AC2 and AC3's own wording ("exposed
to the validation logic," "exposed as a lookup") are both
programmatic-consumption phrases, not prose-consumption phrases.

**Decision (confirmed):** this issue produces a typed TypeScript
constants module — no markdown system prompt is written yet. Whichever
future issue builds Project 4's own system prompt will quote this
module's data verbatim rather than re-typing it, the same way this
module quotes the framework doc verbatim rather than paraphrasing it.

## Scope boundary

This module covers **only** Framework v3.0 §4 (the 10-Step structure and
its critical beats). Explicitly out of scope, each belonging to its own
already-filed issue:
- §2 Screenplay Scale & Dynamic Scene Density Monitoring — issue #56.
- §5 Non-Sequential Interview & Discovery Routing (the Blueprint
  Priority Route, Chronological Route, Custom Steering) — issues #59/#61.
- §6 Pre-Compilation Audit — issue #91.

Those issues' future implementations will import from this module
(e.g. #59's Blueprint Priority Route needs to know which step is "The
Frame" vs "The Final Image"; #66's scene-formatting needs the critical
beat lookup) rather than re-deriving structure this module already
defines.

## Architecture

New file: `web/src/lib/storyArchitectureEngine/structuralFramework.ts`,
following this codebase's existing registry-constant convention
(`characterEngine/factRegistry.ts`, `canonEngine/elementRegistry.ts`): a
header JSDoc citing the framework section, then plain typed `const`
arrays with inline comments grouping by Act.

### Types

```ts
export type ActId = "1" | "2A" | "2B" | "3";
export type StepType = "Plot Point" | "Set Piece";

export interface StructuralAct {
  id: ActId;
  name: string;       // e.g. "THE THESIS"
  subtitle: string;   // e.g. "Status Quo & Disruption"
  stepNumbers: number[];
}

export interface CriticalBeat {
  tag: string;                  // verbatim bracket content, e.g. "THE FRAME"
  placementMark: string | null; // e.g. "~5% mark", "50% mark", "Scene 1", "Final Scene"; null when the framework gives no explicit mark
}

export interface FinalePhase {
  order: number;                     // 1-5
  name: string;                      // e.g. "Gathering Team/Tools"
  criticalBeat: CriticalBeat | null;  // only phase 4 ("Dig Deep Down") has one
}

export interface StructuralStep {
  stepNumber: number;            // 1-10, overall sequence
  actId: ActId;
  type: StepType;
  pointNumber: number;           // Plot Point N or Set Piece N (numbered independently per type)
  title: string;                 // e.g. "The Frame (Opening Image)"
  corePurpose: string;           // verbatim descriptive prose (see "Verbatim text handling" below)
  placementMark: string | null;  // only when the framework states a mark directly on the step itself
  criticalBeats: CriticalBeat[]; // 0 or 1 entries for every step
  finalePhases: FinalePhase[] | null; // only Step 9 (the Finale's 5 required sequential phases)
}
```

### Data

```ts
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

### Derived lookup (AC3)

```ts
export interface CriticalBeatLookupEntry {
  tag: string;
  stepNumber: number;
  actId: ActId;
  placementMark: string | null;
}

export const CRITICAL_BEAT_LOOKUP: Record<string, CriticalBeatLookupEntry> = buildCriticalBeatLookup();
```

`CRITICAL_BEAT_LOOKUP` is **derived**, not hand-authored: a
`buildCriticalBeatLookup()` function (private to this module) flattens
every step's `criticalBeats` array (each step contributes exactly one
entry), keyed by `tag`. Because there is only one place
(`STRUCTURAL_STEPS`) where beat data is actually written down, the
lookup can never drift out of sync with the steps array.

**Revision note (final review):** an earlier draft of this paragraph
said the builder also walks Step 9's `finalePhases[3].criticalBeat`.
The shipped implementation doesn't need to: every step's top-level
`criticalBeats` array — including Step 9's — already carries that
step's one beat, so folding only over `criticalBeats` already covers
all 10 tags. `finalePhases` exists purely to describe the Finale's
required phase ordering for a future reader/consumer; it is not a
second data source the lookup needs to fold over. The implementation
plan's manual-trace verification confirms the resulting lookup has
exactly 10 entries, matching AC3's "the 10 tags."

## Verbatim text handling

`corePurpose` preserves the framework's descriptive prose essentially
unedited, with one narrow, disclosed exception: a **freestanding
placement parenthetical** at the end of a sentence — e.g. `(~5% mark)`,
`(~10% mark)`, `(~20% mark)` — is removed from the prose string because
it is now represented structurally in `placementMark` /
`criticalBeats[].placementMark`. This is restructuring redundant
metadata, not paraphrasing substantive content: nothing about *what a
step or beat does* changes, only where its percentage-mark annotation
lives. Two things are deliberately **not** touched:
- **Inline `[CRITICAL BEAT: ...]` bracket mentions** inside a sentence
  (e.g. Step 2's "Contains the `[CRITICAL BEAT: THEMATIC CORE]` where...")
  stay in the prose exactly as written, even though the same tag is also
  captured structurally in `criticalBeats[]` — unlike the percentage
  mark, this bracket is grammatically load-bearing in the sentence, and
  removing it would mean rewriting the sentence, not just extracting a
  parenthetical.
- **Substantive parentheticals** that describe content rather than
  placement — e.g. Step 9's `(overcoming core flaw at source via theme)`
  — are left untouched; only placement/percentage annotations are
  extracted.

Step 6 and Step 9 have no freestanding placement parenthetical to strip
in their Core Purpose prose at all. Step 6's `"50% mark"` is
corroborated by the framework's own Core Purpose prose ("Central 50%
pivot point where plot and theme cross paths...") and stated as an
explicit parenthetical in issue #58's own AC1 text — it is the one
placement mark not mechanically extractable from a parenthetical in the
Core Purpose text itself, unlike Steps 2/3/4/5/7/8. Step 9's Finale has
no percentage anywhere in either source document. Both steps'
`corePurpose` strings are transcribed as-is, with nothing stripped.

## Why this satisfies each acceptance criterion

- **AC1 (all 10 steps hard-coded verbatim, grouped under their 4 named
  Acts):** `STRUCTURAL_STEPS` has exactly 10 entries in framework order,
  each with an `actId` linking it to its `StructuralAct`; `corePurpose`
  and `title` text is the framework's own wording (see "Verbatim text
  handling" above for the one disclosed, meaning-preserving exception).
- **AC2 (Core Purpose + placement guidance exposed to validation
  logic):** every `StructuralStep` carries both fields directly; issue
  #59's future development-loop logic reads `STRUCTURAL_STEPS` (or
  `STRUCTURAL_ACTS` for act-level grouping) with no parsing needed.
- **AC3 (the 10 critical beat tags exposed as a lookup):**
  `CRITICAL_BEAT_LOOKUP` is exactly that — issue #66's future
  scene-formatting logic looks up a tag to find which step/act it
  belongs to and its placement mark.

## Edge cases

- **A step with no step-level placement mark** (Steps 2, 4, 5, 7, 8, 9):
  `placementMark: null` at the step level is correct and expected — the
  framework only gives a mark for the step's *nested* critical beat (or,
  for Step 9, no mark at all), not for the Set Piece as a whole.
- **A critical beat with no explicit percentage** (Step 9's `DIG DEEP
  DOWN`): `placementMark: null` rather than inventing an estimate — the
  framework doesn't give one, and this module never invents canon it
  wasn't handed.
- **Step 9's finale phases 1, 2, 3, 5** (no critical beat): `criticalBeat:
  null` — only phase 4 ("Dig Deep Down") carries one, matching the
  framework's own "5 required sequential phases" where only one is
  earmarked.

## Out of scope

- No system-prompt markdown file (`sp04-*.md` or similar) — see
  "Decision" above; a future issue building Project 4's chat agent will
  consume this module's exports rather than this issue re-typing the
  same content as prose.
- No scene density thresholds (§2), routing options (§5), or
  pre-compilation audit checks (§6) — each belongs to its own already-
  filed issue (#56, #59/#61, #91 respectively) and will import from this
  module rather than this module reaching into their scope.
- No validation logic itself (checking whether an author's outline
  actually satisfies placement/order) — that's issue #59's development
  loop, consuming this module's data, not this module's job to enforce.
