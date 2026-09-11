/**
 * Shared canon-status badge color map (issue #45) - previously duplicated
 * verbatim, un-exported, in both CanonPanel.tsx (Project 1) and
 * WorldInterview.tsx's pillars panel (Project 3, issue #41). Both statuses
 * "Parked" and "Deferred" render identically - "Parked" is CanonElement's
 * internal CanonStatus value; "Deferred" is the author-facing label used
 * at the P2/P3 API boundary (character-chat/route.ts, world-chat/canon-
 * status/route.ts) - this map covers both spellings so either convention
 * can import it directly without a translation step.
 */
export type CanonBadgeStatus = "Exploring" | "Working" | "Confirmed" | "Parked" | "Deferred";

export const CANON_STATUS_BADGE_STYLES: Record<CanonBadgeStatus, string> = {
  Exploring: "bg-neutral-700 text-neutral-300",
  Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  Parked: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
  Deferred: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
};
