# P4 Dynamic Scene Density & Pacing Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #56 — silently track total planned (`Working`+`Confirmed`)
scenes as the P4 outline develops and surface an advisory (never blocking) pacing alert when the
projected total falls outside the 75-150 scene target band.

**Architecture:** A new pure module (`sceneDensity.ts`) computes a routing-order-agnostic
trajectory from the existing structural-unit ledger — "how many of the 10 steps have at least
one scene" as the coverage denominator, since the framework's default routing style develops
steps out of numeric order. `architecture-chat/route.ts` computes and persists this every turn;
a new small PATCH route lets the author dismiss one direction of the alert; the canvas resume
route exposes the same reading read-only so a page reload shows it immediately.

**Tech Stack:** Plain TypeScript pure functions, a Next.js API route (Node runtime, Firestore via
`firebase-admin`), and a React client component (`ArchitectureInterview.tsx`).

## Global Constraints

- No test suite exists in this project — verification is `npx tsc --noEmit -p .`, `npm run
  lint`, `npm run build`, and a direct code trace against representative inputs, matching every
  prior P4 issue's own standard.
- This monitor is **strictly advisory** — it must never be folded into `combinedValid`/
  `combinedReason` and must never affect `attemptStatusTransition`'s outcome. No task in this
  plan touches either of those.
- A unit counts toward "planned scenes" only when its status is `Working` or `Confirmed`.
  `Exploring` and `Parked` are excluded.
- Trajectory is `count / (stepsWithContent / 10)`, computed only once `stepsWithContent >= 2`
  (a `stepNumber` coverage count, not `proposed_position_percent` or step-number order — see the
  design spec's §2 for why order can't be used). Alert `"under"` when `< 75`, `"over"` when
  `> 150`.
- No change to `sp04-sae-systemprompt.md` and no new schema field on `ArchitectureTurnSchema` —
  this reuses the already-existing `active_step_number` field and requires nothing new from the
  model.
- Dismissal is per-direction (`under`/`over` independently) and auto-resets once that
  direction's condition is no longer true, so a later recurrence isn't permanently suppressed by
  an old dismissal.
- Design spec: `docs/superpowers/specs/2026-09-17-p4-scene-density-monitor-design.md`.

---

