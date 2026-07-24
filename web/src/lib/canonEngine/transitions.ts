import type { CanonStatus } from "./types";

/**
 * Lifecycle per PRD §5.3: Exploring -> Working -> Confirmed, with Parked
 * reachable from any state. Confirmed -> anything else is deliberately
 * excluded here — the store layer (canonStore.ts) requires an explicit
 * allowConfirmedOverride to change a Confirmed element at all, which is the
 * Conflict Resolution flow's job (issue #10), not a plain transition.
 */
const FORWARD_TRANSITIONS: Record<CanonStatus, CanonStatus[]> = {
  Exploring: ["Working", "Confirmed", "Parked"],
  Working: ["Exploring", "Confirmed", "Parked"],
  Confirmed: ["Parked"],
  Parked: ["Exploring", "Working", "Confirmed"],
};

export function isValidTransition(from: CanonStatus, to: CanonStatus): boolean {
  if (from === to) return true;
  return FORWARD_TRANSITIONS[from]?.includes(to) ?? false;
}
