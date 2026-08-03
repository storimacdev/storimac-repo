import type { PriorityTier } from "@/lib/characterEngine/priorityMatrix";

/**
 * Maps issue #25's four computed tiers to the P2 system prompt's depth
 * labels (Character Priority Budget, sp02 §2). "Incidental"/"Reference"
 * depth is intentionally absent — #25 never assigns that tier (see
 * priorityMatrix.ts's own scope note: Incidental means "not in
 * principal_characters at all," a runtime-discovery concern, not something
 * this classifier outputs).
 */
const DEPTH_LABELS: Record<PriorityTier, string> = {
  Critical: "Exhaustive",
  Major: "Comprehensive",
  Supporting: "Standard",
  Minor: "Basic",
};

export function getDepthLabel(tier: PriorityTier): string {
  return DEPTH_LABELS[tier];
}
