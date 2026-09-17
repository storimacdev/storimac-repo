# P4 Dynamic Scene Density & Pacing Monitor — Design Spec

GitHub issue: #56 ("[P4] Implement Dynamic Scene Density & Pacing Monitor")
PRD refs: Screenplay Structural Architecture Framework v3.0 §2 (Screenplay Scale & Dynamic
Scene Density Monitoring); supersedes original PRD §7.2 FR-2.1-2.3, Appendix A (the old
upfront Complexity Level / scene-budget-table framing no longer applies).

## Problem

Standard feature screenplays target 75-150 scenes. Nothing in P4 currently tracks this as the
outline develops, so an author could build an outline that's badly under- or over-scaled with
no feedback until much later (or never, since there's no compiler-time audit of this either —
that's issue #91's Scale Check, a pre-compile gate; this issue is the earlier, silent,
in-process monitor the framework doc explicitly separates from it).

## Design

### 1. What counts as a "planned scene"

Every `StructuralUnit` (`stateLedger.ts`), regardless of its `type` label (`Scene` / `Sequence`
/ `SetPiece` / `PlotPoint`), already represents exactly one physical scene entry: one slugline +
one 3-4 sentence paragraph, per #66's Scene Register format enforcement. `type` is a narrative
categorization, not a multiplier — a unit typed `SetPiece` is not itself several scenes; a step
that needs several scenes (e.g. Step 9's 5-phase finale) is realized as several separate
`StructuralUnit`s, each with its own `unitId`. So a straight count of units is the correct scene
signal — no new unit-bundling logic needed.

A unit counts toward the "planned scenes" total only when its status is `Working` or
`Confirmed`. `Exploring` (raw brainstorming, may never stick) and `Parked` (explicitly deferred)
are excluded — this matches the system prompt's own framing of `Working` as "provisional" and
`Exploring` as "brainstorming," and keeps the monitor from reacting to churn during idea
generation.

### 2. Trajectory: routing-order-agnostic, not percent- or sequence-based

The framework's own recommended default routing (Option A, Blueprint Priority) develops the
four anchor points (Frame, Final Image, Spark, Midpoint — steps 1, 10, 3, 6) before the six Set
Pieces, explicitly out of numeric order. Neither `stepNumber` order nor a linear 0-100% position
is a safe proxy for "how far through the outline development is" under this routing style, so
the monitor can't extrapolate off either.

Instead, coverage is measured by **how many of the 10 structural steps currently have at least
one counted scene** — this is order-agnostic: touching steps 1, 10, 3, 6 first covers exactly as
much ground as touching 1, 2, 3, 4 first.

```
stepsWithContent = number of distinct stepNumbers (1-10) with >= 1 counted unit
projectedTotal   = count / (stepsWithContent / 10)     [only when stepsWithContent >= 2]
```

The `>= 2` floor avoids extrapolating wildly off a single step's density (e.g. one dense Set
Piece step alone isn't representative of the other nine). This assumes roughly uniform scene
density across the 10 steps, which isn't literally true (Step 9's 5-phase finale is denser than
a single Plot Point step) — a disclosed approximation, same class as `checkPlacementDeviation`'s
percent-parsing and `checkSceneRegisterFormat`'s sentence-counting, both already accepted in
this codebase.

**Alert thresholds:**
- `projectedTotal < 75` -> `"under"` (potential pacing gaps, rushed transitions, missing
  escalation beats — suggest additional sub-sequences).
- `projectedTotal > 150` -> `"over"` (potential episodic bloat, pacing stalls — suggest scene
  mergers or streamlining).
- Otherwise, or when `stepsWithContent < 2`, no alert.

### 3. Persisting per-unit step attribution

`stateLedger.ts`'s `StructuralUnit` gains one field:

```ts
export interface StructuralUnit {
  // ...existing fields unchanged...
  stepNumber: number | null;
}
```

`createUnit` initializes it `null`. A new pure updater:

```ts
export function setUnitStepNumber(unit: StructuralUnit, stepNumber: number, now?: string): StructuralUnit
```

`architecture-chat/route.ts` calls this alongside its existing `setUnitContent`/`addCanonRefs`
calls, but **only when `proposed.active_step_number !== null`** for that turn — a turn with no
active step leaves a unit's existing `stepNumber` untouched rather than clearing it. This mirrors
the same "never silently downgrade known state" discipline `setCausalTag` already follows.

### 4. New pure module: `sceneDensity.ts`

