# Blueprint Priority Development Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Blueprint Priority (Option A) structural
development loop's deterministic pieces (issue #59): the fixed
anchor-first step order, a loose placement-percentage deviation
guardrail, and a status-transition gate that structurally requires an
externally-supplied validation result before a unit can move to
`Working`/`Confirmed`.

**Architecture:** One new file, `web/src/lib/storyArchitectureEngine/developmentLoop.ts`,
consuming `StructuralStep`/`STRUCTURAL_STEPS` (issue #58) and
`StructuralUnit`/`setUnitStatus` (issue #62). The actual semantic
Core-Purpose judgment (AC2) is explicitly NOT implemented as
deterministic code here — see the design spec's "Decision" section —
this module only enforces that a validation result was supplied before
allowing the transition.

**Tech Stack:** TypeScript. No test runner configured — verification is
`npm run lint`, `npm run build`, and manual/code-trace verification.

## Global Constraints

- `BLUEPRINT_PRIORITY_ORDER` is a fixed constant (`[1, 10, 3, 6, 2, 4, 5, 7, 8, 9]`)
  — no `RoutingChoice` type, no chooser function, no switching logic.
  Those belong to issue #61.
- No deterministic "semantic validation" function pretending to judge
  free-text content against a step's Core Purpose — `attemptStatusTransition`
  takes an already-computed `ContentValidationResult` from its caller.
- `checkPlacementDeviation` only flags (never blocks) — it returns a
  `flagged`/`message` pair, never throws, never prevents a caller from
  proceeding.
- No Firestore read/write, no LLM call.

---

### Task 1: Blueprint Priority order and placement-deviation guardrail

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`

**Interfaces:**
- Consumes: `type StructuralStep` from `./structuralFramework`.
- Produces (used by Task 2's file, no cross-task type dependency): `export const BLUEPRINT_PRIORITY_ORDER: number[]`; `export interface PlacementDeviationCheck { flagged: boolean; message: string | null; }`; `export function checkPlacementDeviation(step: StructuralStep, proposedPositionPercent: number): PlacementDeviationCheck`.

- [ ] **Step 1: Create the file with the Blueprint Priority order and deviation check**

```ts
import type { StructuralStep } from "./structuralFramework";

/**
 * The Blueprint Priority (single-route) development loop's deterministic
 * pieces — GitHub issue #59, PRD §7.4 FR-4.2/FR-4.4, Framework v3.0 §5.
 * The actual semantic Core-Purpose judgment (AC2) is NOT implemented
 * here — see docs/superpowers/specs/2026-09-10-development-loop-design.md's
 * "Decision" section for why a deterministic function can't honestly do
 * that; `attemptStatusTransition` below only enforces that a validation
 * result was supplied before a Working/Confirmed transition, leaving the
 * judgment itself to a future live agent's system-prompt-driven turn.
 * Multi-route chooser/switching is issue #61, not this module.
 */

/**
 * Framework v3.0 §5, Option A: Frame -> Final Image -> Spark -> Midpoint
 * -> Set Pieces 1-6 in order (anchor-first). "The Final Image" is v3.0's
 * routing-menu name for Step 10 (Plot Point 4, "The New Baseline") - same
 * step, per issue #58's own note.
 */
export const BLUEPRINT_PRIORITY_ORDER: number[] = [1, 10, 3, 6, 2, 4, 5, 7, 8, 9];

export interface PlacementDeviationCheck {
  flagged: boolean;
  message: string | null;
}

const DEVIATION_THRESHOLD_PERCENT = 10;

function parsePlacementPercent(placementMark: string | null): number | null {
  if (!placementMark) return null;
  const match = placementMark.match(/(\d+)%/);
  return match ? Number(match[1]) : null;
}

/**
 * AC3: placement percentage marks are a loose guardrail - flagged, never
 * blocked. A step with no percent-bearing `placementMark` (null, or a
 * non-percent mark like "Scene 1"/"Final Scene") has nothing to deviate
 * from and is never flagged.
 */
export function checkPlacementDeviation(step: StructuralStep, proposedPositionPercent: number): PlacementDeviationCheck {
  const target = parsePlacementPercent(step.placementMark);
  if (target === null) {
    return { flagged: false, message: null };
  }
  const deviation = Math.abs(proposedPositionPercent - target);
  if (deviation > DEVIATION_THRESHOLD_PERCENT) {
    return {
      flagged: true,
      message: `${step.title} is targeted around the ${step.placementMark}, but the proposed position (${proposedPositionPercent}%) deviates by ${deviation} percentage points. This is a loose guardrail, not a hard block - confirm with the author before proceeding.`,
    };
  }
  return { flagged: false, message: null };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these by hand against real
`STRUCTURAL_STEPS` entries from issue #58's `structuralFramework.ts`:

- **`BLUEPRINT_PRIORITY_ORDER`**: confirm it has exactly 10 entries, is
  a permutation of `1..10` (every number 1-10 appears exactly once), and
  starts `[1, 10, 3, 6, ...]`.
- **Step 6 (Midpoint, `placementMark: "50% mark"`), `proposedPositionPercent: 50`**:
  `checkPlacementDeviation` → `{ flagged: false, message: null }`
  (deviation is exactly 0).
- **Step 6, `proposedPositionPercent: 65`**: → `{ flagged: true, message:
  "The Illusory Peak (Midpoint) is targeted around the 50% mark, but the
  proposed position (65%) deviates by 15 percentage points. ..." }`
  (deviation 15 > threshold 10).
- **Step 3 (Spark, `placementMark: "~10% mark"`), `proposedPositionPercent: 10`**:
  confirm the regex correctly extracts `10` from `"~10% mark"` (the `~`
  prefix doesn't break the match) → not flagged.
- **Step 2 (`placementMark: null`, per issue #58's data)**, any
  `proposedPositionPercent`: → always `{ flagged: false, message: null }`
  — nothing to deviate from.
- **Step 1 (`placementMark: "Scene 1"`, no percent sign)**, any
  `proposedPositionPercent`: → always `{ flagged: false, message: null }`
  — `parsePlacementPercent` returns `null` for a non-percent string.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/developmentLoop.ts
git commit -m "feat: add Blueprint Priority order and placement-deviation guardrail"
```

---

### Task 2: Status-transition validation gate

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`

**Interfaces:**
- Consumes: `type CanonStatus` from `@/lib/canonEngine/types`; `setUnitStatus`, `type StructuralUnit` from `./stateLedger`.
- Produces: `export interface ContentValidationResult { valid: boolean; reason?: string; }`; `export interface StatusTransitionAttempt { unit: StructuralUnit; accepted: boolean; reason?: string; }`; `export function attemptStatusTransition(unit: StructuralUnit, targetStatus: CanonStatus, validation: ContentValidationResult): StatusTransitionAttempt`.

- [ ] **Step 1: Add the import and the validation gate**

Add to the top of the file, alongside the existing import:

```ts
import type { CanonStatus } from "@/lib/canonEngine/types";
import { setUnitStatus, type StructuralUnit } from "./stateLedger";
```

Add at the end of the file, after `checkPlacementDeviation`:

```ts
export interface ContentValidationResult {
  valid: boolean;
  reason?: string;
}

export interface StatusTransitionAttempt {
  unit: StructuralUnit;
  accepted: boolean;
  reason?: string;
}

const STATUSES_REQUIRING_VALIDATION: CanonStatus[] = ["Working", "Confirmed"];

/**
 * AC2: validates before marking Working/Confirmed. The validation
 * judgment itself is supplied by the caller (a future live agent's
 * semantic turn) - this function only enforces that a passing result
 * was supplied before allowing the transition. A rejected attempt
 * returns the ORIGINAL unit unchanged, never a partial update.
 */
export function attemptStatusTransition(
  unit: StructuralUnit,
  targetStatus: CanonStatus,
  validation: ContentValidationResult
): StatusTransitionAttempt {
  const requiresValidation = STATUSES_REQUIRING_VALIDATION.includes(targetStatus);
  if (requiresValidation && !validation.valid) {
    return {
      unit,
      accepted: false,
      reason: validation.reason ?? "Proposed content does not satisfy this step's Core Purpose.",
    };
  }
  return { unit: setUnitStatus(unit, targetStatus), accepted: true };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

- **`attemptStatusTransition(unit, "Working", { valid: false, reason: "Not a single external event happening to the hero." })`**:
  → `{ unit: <the exact same unit object>, accepted: false, reason: "Not
  a single external event happening to the hero." }` — confirm the
  returned `unit` is unchanged (its `status` is still whatever it was
  before the call, not `"Working"`).
- **`attemptStatusTransition(unit, "Confirmed", { valid: true })`**: →
  `{ unit: <a NEW unit with status: "Confirmed">, accepted: true }`
  (no `reason` key needed on success).
- **`attemptStatusTransition(unit, "Exploring", { valid: false })`**: →
  `{ unit: <a NEW unit with status: "Exploring">, accepted: true }` —
  `"Exploring"` doesn't require validation, so an invalid result doesn't
  block it.
- **`attemptStatusTransition(unit, "Parked", { valid: false })`**: same
  as above — `"Parked"` doesn't require validation either.
- **`attemptStatusTransition(unit, "Working", { valid: false })`** (no
  `reason` supplied): → `accepted: false`, `reason: "Proposed content
  does not satisfy this step's Core Purpose."` (the default fallback
  message, since none was supplied).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/developmentLoop.ts
git commit -m "feat: add status-transition validation gate to the development loop module"
```
