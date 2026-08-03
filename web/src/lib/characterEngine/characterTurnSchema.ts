import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Project 2 turn schema/tool — GitHub issues #26/#27, reference: Project
 * 1's stateDelta.ts + extractTurn.ts's now-generic StructuredDeltaExtractor
 * (ARCHITECTURE.md §2). Deliberately minimal: no per-fact canon-tracking
 * field yet (that's issue #29's job, milestone M2) — just enough structured
 * output to drive sequential-character enforcement and the reply/context UI
 * split already proven on Project 1.
 */

export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  context: z.string().min(1),
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
      context: {
        type: "string",
        description:
          "Your reasoning, psychological analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief. Keep it to a few short paragraphs at most - this is internal reasoning, not a transcript.",
      },
    },
    required: ["reply", "current_character", "current_stage", "character_signed_off", "context"],
  },
};