### Task 1: Data model & pure scene-density logic

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/stateLedger.ts`
- Modify: `web/src/lib/canonEngine/storyStore.ts`
- Create: `web/src/lib/storyArchitectureEngine/sceneDensity.ts`

**Interfaces:**
- Produces: `StructuralUnit.stepNumber: number | null` (new field) and
  `setUnitStepNumber(unit: StructuralUnit, stepNumber: number, now?: string): StructuralUnit`
  (`stateLedger.ts`).
- Produces: `Story.p4SceneDensityDismissal?: { under: boolean; over: boolean } | null` and
  `setP4SceneDensityDismissal(storyId: string, dismissal: { under: boolean; over: boolean }):
  Promise<void>` (`storyStore.ts`).
- Produces (`sceneDensity.ts`):
  ```ts
  export interface SceneDensityReading { count: number; projectedTotal: number | null; rawAlert: "under" | "over" | null; }
  export interface SceneDensityDismissal { under: boolean; over: boolean; }
  export interface SceneDensityResult extends SceneDensityReading { alert: "under" | "over" | null; }
  export const DEFAULT_SCENE_DENSITY_DISMISSAL: SceneDensityDismissal;
  export function computeSceneDensity(units: StructuralUnit[]): SceneDensityReading;
  export function applySceneDensityDismissal(reading: SceneDensityReading, dismissal: SceneDensityDismissal): SceneDensityResult;
  export function nextSceneDensityDismissal(reading: SceneDensityReading, dismissal: SceneDensityDismissal): SceneDensityDismissal;
  ```
- Consumes: `StructuralUnit` type from `./stateLedger` (this same task).

- [ ] **Step 1: Add `stepNumber` to `StructuralUnit` and `setUnitStepNumber`**

  In `web/src/lib/storyArchitectureEngine/stateLedger.ts`, the `StructuralUnit` interface
  currently reads (lines 19-27):
  ```ts
  export interface StructuralUnit {
    unitId: string;
    type: StructuralUnitType;
    status: CanonStatus;
    content: unknown;
    causalTag: CausalTag;
    canonRefs: string[];
    lastUpdated: string;
  }
  ```
  Replace it with:
  ```ts
  export interface StructuralUnit {
    unitId: string;
    type: StructuralUnitType;
    status: CanonStatus;
    content: unknown;
    causalTag: CausalTag;
    canonRefs: string[];
    /** Which of the 10 structural steps (1-10) this unit was last written
     * under - GitHub issue #56, captured from the turn's active_step_number
     * whenever content is upserted. Powers the Scene Density & Pacing
     * Monitor's routing-order-agnostic "how many of the 10 steps have
     * content" coverage measure (see sceneDensity.ts) - never inferred any
     * other way, and never cleared back to null once set (a turn with no
     * active step just leaves a unit's existing tag alone, same "never
     * silently downgrade known state" rule setCausalTag already follows). */
    stepNumber: number | null;
    lastUpdated: string;
  }
  ```

  `createUnit` (lines 35-45) currently returns a literal without `stepNumber` — add it, set to
  `null`:
  ```ts
  export function createUnit(unitId: string, type: StructuralUnitType, now?: string): StructuralUnit {
    return {
      unitId,
      type,
      status: "Exploring",
      content: null,
      causalTag: "UNVALIDATED",
      canonRefs: [],
      stepNumber: null,
      lastUpdated: nowOrDefault(now),
    };
  }
  ```

  Add this new function right after `setCausalTag` (after its closing brace, before
  `addCanonRefs`):
  ```ts
  export function setUnitStepNumber(unit: StructuralUnit, stepNumber: number, now?: string): StructuralUnit {
    return { ...unit, stepNumber, lastUpdated: nowOrDefault(now) };
  }
  ```

- [ ] **Step 2: Add `p4SceneDensityDismissal` + `setP4SceneDensityDismissal` to `storyStore.ts`**

  In `web/src/lib/canonEngine/storyStore.ts`, add this field to the `Story` interface, right
  after the existing `p1Locked?: boolean | null;` field (the last field before the interface's
  closing brace, around line 302):
  ```ts
    /**
     * Project 4's dismissed-alert state for the Scene Density & Pacing
     * Monitor (issue #56) - per-direction, since dismissing an
     * under-density alert should never suppress a later, unrelated
     * over-density one. Optional/nullable since Stories created before
     * this field existed won't have it in Firestore; absent/null is
     * treated identically to `{ under: false, over: false }` by
     * sceneDensity.ts's own DEFAULT_SCENE_DENSITY_DISMISSAL.
     */
    p4SceneDensityDismissal?: { under: boolean; over: boolean } | null;
  ```

  Add this new function right after `setP4PendingConflict` (after its closing brace, around
  line 579):
  ```ts
  /** Records Project 4's Scene Density & Pacing Monitor dismissal state
   * (issue #56) - whole-object replace, same convention as setP2State/
   * setStage7Audit. */
  export async function setP4SceneDensityDismissal(
    storyId: string,
    dismissal: { under: boolean; over: boolean }
  ): Promise<void> {
    await storiesCollection()
      .doc(storyId)
      .update({ p4SceneDensityDismissal: dismissal, updatedAt: new Date().toISOString() });
  }
  ```

- [ ] **Step 3: Create `sceneDensity.ts`**

  Create `web/src/lib/storyArchitectureEngine/sceneDensity.ts`:
  ```ts
  import type { StructuralUnit } from "./stateLedger";

  /**
   * The Dynamic Scene Density & Pacing Monitor - GitHub issue #56,
   * Screenplay Structural Architecture Framework v3.0 §2. Strictly
   * advisory: never called from anywhere near `combinedValid`/
   * `attemptStatusTransition`, and has no effect on any status
   * transition. See docs/superpowers/specs/2026-09-17-p4-scene-density-
   * monitor-design.md for why trajectory is measured by step coverage
   * rather than by `proposed_position_percent` or step-number order -
   * the framework's own recommended default routing (Blueprint Priority)
   * develops steps out of numeric order (Frame -> Final Image -> Spark ->
   * Midpoint first), so neither a linear percent nor step order is a
   * safe progress proxy.
   */

  export const MIN_TARGET_SCENES = 75;
  export const MAX_TARGET_SCENES = 150;

  /** Below this many distinct touched steps, a projection would be
   * extrapolating off too small a sample (e.g. one unusually dense Set
   * Piece step alone isn't representative of the other nine) - no
   * alert is computed at all until this floor is met. A chosen default,
   * not a sourced one, matching this codebase's own "never invent an
   * unspecified rule silently" convention (developmentLoop.ts's
   * DEVIATION_THRESHOLD_PERCENT is the same class of choice). */
  const MIN_STEPS_FOR_PROJECTION = 2;

  export interface SceneDensityReading {
    count: number;
    projectedTotal: number | null;
    rawAlert: "under" | "over" | null;
  }

  export interface SceneDensityDismissal {
    under: boolean;
    over: boolean;
  }

  export interface SceneDensityResult extends SceneDensityReading {
    alert: "under" | "over" | null;
  }

  export const DEFAULT_SCENE_DENSITY_DISMISSAL: SceneDensityDismissal = { under: false, over: false };

  /**
   * `count`: units with status Working or Confirmed. `stepsWithContent`:
   * how many distinct 1-10 stepNumbers appear among those same counted
   * units (never among Exploring/Parked ones). This assumes roughly
   * uniform scene density across the 10 steps, which isn't literally
   * true (Step 9's 5-phase finale is denser than a single Plot Point
   * step) - a disclosed approximation, same class as
   * checkPlacementDeviation's percent-parsing and
   * checkSceneRegisterFormat's sentence-counting.
   */
  export function computeSceneDensity(units: StructuralUnit[]): SceneDensityReading {
    const counted = units.filter((u) => u.status === "Working" || u.status === "Confirmed");
    const count = counted.length;
    const stepsWithContent = new Set(
      counted.map((u) => u.stepNumber).filter((n): n is number => n !== null)
    ).size;

    if (stepsWithContent < MIN_STEPS_FOR_PROJECTION) {
      return { count, projectedTotal: null, rawAlert: null };
    }

    const projectedTotal = Math.round(count / (stepsWithContent / 10));
    const rawAlert: "under" | "over" | null =
      projectedTotal < MIN_TARGET_SCENES ? "under" : projectedTotal > MAX_TARGET_SCENES ? "over" : null;

    return { count, projectedTotal, rawAlert };
  }

  /** Display logic: a direction the author has already dismissed is
   * suppressed even though the raw condition is still true. Callable
   * from a read-only context (the canvas GET route) as well as the
   * write path (architecture-chat/route.ts), so threshold math never
   * has to be duplicated between them. */
  export function applySceneDensityDismissal(
    reading: SceneDensityReading,
    dismissal: SceneDensityDismissal
  ): SceneDensityResult {
    const alert = reading.rawAlert !== null && dismissal[reading.rawAlert] ? null : reading.rawAlert;
    return { ...reading, alert };
  }

  /** The dismissal state to persist going forward: a direction stays
   * dismissed only while its own condition remains true. The moment
   * `rawAlert` is no longer "under" (whether it cleared entirely or
   * flipped to "over"), `under`'s dismissal resets to false - so a
   * later recurrence of the SAME direction surfaces fresh rather than
   * staying permanently suppressed by an old click. Only
   * architecture-chat/route.ts calls this (it is the sole writer of
   * `p4SceneDensityDismissal` besides the explicit dismiss route). */
  export function nextSceneDensityDismissal(
    reading: SceneDensityReading,
    dismissal: SceneDensityDismissal
  ): SceneDensityDismissal {
    return {
      under: reading.rawAlert === "under" ? dismissal.under : false,
      over: reading.rawAlert === "over" ? dismissal.over : false,
    };
  }
  ```

- [ ] **Step 4: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace `computeSceneDensity`/`applySceneDensityDismissal`/
  `nextSceneDensityDismissal` by hand (or a short throwaway `tsx` script) against these cases,
  building a minimal `StructuralUnit[]` for each (any `unitId`/`type`/`content`/`causalTag`/
  `canonRefs`/`lastUpdated` values are fine - only `status` and `stepNumber` matter here):

  - Empty array -> `{ count: 0, projectedTotal: null, rawAlert: null }`.
  - 3 `Working` units, only step 1 touched (all `stepNumber: 1`) -> `stepsWithContent` is 1, below
    the floor -> `{ count: 3, projectedTotal: null, rawAlert: null }` (not enough data, even
    though 3 scenes in 1 step would extrapolate to under-density).
  - 3 `Working` units across steps 1 and 2 (e.g. 2 at step 1, 1 at step 2) -> `count: 3`,
    `stepsWithContent: 2`, `projectedTotal: 15` (`3 / (2/10)`), `rawAlert: "under"`.
  - 40 `Working`/`Confirmed` units spread across exactly 4 distinct steps -> `projectedTotal: 100`,
    `rawAlert: null` (inside the 75-150 band).
  - 70 units across 4 distinct steps -> `projectedTotal: 175`, `rawAlert: "over"`.
  - A unit with `status: "Exploring"` and one with `status: "Parked"` mixed into any of the above
    sets -> confirm neither changes `count` or `stepsWithContent` at all.
  - `applySceneDensityDismissal({ rawAlert: "under", ... }, { under: true, over: false })` ->
    `alert: null`. Same reading with `{ under: false, over: false }` -> `alert: "under"`.
  - `nextSceneDensityDismissal({ rawAlert: "under", ... }, { under: true, over: false })` ->
    `{ under: true, over: false }` (stays dismissed while still under). Same dismissal but
    `rawAlert: "over"` -> `{ under: false, over: true }` (under's stale dismissal resets since
    the condition is no longer "under"; over's own dismissal flag was already false so it stays
    false — dismissal is never auto-SET, only auto-CLEARED).
    `nextSceneDensityDismissal({ rawAlert: null, ... }, { under: true, over: true })` ->
    `{ under: false, over: false }` (both reset once neither condition holds).

- [ ] **Step 5: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/stateLedger.ts web/src/lib/canonEngine/storyStore.ts web/src/lib/storyArchitectureEngine/sceneDensity.ts
  git commit -m "feat: add P4 scene-density data model and pure trajectory logic (issue #56)"
  ```

