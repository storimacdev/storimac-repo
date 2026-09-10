import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_STEPS } from "./structuralFramework";

/**
 * The Onboarding Gate's app-computed data — GitHub issue #57, PRD §7.3
 * FR-3.1-3.3 (superseded numbering - see below), Framework v3.0 §5.
 * Supplies the structured data a future live P4 agent's system prompt
 * weaves into its actual first turn; does not itself enforce "no prose
 * before the gate completes" (a live agent's system-prompt behavioral
 * rule, not app-layer code) and does not implement route-switching
 * (issue #61's module).
 *
 * Issue #57 explicitly supersedes the original PRD §7.3 numbering: the
 * old FR-3.1's clause (b), "state the diagnosed Complexity Level," is
 * intentionally absent from `OnboardingOutput` - Complexity Level
 * diagnosis no longer exists as an upfront onboarding step (see issue
 * #56, now a silent, continuous Dynamic Scene Density & Pacing Monitor
 * instead). This is not an omission; it's the current spec.
 */

export interface MilestoneChecklistItem {
  stepNumber: number;
  title: string;
  /** Currently identical across all 10 items - `canon.p1 !== null` (see
   * `buildMilestoneChecklist` below). If BA later supplies a finer
   * per-step canon-requirement rule, this is the field/function to
   * extend - nothing here is a per-step-validated signal yet. */
  addressable: boolean;
  reason: string;
}

export interface OnboardingOutput {
  structuralOverview: string;
  milestoneChecklist: MilestoneChecklistItem[];
  routingPrompt: string;
}

/**
 * "Addressable given canon" (issue #57 AC1(b), the milestone checklist)
 * is gated on Project 1 existing - no source document defines a finer
 * per-step canon-requirement rule, so inventing one would be
 * fabricating a requirement nobody specified.
 */
export function buildMilestoneChecklist(canon: IngestedCanon): MilestoneChecklistItem[] {
  const addressable = canon.p1 !== null;
  const reason = addressable
    ? "Story Foundation canon is available."
    : "Story Foundation has not been generated yet — no canon available for structural work.";
  return STRUCTURAL_STEPS.map((step) => ({
    stepNumber: step.stepNumber,
    title: step.title,
    addressable,
    reason,
  }));
}

export const ROUTING_PROMPT =
  "Option A — Blueprint Priority Route (recommended default): develop the story's four anchor points first (The Frame, The New Baseline, The Spark, The Illusory Peak/Midpoint), then the six Set Pieces in order, developing each one's core anchor beat first.\n" +
  "Option B — Chronological Route: develop all 10 steps in strict sequential order, Step 1 through Step 10.\n" +
  "Option C — Custom Author Steering: name any Set Piece, Plot Point, or scene block to develop next, in any order you choose.\n" +
  "Which would you like to use? You can switch at any time without penalty.";

export function buildOnboardingOutput(canon: IngestedCanon): OnboardingOutput {
  return {
    structuralOverview: canon.structuralOverview,
    milestoneChecklist: buildMilestoneChecklist(canon),
    routingPrompt: ROUTING_PROMPT,
  };
}
