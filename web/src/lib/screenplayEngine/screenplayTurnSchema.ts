import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * The live P5 agent's structured turn output — GitHub issue #93 (Phase
 * 1 fields; later issues extend this same schema, mirroring how
 * architectureTurnSchema.ts grew incrementally across issues #56/#63/
 * #64/#66). Mirrors that file's Zod-schema/Anthropic.Tool pairing
 * convention exactly: every field exists identically in both.
 *
 * Only Phase 1 (Assignment Confirmation Gate, issue #93) fields exist
 * so far. Phase 2 drafting, QA/delivery, revision classification, and
 * conflict-intercept fields are added by their own issues' PRs.
 */

export const ScreenplayTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  /** Which scene this turn's work concerns. Null only before the
   * author/model has settled on a first scene to work on. */
  scene_number: z.number().int().min(1).nullable(),
  phase: z.enum(["assignment_gate", "drafting", "qa_delivery", "revision"]).nullable(),
  /** The Phase 1 one-paragraph summary proposed this turn, or null if
   * none is being proposed (e.g. still waiting on sign-off from a prior
   * turn, or mid-drafting). */
  proposed_assignment_summary: z.string().min(1).nullable(),
  /** True only on the turn where the author's message is being
   * interpreted as explicit sign-off on the currently pending
   * assignment summary (issue #93 AC4). Never true any other turn. */
  assignment_sign_off: z.boolean(),
  deferred_items: z.array(
    z.object({
      item: z.string().min(1),
      defer_to_project: z.enum(["Project 1", "Project 2", "Project 3", "Project 4"]).nullable(),
      notes: z.string(),
    })
  ),
});

export type ScreenplayTurn = z.infer<typeof ScreenplayTurnSchema>;

export const EMIT_SCREENPLAY_TURN_TOOL: Anthropic.Tool = {
  name: "emit_screenplay_turn",
  description:
    "Report your structured turn output for the Screenplay Edition drafting conversation. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "Your natural-language reply to the author, shown directly in the chat.",
      },
      context: {
        type: "string",
        description: "Your internal reasoning for this turn - never shown to the author in chat.",
      },
      scene_number: {
        type: ["number", "null"],
        description: "Which scene this turn's work concerns, or null if none has been settled on yet.",
      },
      phase: {
        type: ["string", "null"],
        enum: ["assignment_gate", "drafting", "qa_delivery", "revision", null],
        description: "Which of the four Progressive Drafting Workflow phases this turn's scene is currently in.",
      },
      proposed_assignment_summary: {
        type: ["string", "null"],
        description:
          'The Phase 1 one-paragraph assignment summary for scene_number, composed strictly from its Scene Register Entry grounding - exactly five pipe-delimited segments: "[Scene Number & Heading (INT./EXT., Location, Time)] | [Primary Cast Present] | [Dramatic Objective vs. Opposition] | [Turning Point] | [Expected Emotional Shift]". Null if none is being proposed this turn.',
      },
      assignment_sign_off: {
        type: "boolean",
        description:
          "True only on the turn where the author's message is explicit sign-off on the currently pending assignment summary. False on every other turn.",
      },
      deferred_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string", description: "What was raised." },
            defer_to_project: {
              type: ["string", "null"],
              enum: ["Project 1", "Project 2", "Project 3", "Project 4", null],
              description: "Which other project this actually belongs to, if any.",
            },
            notes: { type: "string", description: "Any additional context for the deferral." },
          },
          required: ["item", "defer_to_project", "notes"],
        },
        description: "Anything raised this turn that belongs to another project. Empty array if none.",
      },
    },
    required: [
      "reply",
      "context",
      "scene_number",
      "phase",
      "proposed_assignment_summary",
      "assignment_sign_off",
      "deferred_items",
    ],
  },
};
