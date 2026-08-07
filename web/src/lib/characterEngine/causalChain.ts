import { getElement, CHARACTER_FACTS_COLLECTION } from "@/lib/canonEngine/canonStore";

/**
 * P2 causal chain traceability enforcement — GitHub issue #28, design:
 * docs/superpowers/specs/2026-08-07-p2-causal-chain-enforcement-design.md.
 * Scoped to exactly the AC's testable requirement, not the full
 * conceptual Life Experience -> Behavioral Trajectory chain: a Confirmed
 * Core Flaw or Dominant Fear must be traceable to an already-Confirmed
 * Core Wound or False Belief, for Critical/Major-tier characters only.
 */

export const CHAIN_ENFORCED_FIELDS = ["core_flaw", "dominant_fear"];
export const CHAIN_ROOT_FIELDS = ["core_wound", "false_belief"];
export const ENFORCED_TIERS = ["Critical", "Major"];

/** Cheap, I/O-free filter: does this proposal even claim a chain dependency? */
export function claimsTraceability(dependsOn: string[] | undefined): boolean {
  return (dependsOn ?? []).some((f) => CHAIN_ROOT_FIELDS.includes(f));
}

/**
 * Only call once claimsTraceability is true - confirms at least one
 * claimed root field is actually Confirmed in the store, not just named.
 * Checks every claimed root (a proposal might name both); any one being
 * Confirmed is sufficient, matching "traceable to a stated Wound/Belief"
 * (either suffices).
 */
export async function isTraceable(
  storyId: string,
  charId: string,
  dependsOn: string[] | undefined
): Promise<boolean> {
  const claimedRoots = (dependsOn ?? []).filter((f) => CHAIN_ROOT_FIELDS.includes(f));
  for (const root of claimedRoots) {
    const element = await getElement(storyId, `${charId}.${root}`, CHARACTER_FACTS_COLLECTION);
    if (element?.status === "Confirmed") return true;
  }
  return false;
}
