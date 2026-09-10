import { STRUCTURAL_STEPS, type StructuralStep } from "./structuralFramework";
import type { CanonStatus } from "@/lib/canonEngine/types";
import { setUnitStatus, type StructuralUnit } from "./stateLedger";

/**
 * The single- and multi-route development loop's deterministic pieces —
 * GitHub issues #59 (Blueprint Priority route, placement guardrail,
 * status-transition gate) and #61 (Chronological/Custom routes, route
 * switching), PRD §7.3 FR-3.2/FR-3.3, §7.4 FR-4.2/FR-4.4, Framework v3.0
 * §5. The actual semantic Core-Purpose judgment (AC2) is NOT implemented
 * here — see docs/superpowers/specs/2026-09-10-development-loop-design.md's
 * "Decision" section for why a deterministic function can't honestly do
 * that; `attemptStatusTransition` below only enforces that a validation
 * result was supplied before a Working/Confirmed transition, leaving the
 * judgment itself to a future live agent's system-prompt-driven turn.
 */

/**
 * Framework v3.0 §5, Option A: Frame -> Final Image -> Spark -> Midpoint
 * -> Set Pieces 1-6 in order (anchor-first). "The Final Image" is v3.0's
 * routing-menu name for Step 10 (Plot Point 4, "The New Baseline") - same
 * step, per issue #58's own note. This same ordering fact is also
 * described in prose in onboardingGate.ts's `ROUTING_PROMPT` (issue
 * #57) - the two are not derived from each other, so check both if this
 * order ever changes.
 */
export const BLUEPRINT_PRIORITY_ORDER: number[] = [1, 10, 3, 6, 2, 4, 5, 7, 8, 9];

export interface PlacementDeviationCheck {
  flagged: boolean;
  message: string | null;
}

/**
 * No source document (PRD, Framework doc, or issue #59's own AC) states
 * a numeric deviation threshold - PRD §12 explicitly lists this as an
 * open UX question ("needs UX clarity"). This value is a chosen
 * default, not a sourced one - the knob to tune once BA/UX settles the
 * open question, matching this module's own "never invent an
 * unspecified rule silently" convention (see onboardingGate.ts's
 * addressable-flag disclosure, issue #57).
 */
const DEVIATION_THRESHOLD_PERCENT = 10;

function parsePlacementPercent(placementMark: string | null): number | null {
  if (!placementMark) return null;
  const match = placementMark.match(/(\d+)%/);
  return match ? Number(match[1]) : null;
}

/**
 * AC3: placement percentage marks are a loose guardrail - flagged, never
 * blocked. Checks the step's own `placementMark` first, falling back to
 * its nested critical beat's `placementMark` (issue #58's data model:
 * most Set Pieces carry their percent mark on the nested beat, not the
 * step itself) - together these cover all 7 of the framework's real
 * percent-bearing marks (5%, 10%, 20%, 22%, 50%, 75%, 80%). A step/beat
 * with no percent-bearing mark anywhere (Steps 1, 9, 10) has nothing to
 * deviate from and is never flagged.
 */
export function checkPlacementDeviation(step: StructuralStep, proposedPositionPercent: number): PlacementDeviationCheck {
  const mark = step.placementMark ?? step.criticalBeats[0]?.placementMark ?? null;
  const target = parsePlacementPercent(mark);
  if (target === null) {
    return { flagged: false, message: null };
  }
  const deviation = Math.abs(proposedPositionPercent - target);
  if (deviation > DEVIATION_THRESHOLD_PERCENT) {
    return {
      flagged: true,
      message: `${step.title} is targeted around the ${mark}, but the proposed position (${proposedPositionPercent}%) deviates by ${deviation} percentage points. This is a loose guardrail, not a hard block - confirm with the author before proceeding.`,
    };
  }
  return { flagged: false, message: null };
}

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
 * was supplied before allowing the transition. It does NOT enforce
 * lifecycle legality (e.g. Confirmed -> Exploring/Working, which
 * `canonEngine/transitions.ts`'s `isValidTransition` would reject for a
 * canon element) - that guard is issue #64's scope, matching issue
 * #62's own already-accepted scope note on `setUnitStatus`. A rejected
 * attempt returns the ORIGINAL unit unchanged, never a partial update.
 */
export function attemptStatusTransition(
  unit: StructuralUnit,
  targetStatus: CanonStatus,
  validation: ContentValidationResult,
  now?: string
): StatusTransitionAttempt {
  const requiresValidation = STATUSES_REQUIRING_VALIDATION.includes(targetStatus);
  if (requiresValidation && !validation.valid) {
    return {
      unit,
      accepted: false,
      reason: validation.reason ?? "Proposed content does not satisfy this step's Core Purpose.",
    };
  }
  return { unit: setUnitStatus(unit, targetStatus, now), accepted: true };
}

export type RoutingChoice = "A" | "B" | "C";

/**
 * Option A: `BLUEPRINT_PRIORITY_ORDER` (issue #59). Option B: every
 * `STRUCTURAL_STEPS` step number in its own already-sorted order (PRD
 * FR-3.2B) - derived, not hand-duplicated, so it can't desync from
 * issue #58's canonical step list. Option C: no fixed order - `null`
 * signals "the author names the next step," not an error or an empty
 * route. All three options' descriptions are also stated in prose in
 * onboardingGate.ts's `ROUTING_PROMPT` (issue #57) - the two are not
 * derived from each other, so check both if any option's behavior ever
 * changes.
 *
 * The return type is `readonly number[] | null` because Option A hands
 * out the actual `BLUEPRINT_PRIORITY_ORDER` reference (not a copy) -
 * marking it read-only prevents a caller from mutating that shared
 * array and corrupting Option A process-wide for every later caller.
 *
 * `routingChoice` is expected to always be one of the three literal
 * `RoutingChoice` values - if this is ever called with an invalid
 * runtime string that TypeScript didn't catch (e.g. an un-guarded value
 * parsed from an author's free-text reply, a future LLM/user boundary
 * this function has no visibility into), the switch has no `default`
 * and would return `undefined` at runtime despite the `| null`
 * signature. TypeScript's own exhaustiveness check only protects
 * well-typed callers; validating an untrusted string is out of this
 * issue's scope and is the responsibility of whatever future code
 * parses the author's actual choice.
 */
export function getRouteOrder(routingChoice: RoutingChoice): readonly number[] | null {
  switch (routingChoice) {
    case "A":
      return BLUEPRINT_PRIORITY_ORDER;
    case "B":
      return STRUCTURAL_STEPS.map((step) => step.stepNumber);
    case "C":
      return null;
  }
}

export interface RoutingState {
  routingChoice: RoutingChoice;
}

/**
 * FR-3.3: switching carries no penalty or data loss. `RoutingState`
 * holds only the choice itself, never `StructuralUnit`/ledger data, so
 * there is nothing for THIS function to lose today - but the spread
 * (rather than a hand-written literal) keeps that guarantee true even
 * if `RoutingState` ever grows a second field, instead of silently
 * dropping whatever a future caller added.
 */
export function switchRoute(state: RoutingState, newChoice: RoutingChoice): RoutingState {
  return { ...state, routingChoice: newChoice };
}
