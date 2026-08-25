/**
 * Project 3 World Complexity Level vocabulary - GitHub issue #39. A
 * single, author-confirmed value per project (PRD §4.1), not part of the
 * 4-state Exploring/Working/Confirmed/Deferred canon machinery - kept in
 * its own small file (not worldTurnSchema.ts) since it needs to be safely
 * importable from client components, and worldTurnSchema.ts pulls in
 * @anthropic-ai/sdk (server-only).
 */

export const WCL_LEVELS = [1, 2, 3, 4] as const;
export type WclLevel = (typeof WCL_LEVELS)[number];

export const WCL_LABELS: Record<WclLevel, string> = {
  1: "Minimal",
  2: "Moderate",
  3: "Rich",
  4: "Extensive",
};