---

### Task 2: Wire into `architecture-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/architecture-chat/route.ts`

**Interfaces:**
- Consumes (Task 1): `setUnitStepNumber(unit, stepNumber, now?): StructuralUnit` from
  `stateLedger.ts`; `computeSceneDensity`, `applySceneDensityDismissal`,
  `nextSceneDensityDismissal`, `DEFAULT_SCENE_DENSITY_DISMISSAL`, `SceneDensityResult` from the
  new `sceneDensity.ts`; `setP4SceneDensityDismissal(storyId, dismissal): Promise<void>` from
  `storyStore.ts`.
- Produces: the turn response gains a `sceneDensity: SceneDensityResult` field, consumed by
  Task 4's UI.

- [ ] **Step 1: Extend the imports**

  In `web/src/app/api/architecture-chat/route.ts`, the `storyStore` import currently reads:
  ```ts
  import {
    getStory,
    normalizeP4,
    setP4OnboardingComplete,
    setP4Routing,
    setP4Units,
    setP4PendingConflict,
    appendMessage,
    listMessages,
    appendOutstandingQuestions,
    ARCHITECTURE_MESSAGES_COLLECTION,
    type P4PendingConflict,
  } from "@/lib/canonEngine/storyStore";
  ```
  Add `setP4SceneDensityDismissal` to it:
  ```ts
  import {
    getStory,
    normalizeP4,
    setP4OnboardingComplete,
    setP4Routing,
    setP4Units,
    setP4PendingConflict,
    setP4SceneDensityDismissal,
    appendMessage,
    listMessages,
    appendOutstandingQuestions,
    ARCHITECTURE_MESSAGES_COLLECTION,
    type P4PendingConflict,
  } from "@/lib/canonEngine/storyStore";
  ```

  The `stateLedger` import currently reads:
  ```ts
  import {
    createUnit,
    findUnit,
    upsertUnit,
    setUnitContent,
    addCanonRefs,
    setCausalTag,
    type StructuralUnit,
  } from "@/lib/storyArchitectureEngine/stateLedger";
  ```
  Add `setUnitStepNumber`:
  ```ts
  import {
    createUnit,
    findUnit,
    upsertUnit,
    setUnitContent,
    addCanonRefs,
    setCausalTag,
    setUnitStepNumber,
    type StructuralUnit,
  } from "@/lib/storyArchitectureEngine/stateLedger";
  ```

  Add a new import right after the `developmentLoop` import block:
  ```ts
  import {
    computeSceneDensity,
    applySceneDensityDismissal,
    nextSceneDensityDismissal,
    DEFAULT_SCENE_DENSITY_DISMISSAL,
    type SceneDensityResult,
  } from "@/lib/storyArchitectureEngine/sceneDensity";
  ```