A new file, not folded into `developmentLoop.ts` (already 310 lines covering three unrelated
gates — Core-Purpose's status-list constant, the causal gate, and the format check). Scene
density is a fully separate concern: advisory-only, never gates a status transition, and reads
the *whole* units array rather than a single turn's delta.

```ts
export interface SceneDensityReading {
  count: number;
  projectedTotal: number | null;
  rawAlert: "under" | "over" | null;
}

export function computeSceneDensity(units: StructuralUnit[]): SceneDensityReading

export interface SceneDensityDismissal {
  under: boolean;
  over: boolean;
}

export interface SceneDensityResult extends SceneDensityReading {
  alert: "under" | "over" | null; // rawAlert with dismissal applied
}

export function applySceneDensityDismissal(
  reading: SceneDensityReading,
  dismissal: SceneDensityDismissal
): SceneDensityResult

/** The dismissal state to persist going forward: auto-resets a direction's
 * dismissal once that direction's condition is no longer true, so a later
 * recurrence of the same alert isn't permanently suppressed by an old click. */
export function nextSceneDensityDismissal(
  reading: SceneDensityReading,
  dismissal: SceneDensityDismissal
): SceneDensityDismissal
```

`nextSceneDensityDismissal` is the one function with a side-effect-relevant output (route.ts
persists its result when it differs from the stored value); the rest are pure display logic,
callable from both the chat route and the read-only canvas GET route without duplicating
threshold math in two places.

### 5. Storage: `Story.p4SceneDensityDismissal`

`canonEngine/storyStore.ts` adds:

```ts
export interface Story {
  // ...existing fields...
  p4SceneDensityDismissal?: { under: boolean; over: boolean };
}

export async function setP4SceneDensityDismissal(
  storyId: string,
  dismissal: { under: boolean; over: boolean }
): Promise<void>
```

Defaults to `{ under: false, over: false }` when absent (treated as such by
`applySceneDensityDismissal`/`nextSceneDensityDismissal`, not written until the first real
change — same "don't write a default" convention `p4PendingConflict` already follows).

### 6. Wiring: strictly advisory, never touches `combinedValid`

In `architecture-chat/route.ts`, after `updatedUnits` is finalized for the turn (same point
where `pendingConflictForResponse`/`cascadeReview` are settled): compute
`computeSceneDensity(updatedUnits)`, derive the next dismissal via
`nextSceneDensityDismissal`, persist it via `setP4SceneDensityDismissal` only if it differs from
the story's current value (avoid a write on every turn when nothing changed), then compute the
displayed result via `applySceneDensityDismissal` and include it in the response as
`sceneDensity: { count, projectedTotal, alert }`.

This **never** folds into `combinedValid`/`combinedReason` — it cannot block a status
transition, matching the issue's own explicit "advisory, not blocking" requirement. It also
never touches `attemptStatusTransition`.

The canvas GET route (`workspaces/[workspaceId]/canvases/[canvasId]/route.ts`) adds one
read-only computation — `applySceneDensityDismissal(computeSceneDensity(story.p4Units ?? []), story.p4SceneDensityDismissal ?? { under: false, over: false })` — included in its response as
the same `sceneDensity` shape, so a page reload shows the current reading immediately without
waiting for the next chat turn. This route never calls `nextSceneDensityDismissal` or writes
anything — it's a pure read, matching its existing read-only character.

### 7. Dismissal endpoint

New route `api/architecture-chat/scene-density/route.ts`, `PATCH`, mirroring
`world-chat/canon-status/route.ts`'s shape (an explicit author button-click, not a chat turn):
`requireUser`, load the story, `getMembership` check, body `{ storyId, direction: "under" |
"over" }`, sets that direction's dismissal to `true` via `setP4SceneDensityDismissal`, returns
the recomputed `sceneDensity`. No `attemptStatusTransition`/gate interaction at all — this is a
pure UI-state mutation, same category as the existing PATCH route it mirrors.

### 8. UI

`ArchitectureInterview.tsx` adds `sceneDensity` state, populated both from each chat turn's
response and from the resume/hydration effect's `data.sceneDensity` (new field on the canvas GET
response). A new banner, visually distinct from the existing blocking rejection/Canon-Revision
banners (this one never halts the conversation): shows the current count, the projected total,
and which direction triggered, plus a dismiss button that calls the new PATCH route and clears
the banner locally on success.

## What's out of scope

- Any compile-time gate (issue #91's Scale Check is the pre-compilation audit; this issue is
  the earlier, silent, advisory monitor the framework doc explicitly separates from it).
- Per-Act breakdowns of the alert (the issue's "across Acts and Set Pieces" is descriptive
  framing for where density should be watched, not a requirement for a separate alert per Act —
  one running total/projection is sufficient and simpler; YAGNI).
- Any change to `sp04-sae-systemprompt.md` — this is a fully app-side, deterministic computation
  requiring no new model-reported field and no new instruction.
- Live-model verification — matches #111/#63/#64/#66's own precedent, tracked as a follow-up
  (this feature has no model-facing surface to verify beyond what already exists).

## Files touched

- Modify: `web/src/lib/storyArchitectureEngine/stateLedger.ts` (add `stepNumber` field +
  `setUnitStepNumber`)
- Create: `web/src/lib/storyArchitectureEngine/sceneDensity.ts`
- Modify: `web/src/lib/canonEngine/storyStore.ts` (add `p4SceneDensityDismissal` +
  `setP4SceneDensityDismissal`)
- Modify: `web/src/app/api/architecture-chat/route.ts` (wire computation + persistence)
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (read-only
  inclusion in response)
- Create: `web/src/app/api/architecture-chat/scene-density/route.ts` (dismiss PATCH)
- Modify: `web/src/components/ArchitectureInterview.tsx` (banner + dismiss action)

## Testing

No test suite exists in this project. Verification is `tsc --noEmit`, `npm run lint`,
`npm run build`, and a direct code trace against representative inputs: an outline with only 1
step touched (not enough data, no alert regardless of count), an under-density trajectory (e.g.
3 scenes across 2 steps -> projects to 15), a trajectory that lands inside 75-150 (e.g. 40 scenes
across 4 steps -> projects to 100, no alert), an over-density trajectory (e.g. 70 scenes across
4 steps -> projects to 175), a dismissal that persists across a simulated reload, and a
dismissal that auto-clears once the underlying condition resolves — matching #63's, #64's, and
#66's own standard.
