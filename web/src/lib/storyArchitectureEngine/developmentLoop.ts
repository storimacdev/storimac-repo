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