- [ ] **Step 2: Read the pre-turn dismissal state**

  Right after this existing line (near the top of the handler):
  ```ts
    const pendingConflictBefore = story.p4PendingConflict ?? null;
  ```
  add:
  ```ts
    const sceneDensityDismissalBefore = story.p4SceneDensityDismissal ?? DEFAULT_SCENE_DENSITY_DISMISSAL;
  ```

- [ ] **Step 3: Declare the response variable with a pre-turn default**

  Right after this existing line:
  ```ts
    let cascadeReview: { id: string; description: string }[] | null = null;
  ```
  add:
  ```ts
    // Defaults to a reading of the PRE-turn units/dismissal state, so a
    // thrown error inside the try block below (caught further down)
    // still leaves the response with the last-known-good reading instead
    // of an empty/zero one - same "effective* defaults to pre-turn state"
    // convention effectiveOnboardingComplete/effectiveRouting already
    // follow above.
    let sceneDensityForResponse: SceneDensityResult = applySceneDensityDismissal(
      computeSceneDensity(units),
      sceneDensityDismissalBefore
    );
  ```

- [ ] **Step 4: Tag the unit with its step number in the ordinary-processing path**

  Inside the `else` branch that handles ordinary unit processing (not a regression, not a
  contradiction), this line currently reads:
  ```ts
            const base = existing ?? createUnit(proposed.unit_id, proposed.type);
            const withContent = addCanonRefs(setUnitContent(base, proposed.content), proposed.canon_refs);
  ```
  Replace it with:
  ```ts
            const base = existing ?? createUnit(proposed.unit_id, proposed.type);
            const contentApplied = addCanonRefs(setUnitContent(base, proposed.content), proposed.canon_refs);
            // Issue #56: never overwritten with null - a turn with no
            // active step leaves a unit's existing stepNumber untouched,
            // same "never silently downgrade known state" rule
            // setCausalTag already follows for causalTag.
            const withContent =
              delta.active_step_number !== null
                ? setUnitStepNumber(contentApplied, delta.active_step_number)
                : contentApplied;
  ```
  Every later reference to `withContent` in this branch (the causal gate call, the format
  check, `attemptStatusTransition(withContent, ...)`) stays exactly as it is — this only changes
  how `withContent` itself is built.

