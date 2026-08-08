import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { CHARACTER_FIELD_IDS } from "./factRegistry";

/**
 * Project 2 turn schema/tool — GitHub issues #26/#27 (base turn shape) and
 * #29 (per-fact canon-tracking `updates`). Reference: Project 1's
 * stateDelta.ts + extractTurn.ts's now-generic StructuredDeltaExtractor
 * (ARCHITECTURE.md §2). Issue #29's architecture note: configure the
 * shared Canon Engine with Project 2's own field vocabulary, not an
 * independent state store - same pattern as Project 1's stateDelta.ts.
 * `updates`' `field` enum is deliberately scoped to only the Psychological
 * Engine's 11 known fields (factRegistry.ts) - see that file's own comment
 * for why the other 5 interview stages aren't covered yet. `switch_override`
 * (issue #26) is consumed by characterFsm.ts's resolveCharacterTurn, not
 * used directly in this file. `conflict_detected`/`conflict_description`/
 * `resolution` (issue #30) mirror Project 1's stateDelta.ts equivalents,
 * but with P2's own resolution vocabulary (revert/update_foundation/park)
 * since P2's conflict is against another project's document, not against
 * its own prior canon - see docs/superpowers/specs/2026-08-08-p2-foundation-conflict-detection-design.md.
 * `relationship_updates` (issue #31) is a separate array from `updates`,
 * not an extension of it - a relationship's key is the other character's
 * ID, which can't be a closed enum like CHARACTER_FIELD_IDS since the
 * cast is dynamic per story. See docs/superpowers/specs/2026-08-08-p2-relationship-graph-design.md.
 */

export const FactUpdateSchema = z.object({
  field: z.string().min(1),
  value: z.unknown().optional(),
  state: z.enum(["Exploring", "Working", "Confirmed", "Deferred"]).optional(),
  rationale: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
});

export type FactUpdateInput = z.infer<typeof FactUpdateSchema>;

export const RelationshipUpdateSchema = z.object({
  with: z.string().min(1),
  dynamic: z.string().min(1),
  trust_trajectory: z.string().min(1),
  power_dynamic: z.string().min(1),
  state: z.enum(["Exploring", "Working", "Confirmed", "Deferred"]).optional(),
});

export type RelationshipUpdateInput = z.infer<typeof RelationshipUpdateSchema>;

export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  switch_override: z.boolean(),
  context: z.string().min(1),
  updates: z.array(FactUpdateSchema),
  conflict_detected: z.boolean(),
  conflict_description: z.string().optional(),
  resolution: z.enum(["revert", "update_foundation", "park"]).optional(),
  relationship_updates: z.array(RelationshipUpdateSchema),
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;

export const EMIT_CHARACTER_TURN_TOOL: Anthropic.Tool = {
  name: "emit_character_turn",
  description:
    "Emit your natural-language reply to the author together with your current interview position for this turn. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The chat-facing reply, ALWAYS formatted as a short numbered list (even a single item) of italicized questions/directives only - no framing prose, no explanation, no reasoning. Never narrate internal stage/tier/state-machine bookkeeping here.",
      },
      current_character: {
        type: "string",
        description:
          "The full name of the character currently under interview, exactly as it appears in the Story Foundation's cast list.",
      },
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-6) currently in progress for current_character: 1 Position & Purpose, 2 Psychological Core, 3 Outward Identity & Voice, 4 Relationship Integration, 5 Transformational Arc Pacing, 6 Sign-Off & Compile.",
      },
      character_signed_off: {
        type: "boolean",
        description:
          "True only on the turn where current_character completes Stage 6 sign-off. False every other turn, including all of Stages 1-5.",
      },
      switch_override: {
        type: "boolean",
        description:
          "True only on a turn where the author has explicitly asked to move to a different character before signing off the current one (e.g. 'let's switch to the antagonist for now'). False every other turn - do not set this just because the conversation touches another character in passing.",
      },
      context: {
        type: "string",
        description:
          "Your reasoning, psychological analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief. Keep it to a few short paragraphs at most - this is internal reasoning, not a transcript.",
      },
      updates: {
        type: "array",
        description:
          "Canon fact changes proposed this turn, for current_character only. Empty array if none - most turns during Stages 1, 3, 4, 5, and 6 will have none, since only the Psychological Engine's fields (Stage 2) are tracked as facts today.",
        items: {
          type: "object",
          properties: {
            field: {
              type: "string",
              enum: CHARACTER_FIELD_IDS,
              description:
                "The canonical fact field this update is for - always pick the closest match from the enum. Never invent a new key.",
            },
            value: { description: "Author-facing value for this fact." },
            state: {
              type: "string",
              enum: ["Exploring", "Working", "Confirmed", "Deferred"],
              description:
                "This fact's canon state. Only Confirmed facts will ever appear in the compiled Character Bible.",
            },
            rationale: { type: "string" },
            depends_on: {
              type: "array",
              items: { type: "string", enum: CHARACTER_FIELD_IDS },
              description:
                "Other field names (from this same character) this fact causally depends on - e.g. core_flaw depends on core_wound or false_belief. Used to verify the psychological chain stays traceable.",
            },
          },
          required: ["field"],
        },
      },
      conflict_detected: {
        type: "boolean",
        description:
          "True if any of this turn's proposed Confirmed facts contradict the Story Foundation grounding (Story Spine, Dramatic Engine) shown above. False otherwise.",
      },
      conflict_description: {
        type: "string",
        description:
          "Required when conflict_detected is true: plain-language explanation of the contradiction, naming both the proposed fact and the specific Foundation content it conflicts with. Omit otherwise.",
      },
      resolution: {
        type: "string",
        enum: ["revert", "update_foundation", "park"],
        description:
          "Only set this during a Conflict Resolution turn (a system note will tell you when you're in one), after the author picks one of the three choices you presented: revert the proposal, update Story Foundation canon, or park the idea for later.",
      },
      relationship_updates: {
        type: "array",
        description:
          "Relationship-graph changes proposed this turn, for current_character's relationship to another cast member. Empty array if none - most turns will have none; this is primarily populated during Stage 4 (Relationship Integration). All of dynamic/trust_trajectory/power_dynamic are required together whenever an entry is proposed at all - always restate the full current snapshot, never just the part that changed.",
        items: {
          type: "object",
          properties: {
            with: {
              type: "string",
              description: "The other character's full name, exactly as it appears in the Story Foundation's cast list.",
            },
            dynamic: { type: "string", description: "The relationship's core nature (e.g. mentor-student, rivals, found family)." },
            trust_trajectory: { type: "string", description: "How trust between them is moving (e.g. growing, eroding, stable)." },
            power_dynamic: { type: "string", description: "Who holds power/authority in the dynamic, and how." },
            state: {
              type: "string",
              enum: ["Exploring", "Working", "Confirmed", "Deferred"],
              description: "This relationship entry's canon state, same meaning as a fact's state.",
            },
          },
          required: ["with", "dynamic", "trust_trajectory", "power_dynamic"],
        },
      },
    },
    required: [
      "reply",
      "current_character",
      "current_stage",
      "character_signed_off",
      "switch_override",
      "context",
      "updates",
      "conflict_detected",
      "relationship_updates",
    ],
  },
};
