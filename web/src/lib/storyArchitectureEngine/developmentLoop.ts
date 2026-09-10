import type { StructuralStep } from "./structuralFramework";
import type { CanonStatus } from "@/lib/canonEngine/types";
import { setUnitStatus, type StructuralUnit } from "./stateLedger";

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
 * Option A: `BLUEPRINT_PRIORITY_ORDER` (issue #59). Option B: Steps 1-10
 * strict sequential (PRD FR-3.2B). Option C: no fixed order - `null`
 * signals "the author names the next step," not an error or an empty
 * route.
 */
export function getRouteOrder(routingChoice: RoutingChoice): number[] | null {
  switch (routingChoice) {
    case "A":
      return BLUEPRINT_PRIORITY_ORDER;
    case "B":
      return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    case "C":
      return null;
  }
}

export interface RoutingState {
  routingChoice: RoutingChoice;
}

/**
 * FR-3.3: switching carries no penalty or data loss. Holds by
 * construction, not by extra preservation logic - `RoutingState` holds
 * only the choice itself, never `StructuralUnit`/ledger data, so there
 * is nothing for this function to lose.
 */
export function switchRoute(state: RoutingState, newChoice: RoutingChoice): RoutingState {
  return { routingChoice: newChoice };
}
