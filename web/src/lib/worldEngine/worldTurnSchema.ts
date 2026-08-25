import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Project 3 turn schema/tool - GitHub issue #38 (base turn shape for
 * Stage 1). Reference: Project 1's stateDelta.ts + extractTurn.ts's
 * generic StructuredDeltaExtractor (ARCHITECTURE.md §2), and Project 2's
 * characterTurnSchema.ts for the same reply/context/current_stage shape.
 * Deliberately minimal for this issue - no canon-state updates, no
 * guardrail/conflict fields yet, since the Canon Registry (#41), scope
 * guardrails (#46), and Conflict Resolution (#47) haven't been built.
 * Every later Phase 1-3 issue extends this same schema, the same way
 * Project 2's grew incrementally across issues #26/#28/#30/#31/#32.
 */

export const WORLD_STAGE_NAMES: Record<number, string> = {
  1: "Understand",
  2: "Assess & Pillar Mapping",
  3: "Prioritize & Deep Dive",
  4: "System Integration Audit",
  5: "Compile",
};

export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
});

export type WorldTurn = z.infer<typeof WorldTurnSchema>;

export const EMIT_WORLD_TURN_TOOL: Anthropic.Tool = {
  name: "emit_world_turn",
  description:
    "Emit your natural-language reply to the author together with your current interview position for this turn. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The chat-facing reply: your structural assessment, proposed World Complexity Level, and/or discovery questions, as natural conversational prose. Never narrate internal stage bookkeeping here.",
      },
      context: {
        type: "string",
        description:
          "Your internal reasoning for this turn - why you assessed things the way you did, what you noticed, anything relevant to the next turn. Shown to the author separately from chat, never inside reply. Required every turn, even if brief.",
      },
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-5) currently in progress: 1 Understand, 2 Assess & Pillar Mapping, 3 Prioritize & Deep Dive, 4 System Integration Audit, 5 Compile.",
      },
    },
    required: ["reply", "context", "current_stage"],
  },
};