- [ ] **Step 5: Compute and persist the reading after the turn's state updates**

  Inside the `try` block, the onboarding/routing/unit-processing logic ends with this closing
  brace (matching the outer `if (p4.onboardingComplete) { ... }`):
  ```ts
        }
      }
    } catch (stateErr) {
  ```
  (i.e. the line `}` that closes `if (p4.onboardingComplete)`, immediately followed by the
  line `} catch (stateErr) {`). Insert this block between those two closing braces, so it is the
  last thing that runs inside the `try` — using `units` in its final post-turn state regardless
  of which branch (if any) ran above:
  ```ts

      // Issue #56, strictly advisory - computed from `units` in its final
      // state for this turn, after every branch above has had its chance
      // to change it. Never read by anything that gates a status
      // transition; this exists purely to inform the response and persist
      // dismissal-state resets.
      const sceneDensityReading = computeSceneDensity(units);
      const nextDismissal = nextSceneDensityDismissal(sceneDensityReading, sceneDensityDismissalBefore);
      if (
        nextDismissal.under !== sceneDensityDismissalBefore.under ||
        nextDismissal.over !== sceneDensityDismissalBefore.over
      ) {
        await setP4SceneDensityDismissal(storyId, nextDismissal);
      }
      sceneDensityForResponse = applySceneDensityDismissal(sceneDensityReading, nextDismissal);
  ```

- [ ] **Step 6: Add it to the response**

  The final `return NextResponse.json({...})` currently ends with:
  ```ts
        pendingConflict: pendingConflictForResponse,
        cascadeReview,
      });
  ```
  Change it to:
  ```ts
        pendingConflict: pendingConflictForResponse,
        cascadeReview,
        sceneDensity: sceneDensityForResponse,
      });
  ```

