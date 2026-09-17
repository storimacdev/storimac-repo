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
      // Upper bound added for issue #66's final whole-branch review
      // finding I3: checkSceneRegisterFormat's sentence-splitting and
      // beat-tag regexes are quadratic in content's length (bounded
      // input, not exponential backtracking, but still real - measured
      // multi-second event-loop blocking on a crafted ~80KB string). A
      // genuine scene entry (slugline + one dense 3-4 sentence
      // paragraph) is a few hundred characters at most; 8000 is
      // generous headroom, not a realistic ceiling for honest content.
      content: z.string().min(1).max(8000),
      requested_status: z.enum(["Exploring", "Working", "Confirmed", "Parked"]),
      canon_refs: z.array(z.string()),
      proposed_position_percent: z.number().min(0).max(100).nullable(),
      causal_tag: z.enum(["Therefore", "But", "And Then"]).nullable(),
      causal_tag_reason: z.string(),
      canon_contradiction: z
        .object({
          contradicted_ref: z.string().min(1),
          source_project: z.enum(["Project 1", "Project 2", "Project 3"]),
          explanation: z.string().min(1),
        })
        .nullable(),
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
  resolution: z.enum(["revert", "accept_and_update", "park"]).nullable(),
  structural_vector_options: z
    .object({
      unit_id: z.string().min(1),
      options: z
        .array(
          z.object({
            content: z.string().min(1),
            pacing_impact: z.string().min(1),
            downstream_requirements: z.string().min(1),
            thematic_impact: z.string().min(1),
          })
        )
        .min(2)
        .max(5),
    })
    .nullable(),
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
            description: "The unit's actual slugline + one dense 3-4 sentence structural paragraph, per the Scene Specification Format (max 8000 characters).",
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
          canon_contradiction: {
            type: ["object", "null"],
            properties: {
              contradicted_ref: { type: "string", description: "The id of the already-locked Project 1-3 canon reference this unit's content contradicts." },
              source_project: {
                type: "string",
                enum: ["Project 1", "Project 2", "Project 3"],
                description: "Which project owns the contradicted canon.",
              },
              explanation: { type: "string", description: "A specific, concrete explanation of the contradiction." },
            },
            required: ["contradicted_ref", "source_project", "explanation"],
            description: "Set only when this unit's proposed content contradicts an already-locked Project 1-3 fact it cites via canon_refs. Null in every ordinary turn.",
          },
        },
        required: [
          "unit_id",
          "type",
          "content",
          "requested_status",
          "canon_refs",
          "proposed_position_percent",
          "causal_tag",
          "causal_tag_reason",
          "canon_contradiction",
        ],
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
      resolution: {
        type: ["string", "null"],
        enum: ["revert", "accept_and_update", "park", null],
        description:
          "Set only on the turn immediately after the author picks one of the three choices presented for an open Canon Revision Path conflict (see your grounding). Null on every other turn.",
      },
      structural_vector_options: {
        type: ["object", "null"],
        properties: {
          unit_id: {
            type: "string",
            description: "The structural unit these options are for - reuse its exact id if it already appears in Structural Units So Far, mint a fresh id only for a genuinely new unit.",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                content: { type: "string", description: "A rough structural description of this approach - not full Scene Specification Format, since the author hasn't chosen it yet." },
                pacing_impact: { type: "string", description: "This option's pacing/hierarchy impact." },
                downstream_requirements: { type: "string", description: "The downstream setup/payoff requirements this option would create." },
                thematic_impact: { type: "string", description: "This option's impact on character transformation timing and thematic resolution." },
              },
              required: ["content", "pacing_impact", "downstream_requirements", "thematic_impact"],
            },
            description: "2-5 distinct structural approaches, each stating all three required impacts.",
          },
        },
        required: ["unit_id", "options"],
        description: "Set only when the author seems stuck on a structural unit or explicitly asks for options. Null on every other turn - never set in the same turn as proposed_unit.",
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
      "resolution",
      "structural_vector_options",
    ],
  },
};
