import { z } from "zod";

/**
 * Structured state-delta schema — GitHub issue #9, PRD §6.2. Validated
 * independently of Anthropic's own tool-schema enforcement (defense in
 * depth per PRD §13's flagged risk: "Model may not reliably emit clean
 * structured state deltas").
 */

const CATALOG_CODE_PATTERN = /\b[A-E]\d{2}\b/;

function containsCatalogCode(value: unknown): boolean {
  if (typeof value === "string") return CATALOG_CODE_PATTERN.test(value);
  if (Array.isArray(value)) return value.some((v) => typeof v === "string" && CATALOG_CODE_PATTERN.test(v));
  return false;
}

export const ElementUpdateSchema = z
  .object({
    element_id: z.string().min(1),
    status: z.enum(["Exploring", "Working", "Confirmed", "Parked"]).optional(),
    value: z.unknown().optional(),
    retrieval_code: z.unknown().optional(),
    rationale: z.string().optional(),
    depends_on: z.array(z.string()).optional(),
    stage: z.number().optional(),
  })
  .superRefine((update, ctx) => {
    // Format codes (e.g. "A05") belong in retrieval_code, never in the
    // author-facing value — see ARCHITECTURE.md §3 "Internal catalog codes
    // never cross the export boundary."
    if (update.retrieval_code === undefined && containsCatalogCode(update.value)) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: `Element "${update.element_id}": value appears to contain a catalog code (e.g. "A05") — codes belong in retrieval_code, not value.`,
      });
    }
  });

export const StateDeltaSchema = z.object({
  reply: z.string().min(1),
  updates: z.array(ElementUpdateSchema),
  conflict_detected: z.boolean(),
  stage_ready_to_advance: z.boolean(),
  // Populated by the model only during a Conflict Resolution turn (issue
  // #10) — the app injects conflict context via
  // conflictResolution.buildConflictContextMessage() and expects these back.
  // cascade_review here is a courtesy hint, not authoritative: the app
  // computes the real downstream-impact list itself
  // (conflictResolution.findCascadeReview, from actual stored depends_on /
  // rationale data) rather than trusting the model to enumerate it
  // correctly, so this field is optional even when resolution is
  // "accept_and_update".
  resolution: z.enum(["keep_canon", "accept_and_update", "park"]).optional(),
  cascade_review: z.array(z.string()).optional(),
});

export type ElementUpdateInput = z.infer<typeof ElementUpdateSchema>;
export type StateDelta = z.infer<typeof StateDeltaSchema>;
