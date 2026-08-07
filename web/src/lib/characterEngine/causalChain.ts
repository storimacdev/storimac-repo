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
 *
 * confirmedThisTurn covers roots being confirmed in the same turn's batch:
 * a Firestore read at this point would always miss them (applyStateDelta
 * hasn't persisted the transaction yet), so membership there is treated as
 * an immediate pass without a read.
 */
export async function isTraceable(
  storyId: string,
  charId: string,
  dependsOn: string[] | undefined,
  confirmedThisTurn: Set<string> = new Set()
): Promise<boolean> {
  const claimedRoots = (dependsOn ?? []).filter((f) => CHAIN_ROOT_FIELDS.includes(f));
  for (const root of claimedRoots) {
    if (confirmedThisTurn.has(root)) return true;
    const element = await getElement(storyId, `${charId}.${root}`, CHARACTER_FACTS_COLLECTION);
    if (element?.status === "Confirmed") return true;
  }
  return false;
}

/**
 * True if this field is already Confirmed in the store from an earlier
 * turn. Gates enforcement so a re-emitted Confirmed proposal (e.g. the
 * model omitting depends_on on a fact it already settled) never gets
 * downgraded - undoing an already-Confirmed fact isn't this feature's
 * job (see the separate Conflict Resolution flow, issues #10/#30), and
 * applyStateDelta rejects an already-Confirmed element's status change
 * without allowConfirmedOverride, which would abort the whole turn's
 * fact batch if this check tried to downgrade it anyway.
 */
export async function isAlreadyConfirmed(storyId: string, charId: string, field: string): Promise<boolean> {
  const element = await getElement(storyId, `${charId}.${field}`, CHARACTER_FACTS_COLLECTION);
  return element?.status === "Confirmed";
}
