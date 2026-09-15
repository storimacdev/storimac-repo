import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * The live P4 agent's structured turn output — GitHub issue #111.
 * Mirrors worldTurnSchema.ts's Zod-schema/Anthropic.Tool pairing
 * convention exactly: every field exists identically in both, hand-kept
 * in sync (Zod validates the model's actual output; the tool schema is
 * what's sent to Anthropic to shape it in the first place).
 */

export const ArchitectureTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  routing_choice: z.enum(["A", "B", "C"]).nullable(),
  active_step_number: z.number().int().min(1).max(10).nullable(),
  proposed_unit: z
    .object({
      unit_id: z.string().min(1),
      type: z.enum(["Scene", "Sequence", "SetPiece", "PlotPoint"]),
      content: z.string().min(1),
      requested_status: z.enum(["Exploring", "Working", "Confirmed", "Parked"]),
      canon_refs: z.array(z.string()),
      proposed_position_percent: z.number().min(0).max(100).nullable(),
      causal_tag: z.enum(["Therefore", "But", "And Then"]).nullable(),
      causal_tag_reason: z.string(),
    })
    .nullable(),
  validation_result: z.enum(["passed", "failed", "not_applicable"]),
  validation_reason: z.string(),
  deferred_items: z.array(
    z.object({
      item: z.string().min(1),
      defer_to_project: z.enum(["Project 2", "Project 3", "Project 5"]).nullable(),
      notes: z.string(),
    })
  ),
});

export type ArchitectureTurn = z.infer<typeof ArchitectureTurnSchema>;

export const EMIT_ARCHITECTURE_TURN_TOOL: Anthropic.Tool = {
  name: "emit_architecture_turn",
  description:
    "Report your structured turn output for the Screenplay Structural Architect conversation. Call this exactly once per turn.",
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
      routing_choice: {
        type: ["string", "null"],
        enum: ["A", "B", "C", null],
        description:
          "The author's current routing choice (Blueprint Priority / Chronological / Custom). Null only until the author has made a choice for the first time - once set, keep reporting the same value every turn unless the author explicitly changes it.",
      },
      active_step_number: {
        type: ["number", "null"],
        description: "Which of the 10 structural steps (1-10) is the current focus of discussion, or null if none.",
      },
      proposed_unit: {
        type: ["object", "null"],
        properties: {
          unit_id: { type: "string", description: "A stable identifier for this structural unit." },
          type: {
            type: "string",
            enum: ["Scene", "Sequence", "SetPiece", "PlotPoint"],
            description: "What kind of structural unit this is.",
          },
          content: {
            type: "string",
            description: "The unit's actual slugline + one dense 3-4 sentence structural paragraph, per the Scene Specification Format.",
          },
          requested_status: {
            type: "string",
            enum: ["Exploring", "Working", "Confirmed", "Parked"],
            description: "The status you are requesting for this unit this turn.",
          },
          canon_refs: {
            type: "array",
            items: { type: "string" },
            description: "IDs of any already-Confirmed Project 1-3 canon this unit draws from.",
          },
          proposed_position_percent: {
            type: ["number", "null"],
            description: "Your best estimate of where in the screenplay (0-100) this unit falls, or null if not applicable.",
          },
          causal_tag: {
            type: ["string", "null"],
            enum: ["Therefore", "But", "And Then", null],
            description:
              "How this unit's content transitions from whatever precedes it: \"Therefore\" (a direct consequence) or \"But\" (a complication) for a genuinely causal link; \"And Then\" for a coincidence-driven, episodic transition you are flagging rather than proposing for Confirmed status. Null only for the screenplay's absolute opening unit (Step 1, The Frame), which has no causal predecessor - every other unit must report one of the three string values, never null.",
          },
          causal_tag_reason: {
            type: "string",
            description: "A specific, concrete explanation for causal_tag, either way.",
          },
        },
        required: ["unit_id", "type", "content", "requested_status", "canon_refs", "proposed_position_percent", "causal_tag", "causal_tag_reason"],
        description: "The structural unit you are actively evaluating this turn, or null if none.",
      },
      validation_result: {
        type: "string",
        enum: ["passed", "failed", "not_applicable"],
        description:
          "\"passed\" only when you have genuinely checked proposed_unit against its step's Core Purpose and it satisfies it; \"failed\" when it doesn't; \"not_applicable\" when no unit is being evaluated this turn.",
      },
      validation_reason: {
        type: "string",
        description: "A specific, concrete explanation for validation_result, either way.",
      },
      deferred_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string", description: "What was raised." },
            defer_to_project: {
              type: ["string", "null"],
              enum: ["Project 2", "Project 3", "Project 5", null],
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
      "routing_choice",
      "active_step_number",
      "proposed_unit",
      "validation_result",
      "validation_reason",
      "deferred_items",
    ],
  },
};
