import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_STEPS } from "./structuralFramework";

/**
 * The Onboarding Gate's app-computed data — GitHub issue #57, PRD §7.3
 * FR-3.1-3.3, Framework v3.0 §5. Supplies the structured data a future
 * live P4 agent's system prompt weaves into its actual first turn; does
 * not itself enforce "no prose before the gate completes" (a live
 * agent's system-prompt behavioral rule, not app-layer code) and does
 * not implement route-switching (issue #61's module).
 */

export interface MilestoneChecklistItem {
  stepNumber: number;
  title: string;
  addressable: boolean;
  reason: string;
}

export interface OnboardingOutput {
  structuralOverview: string;
  milestoneChecklist: MilestoneChecklistItem[];
  routingPrompt: string;
}

/**
 * "Addressable given canon" (FR-3.1c) is gated on Project 1 existing -
 * no source document defines a finer per-step canon-requirement rule,
 * so inventing one would be fabricating a requirement nobody specified.
 */
export function buildMilestoneChecklist(canon: IngestedCanon): MilestoneChecklistItem[] {
  const addressable = canon.p1 !== null;
  const reason = addressable
    ? "Story Foundation canon is available."
    : "Story Foundation has not been generated yet - no canon available for structural work.";
  return STRUCTURAL_STEPS.map((step) => ({
    stepNumber: step.stepNumber,
    title: step.title,
    addressable,
    reason,
  }));
}

export const ROUTING_PROMPT =
  "Option A — Blueprint Priority Route (recommended default): develop the story's four anchor points first (The Frame, The New Baseline, The Spark, The Illusory Peak/Midpoint), then the six Set Pieces in order.\n" +
  "Option B — Chronological Route: develop all 10 steps in strict sequential order, Step 1 through Step 10.\n" +
  "Option C — Custom Author Steering: name any Set Piece or Plot Point to develop next, in any order you choose.\n" +
  "Which would you like to use? You can switch at any time without penalty.";

export function buildOnboardingOutput(canon: IngestedCanon): OnboardingOutput {
  return {
    structuralOverview: canon.structuralOverview,
    milestoneChecklist: buildMilestoneChecklist(canon),
    routingPrompt: ROUTING_PROMPT,
  };
}
