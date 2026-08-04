import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { PROJECT1_ELEMENT_IDS } from "./elementRegistry";

/**
 * Structured state-delta schema — GitHub issue #9, PRD §6.2. Validated
 * independently of Anthropic's own tool-schema enforcement (defense in
 * depth per PRD §13's flagged risk: "Model may not reliably emit clean
 * structured state deltas").
 *
 * EMIT_TURN_TOOL lives here (not extractTurn.ts, which is now generic
 * across projects — see issue #26/#27) since it's Project 1's own tool
 * definition, colocated with the Zod schema it must match exactly.
 */

export const EMIT_TURN_TOOL: Anthropic.Tool = {
  name: "emit_turn",
  description:
    "Emit your natural-language reply to the author together with the structured canon state delta for this turn. Call this exactly once per turn, even if updates is empty (e.g. a pure clarifying question with no canon change).",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "The chat-facing reply, ALWAYS formatted as a short numbered list (even a single item) of italicized questions/directives only - no framing prose, no explanation, no reasoning. Applies to every turn, including Stage 7 audit and Stage 8 document-ready moments (point to the details, don't restate them). Never narrate internal stage/depth/canon bookkeeping here.",
      },
      updates: {
        type: "array",
        description: "Canon element changes proposed this turn. Empty array if none.",
        items: {
          type: "object",
          properties: {
            element_id: {
              type: "string",
              enum: PROJECT1_ELEMENT_IDS,
              description:
                "The canonical element ID this update is for - always pick the closest match from the enum. Never invent a new key; every fact captured during the interview belongs in one of these fixed slots.",
            },
            status: { type: "string", enum: ["Exploring", "Working", "Confirmed", "Parked"] },
            value: { description: "Author-facing value. Never a catalog/retrieval code - see retrieval_code." },
            retrieval_code: { description: "Internal-only catalog code (e.g. a 101 Story Formats code like A05), if applicable. Never author-facing." },
            rationale: { type: "string" },
            depends_on: { type: "array", items: { type: "string" } },
            stage: {
              type: "number",
              description: "The stage number (1-8) this element belongs to - the stage where the author actually settled this fact, not necessarily the current stage.",
            },
          },
          required: ["element_id"],
        },
      },
      conflict_detected: {
        type: "boolean",
        description: "True if this turn's proposed update(s) contradict a Confirmed element.",
      },
      stage_ready_to_advance: {
        type: "boolean",
        description: "True if all required elements for the current stage are Confirmed or Parked.",
      },
      context: {
        type: "string",
        description: "Your reasoning and analysis about the STORY - character psychology, thematic tension, structural craft, what you noticed, why you're asking what you're asking. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief. Keep it to a few short paragraphs at most. Never name your internal author-type classification, reference field/tool names, or compile/output the Story Foundation Document here - see the system prompt's Operational Response Writing Rule.",
      },
      resolution: {
        type: "string",
        enum: ["keep_canon", "accept_and_update", "park"],
        description: "Only set this during a Conflict Resolution turn (a system note will tell you when you're in one), after the author picks one of the three choices you presented.",
      },
      cascade_review: {
        type: "array",
        items: { type: "string" },
        description: "Only relevant alongside resolution: accept_and_update. Element IDs you believe may be affected by the change - a hint only, the app computes the authoritative list itself.",
      },
    },
    required: ["reply", "updates", "conflict_detected", "stage_ready_to_advance", "context"],
  },
};

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
  // Kept after the fields above (mirrors EMIT_TURN_TOOL's property order in
  // extractTurn.ts, which is ordered deliberately for truncation-risk
  // reasons - see the comment there). Zod object key order doesn't affect
  // validation; this is for readability parity only.
  context: z.string().min(1),
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
