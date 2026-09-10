# Blueprint Priority Development Loop Module (Issue #59) — Design

## Problem

PRD §7.4 FR-4.2/FR-4.4 and Framework v3.0 §5 require the single-route
(Blueprint Priority) structural development loop: develop the 10 steps
in a fixed anchor-first order (Frame → Final Image → Spark → Midpoint →
Set Pieces 1-6), validate proposed content against each step's Core
Purpose before marking it `Working`/`Confirmed`, and enforce placement
percentage marks as a loose (flag, don't block) guardrail.

## Scope boundary

Issue #61 (Chronological + Custom routing) is a separate, later issue
that adds Options B and C alongside this one. This issue ships **only**
the Blueprint Priority (Option A) order as a fixed constant — no
`RoutingChoice` type, no route-chooser function, no route-switching
exists yet after this issue; #61 introduces all three specifically
because, per its own title, it adds "alongside the existing Blueprint
Priority route." Building a chooser now, before a second route exists to
choose between, would be speculative.

## Decision: Core Purpose validation is a live-agent judgment, not deterministic code

AC2 requires rejecting content that "isn't a strict single external
event happening to the hero" (a Catalyst example) — this is a semantic
judgment over free-text author input, not something a deterministic
function can honestly perform. Building a fake string-matching
"validator" that pretends to do this would produce wrong answers
disguised as a real gate. The same split already established for every
P1-P3 system prompt applies here: the semantic judgment belongs to a
future live agent's system-prompt-driven turn (already partly
achievable, since Step 9's own `corePurpose` text is available via
`structuralFramework.ts` for that future turn to reason over), while
this module provides the one thing that CAN be honestly enforced in
code: **a status-transition gate that structurally requires validation
to have happened before a unit can move to `Working`/`Confirmed`**,
where the validation *result* itself is supplied by the caller (the
future live agent, or in tests, a fixture). This is honest and testable
(trace: `valid: true` → transition allowed; `valid: false` → transition
blocked, unit unchanged, reason returned) without fabricating semantic
judgment this module cannot actually perform.

## Architecture

New file: `web/src/lib/storyArchitectureEngine/developmentLoop.ts`.
Consumes `StructuralStep`/`STRUCTURAL_STEPS` (#58) and `StructuralUnit`/
`setUnitStatus` (#62, `stateLedger.ts`).

### The Blueprint Priority order

```ts
/**
 * Framework v3.0 §5, Option A: Frame -> Final Image -> Spark -> Midpoint
 * -> Set Pieces 1-6 in order (anchor-first). "The Final Image" is v3.0's
 * routing-menu name for Step 10 (Plot Point 4, "The New Baseline") -
 * same step, per issue #58's own note. Step numbers, not array indices,
 * since STRUCTURAL_STEPS is already sorted 1-10 and this is a distinct,
 * separately-ordered sequence over the same 10 steps.
 */
export const BLUEPRINT_PRIORITY_ORDER: number[] = [1, 10, 3, 6, 2, 4, 5, 7, 8, 9];
```

(Derivation: Frame = Step 1, Final Image = Step 10, Spark = Step 3,
Midpoint = Step 6, then Set Pieces 1-6 in their own step-number order =
Steps 2, 4, 5, 7, 8, 9.)

### Placement-mark deviation guardrail (AC3)

```ts
export interface PlacementDeviationCheck {
  flagged: boolean;
  message: string | null;
}

export function checkPlacementDeviation(step: StructuralStep, proposedPositionPercent: number): PlacementDeviationCheck;
```

Parses a percent out of `step.placementMark` (e.g. `"~20% mark"` →
`20`); when `placementMark` carries no percent (`null`, or a non-percent
mark like `"Scene 1"`/`"Final Scene"`), there is nothing to deviate from
and the check always passes. When a percent target exists, flags
(doesn't block) when the proposed position deviates from it by more
than a fixed threshold.

### Status-transition gate requiring external validation (AC2)

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

export function attemptStatusTransition(
  unit: StructuralUnit,
  targetStatus: CanonStatus,
  validation: ContentValidationResult
): StatusTransitionAttempt;
```

Only `"Working"` and `"Confirmed"` targets require `validation.valid ===
true`; moving to `"Exploring"` or `"Parked"` never requires validation
(there's no content commitment being made). A rejected attempt returns
the **original, unchanged** unit plus `accepted: false` and a reason —
never a partial or silently-degraded update.

## Edge cases

- **`step.placementMark` is `null`** (e.g. Steps 2, 4, 5, 7, 8, 9 — see
  issue #58's design, which notes only some steps carry a step-level
  mark): `checkPlacementDeviation` never flags — there's no target to
  deviate from at the step level. (A future issue could extend this to
  check against a step's *nested* critical-beat placement mark instead;
  out of scope here, since AC3 only requires enforcing "placement
  percentage marks" as loosely as the framework itself defines them.)
- **`step.placementMark` is a non-percent string** (`"Scene 1"`,
  `"Final Scene"`): parses to no target, same as `null` — never flagged.
  A percent-bearing mark like `"50% mark"` or `"~20% mark"` does parse
  to a real target and IS checked.
- **`targetStatus` is `"Exploring"` or `"Parked"`** with
  `validation.valid: false`: still accepted — the validation gate only
  applies to `Working`/`Confirmed`, per AC2's own wording ("before
  marking it `Working` or `Confirmed`").
- **A validation result claims `valid: true` but supplies no `reason`**:
  fine — `reason` is optional and only meaningful on rejection.

## Out of scope

- `RoutingChoice` type, multi-route chooser, and route-switching —
  issue #61.
- The actual semantic Core-Purpose judgment — a future live agent's
  system-prompt-driven turn, not this module.
- Causality validation, canon revision, thematic anchor audit — issues
  #63/#64/#65.
- Any live chat route or system prompt.