- [ ] **Step 7: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace the full turn-processing flow by hand for these cases:
  - A turn with `active_step_number: 6` and a `proposed_unit` that reaches the ordinary
    processing branch -> confirm the resulting unit (whether `attemptStatusTransition` accepts
    or rejects it) carries `stepNumber: 6`.
  - The same, but `active_step_number: null` for a unit that already had `stepNumber: 6` from a
    previous turn -> confirm `stepNumber` stays `6`, not reset to `null`.
  - A turn where `p4.onboardingComplete` is `false` (no unit processing happens at all) -> confirm
    `sceneDensityForResponse` still comes back as a valid reading of whatever `units` already
    was (the pre-turn default from Step 3), and no Firestore write to
    `p4SceneDensityDismissal` happens (dismissal before/after are identical, so the `if` in Step
    5 doesn't fire).
  - A turn that pushes the trajectory from "under" to "in range" -> confirm
    `setP4SceneDensityDismissal` is called with `{ under: false, ... }` even if `under` was
    previously `true` (the reset happens regardless of whether the author explicitly un-dismissed
    it).

- [ ] **Step 8: Commit**

  ```bash
  git add web/src/app/api/architecture-chat/route.ts
  git commit -m "feat: compute and persist P4 scene-density reading each turn (issue #56)"
  ```

---

### Task 3: Dismiss endpoint + canvas resume inclusion

**Files:**
- Create: `web/src/app/api/architecture-chat/scene-density/route.ts`
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`

**Interfaces:**
- Consumes (Task 1): `computeSceneDensity`, `applySceneDensityDismissal`,
  `DEFAULT_SCENE_DENSITY_DISMISSAL` from `sceneDensity.ts`; `getStory`,
  `setP4SceneDensityDismissal` from `storyStore.ts`.
- Produces: `PATCH /api/architecture-chat/scene-density` (body `{ storyId, direction: "under" |
  "over" }`, returns `{ sceneDensity: SceneDensityResult }`); the canvas GET response gains a
  top-level `sceneDensity: SceneDensityResult` field (a sibling of `story`, `elements`, etc., not
  nested under `story`), consumed by Task 4's resume/hydration effect.

- [ ] **Step 1: Create the dismiss route**

  Create `web/src/app/api/architecture-chat/scene-density/route.ts`:
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { requireUser } from "@/lib/session";
  import { errorResponse } from "@/lib/apiErrors";
  import { getMembership } from "@/lib/workspace/workspaceStore";
  import { getStory, setP4SceneDensityDismissal } from "@/lib/canonEngine/storyStore";
  import {
    computeSceneDensity,
    applySceneDensityDismissal,
    DEFAULT_SCENE_DENSITY_DISMISSAL,
  } from "@/lib/storyArchitectureEngine/sceneDensity";

  export const runtime = "nodejs";

  /**
   * Dismisses one direction of Project 4's Scene Density & Pacing Monitor
   * alert (issue #56) - an explicit author button-click, not a chat turn,
   * same shape as the sibling world-chat/canon-status/route.ts PATCH.
   * Only ever SETS a direction to `true`; architecture-chat/route.ts's
   * own nextSceneDensityDismissal is the only thing that ever clears one,
   * once that direction's condition is no longer true.
   */
  export async function PATCH(req: NextRequest) {
    try {
      const user = await requireUser();
      const body = await req.json().catch(() => null);
      const storyId: unknown = body?.storyId;
      const direction: unknown = body?.direction;

      if (typeof storyId !== "string" || !storyId) {
        return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
      }
      if (direction !== "under" && direction !== "over") {
        return NextResponse.json({ error: '`direction` must be "under" or "over".' }, { status: 400 });
      }

      const story = await getStory(storyId);
      if (!story) {
        return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
      }
      const membership = await getMembership(story.workspaceId, user.uid);
      if (!membership) {
        return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
      }

      const dismissalBefore = story.p4SceneDensityDismissal ?? DEFAULT_SCENE_DENSITY_DISMISSAL;
      const dismissal = { ...dismissalBefore, [direction]: true };
      await setP4SceneDensityDismissal(storyId, dismissal);

      const reading = computeSceneDensity(story.p4Units ?? []);
      return NextResponse.json({ sceneDensity: applySceneDensityDismissal(reading, dismissal) });
    } catch (err) {
      return errorResponse(err);
    }
  }
  ```

- [ ] **Step 2: Include the reading in the canvas GET response**

  In `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`, add this import
  alongside the existing ones at the top of the file:
  ```ts
  import {
    computeSceneDensity,
    applySceneDensityDismissal,
    DEFAULT_SCENE_DENSITY_DISMISSAL,
  } from "@/lib/storyArchitectureEngine/sceneDensity";
  ```

  In the `GET` handler, right before the `return NextResponse.json({...})` call, add:
  ```ts
      const sceneDensity = applySceneDensityDismissal(
        computeSceneDensity(story.p4Units ?? []),
        story.p4SceneDensityDismissal ?? DEFAULT_SCENE_DENSITY_DISMISSAL
      );
  ```

  Then add `sceneDensity` to the returned object, which currently reads:
  ```ts
      return NextResponse.json({
        story: { ...story, p3: normalizeP3(story.p3), p4: normalizeP4(story.p4) },
        elements,
        messages,
        characterMessages,
        worldMessages,
        worldElements,
        architectureMessages,
        guardrailFlags,
        characterBibleGate,
      });
  ```
  Change it to:
  ```ts
      return NextResponse.json({
        story: { ...story, p3: normalizeP3(story.p3), p4: normalizeP4(story.p4) },
        elements,
        messages,
        characterMessages,
        worldMessages,
        worldElements,
        architectureMessages,
        guardrailFlags,
        characterBibleGate,
        sceneDensity,
      });
  ```
  This computation is cheap (a single pass over `story.p4Units`) and runs unconditionally,
  unlike the `includeArchitectureMessages`-gated fields — every canvas resume already receives
  `story.p4Units` in the `story` spread regardless of which project screen is loading, so there
  is no extra Firestore read being added here, only a small in-memory computation.

- [ ] **Step 3: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand:
  - `PATCH` with `direction: "under"` on a story whose `p4SceneDensityDismissal` is absent ->
    confirm it writes `{ under: true, over: false }` (built from
    `DEFAULT_SCENE_DENSITY_DISMISSAL`, not crashing on a missing field).
  - `PATCH` with an invalid `direction` (e.g. `"sideways"`) -> `400`.
  - `PATCH` for a `storyId` that exists but the caller isn't a member of its workspace -> `403`.
  - The canvas GET route for a story with zero `p4Units` -> `sceneDensity: { count: 0,
    projectedTotal: null, rawAlert: null, alert: null }`, no error.

- [ ] **Step 4: Commit**

  ```bash
  git add web/src/app/api/architecture-chat/scene-density/route.ts web/src/app/api/workspaces/\[workspaceId\]/canvases/\[canvasId\]/route.ts
  git commit -m "feat: add P4 scene-density dismiss route and canvas resume inclusion (issue #56)"
  ```

---

### Task 4: UI banner + dismiss button

**Files:**
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Consumes (Task 2): the architecture-chat turn response's `sceneDensity: { count: number;
  projectedTotal: number | null; alert: "under" | "over" | null }` field.
- Consumes (Task 3): the canvas GET response's top-level `sceneDensity` field (same shape);
  `PATCH /api/architecture-chat/scene-density`.

- [ ] **Step 1: Add the `SceneDensity` type and extend `TurnResponse`**

  In `web/src/components/ArchitectureInterview.tsx`, add this type right after the existing
  `UnitSummary` type declaration:
  ```ts
  type SceneDensity = { count: number; projectedTotal: number | null; alert: "under" | "over" | null };
  ```

  Add a field to the `TurnResponse` interface, which currently ends with:
  ```ts
    pendingConflict: { kind: "unit_regression" | "canon_contradiction"; unitId: string } | null;
    cascadeReview: { id: string; description: string }[] | null;
  }
  ```
  Change it to:
  ```ts
    pendingConflict: { kind: "unit_regression" | "canon_contradiction"; unitId: string } | null;
    cascadeReview: { id: string; description: string }[] | null;
    sceneDensity: SceneDensity;
  }
  ```

- [ ] **Step 2: Add state**

  Right after the existing:
  ```ts
    const [cascadeReview, setCascadeReview] = useState<{ id: string; description: string }[] | null>(null);
  ```
  add:
  ```ts
    const [sceneDensity, setSceneDensity] = useState<SceneDensity | null>(null);
  ```

- [ ] **Step 3: Hydrate on resume**

  In the resume/hydration effect, right after this existing line:
  ```ts
          setPendingConflict(
            (data.story?.p4PendingConflict as { kind: "unit_regression" | "canon_contradiction"; unitId: string } | null | undefined) ?? null
          );
  ```
  add:
  ```ts
          // Task 3's canvas GET route computes this fresh from the
          // persisted units/dismissal state every resume, so a page
          // reload shows the current reading without waiting for the
          // next chat turn - top-level on the response, a sibling of
          // `story`, not nested under it (matching guardrailFlags/
          // characterBibleGate's own shape).
          setSceneDensity((data.sceneDensity as SceneDensity | undefined) ?? null);
  ```

- [ ] **Step 4: Update from each chat turn**

  In `sendMessage`, right after this existing line:
  ```ts
        setCascadeReview(data.cascadeReview);
  ```
  add:
  ```ts
        setSceneDensity(data.sceneDensity);
  ```

- [ ] **Step 5: Add the dismiss action**

  Add this new function right after `sendMessage`'s closing brace, before `compileDocument`:
  ```ts
    async function dismissSceneDensityAlert(direction: "under" | "over") {
      if (!canvasId) return;
      try {
        const res = await fetch("/api/architecture-chat/scene-density", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storyId: canvasId, direction }),
        });
        const data = await res.json();
        if (res.ok) {
          setSceneDensity(data.sceneDensity);
        }
      } catch {
        // Best-effort - on a network failure the banner simply stays
        // visible until the next successful chat turn recomputes it,
        // same tolerance every other fetch in this component already has.
      }
    }
  ```

- [ ] **Step 6: Add the banner**

  Add this block right after the existing `cascadeReview` banner block (after its closing
  `)}`, before `{compiled && (`):
  ```tsx
        {sceneDensity?.alert && (
          <div className="flex items-center justify-between gap-4 border-b border-sky-500/30 bg-sky-950/20 px-6 py-2 text-xs text-sky-200">
            <span>
              Pacing note: {sceneDensity.count} scene{sceneDensity.count === 1 ? "" : "s"} so far
              project to about {sceneDensity.projectedTotal ?? "?"} total -{" "}
              {sceneDensity.alert === "under"
                ? "below the 75-150 scene target. Consider whether an escalation beat or extra sub-sequence is missing."
                : "above the 75-150 scene target. Consider whether any scenes could be merged or streamlined."}
            </span>
            <button
              onClick={() => {
                if (sceneDensity?.alert) dismissSceneDensityAlert(sceneDensity.alert);
              }}
              className="shrink-0 rounded-lg border border-sky-500/50 bg-neutral-900 px-2 py-1 text-xs font-semibold text-sky-200 hover:bg-sky-900/40"
            >
              Dismiss
            </button>
          </div>
        )}
  ```
  This is visually distinct (sky/blue) from the blocking red rejection banner, the amber
  placement-guardrail banner, and the orange Canon Revision Path banners — this one never halts
  the conversation, and its own dismiss button is the only UI element among these banners that
  lets the author clear it directly.

- [ ] **Step 7: Verify with `tsc`/`lint`/`build`**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean.

- [ ] **Step 8: Commit**

  ```bash
  git add web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: add P4 scene-density pacing banner and dismiss action (issue #56)"
  ```

---

## Final Verification (coordinator, after Task 4 passes task review — not part of any task's implementer brief)

This project has no automated UI test harness, but the Firebase Local Emulator Suite is already
configured (`firebase.json`, `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` in `.env.local`) and the
`firebase` CLI is available — this makes a real, no-API-cost browser check of the banner and
dismiss button feasible without needing a live Anthropic call at all (the banner only needs a
story doc with `p4Units` and `p4SceneDensityDismissal` set directly, reached via the canvas GET
route from Task 3). This is a coordinator-run integration check, not an implementer step —
orchestrating two background processes (emulators + dev server) and seeding data is easier to
run directly than to hand to a fresh subagent unsupervised.

1. Start `firebase emulators:start --only firestore,auth` from the repo root.
2. Start `npm run dev` in `web/` with `FIRESTORE_EMULATOR_HOST=localhost:8080` and
   `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099` set in the shell environment (so the
   `firebase-admin` server-side SDK also targets the emulator, not production Firestore).
3. Seed a workspace/story directly against the emulator (a short throwaway script using
   `firebase-admin` pointed at the emulator, or the Emulator UI at `localhost:4000`) with a
   `p4Units` array containing enough `Working`/`Confirmed` units across >= 2 distinct
   `stepNumber`s to land the projection under 75 (or over 150).
4. Sign in as the seeded user (Auth emulator) and load `/story-architecture` with that
   workspace/canvas selected in the browser.
5. Confirm the sky-colored pacing banner renders with the expected count/projection/direction
   text, click Dismiss, confirm it disappears and the PATCH call succeeds (network tab or server
   log).
6. Report the outcome plainly — if any step can't be completed (e.g. emulator startup fails in
   this environment), say so explicitly rather than claiming the UI was verified.
