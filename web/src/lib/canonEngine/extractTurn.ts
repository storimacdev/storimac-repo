import Anthropic from "@anthropic-ai/sdk";
import { StateDeltaSchema, type StateDelta } from "./stateDelta";

/**
 * Structured state-delta extraction — GitHub issue #9, reference
 * implementation of the shared Canon Engine's StructuredDeltaExtractor
 * (ARCHITECTURE.md §2). One tool, forced every turn, whose own output
 * carries both the natural-language reply and the state delta as sibling
 * fields — this guarantees a single model call produces both (PRD §8
 * latency requirement), rather than hoping Claude mixes a text block and a
 * tool_use block when tool_choice is "auto" (unreliable) or doing two
 * round-trips (explicitly disallowed by the PRD).
 *
 * This module only extracts and schema-validates the delta — it does not
 * apply it to the canon store (canonStore.ts) or enforce stage-gating
 * (that's the FSM issue, #7). `conflict_detected` and
 * `stage_ready_to_advance` are passed through for the caller to act on.
 */

const EMIT_TURN_TOOL: Anthropic.Tool = {
  name: "emit_turn",
  description:
    "Emit your natural-language reply to the author together with the structured canon state delta for this turn. Call this exactly once per turn, even if updates is empty (e.g. a pure clarifying question with no canon change).",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "The natural-language reply shown to the author. Never narrate internal stage/depth/canon bookkeeping here.",
      },
      updates: {
        type: "array",
        description: "Canon element changes proposed this turn. Empty array if none.",
        items: {
          type: "object",
          properties: {
            element_id: { type: "string" },
            status: { type: "string", enum: ["Exploring", "Working", "Confirmed", "Parked"] },
            value: { description: "Author-facing value. Never a catalog/retrieval code - see retrieval_code." },
            retrieval_code: { description: "Internal-only catalog code (e.g. a 101 Story Formats code like A05), if applicable. Never author-facing." },
            rationale: { type: "string" },
            depends_on: { type: "array", items: { type: "string" } },
            stage: { type: "number" },
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
    required: ["reply", "updates", "conflict_detected", "stage_ready_to_advance"],
  },
};

export class StateDeltaValidationError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "StateDeltaValidationError";
    this.attempts = attempts;
  }
}

export type ExtractTurnParams = {
  anthropic: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  maxRetries?: number;
};

/**
 * Calls the model with emit_turn forced, validates the tool input against
 * StateDeltaSchema, and retries (re-issuing the same call) on an invalid
 * payload rather than silently applying malformed state - PRD §13's
 * flagged risk, addressed here rather than left to the model's discretion.
 */
export async function extractTurn(params: ExtractTurnParams): Promise<StateDelta> {
  const maxRetries = params.maxRetries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await params.anthropic.messages.create({
      model: params.model,
      // 1536 was too tight for a substantial natural-language reply plus the
      // structured updates payload in the same forced tool call - the model
      // would truncate mid-JSON (reply complete, updates/conflict_detected/
      // stage_ready_to_advance left undefined), failing schema validation on
      // both retry attempts and surfacing as a slow 502 in production
      // (2026-07-30: 4 failures, ~44-48s each, same session).
      max_tokens: params.maxTokens ?? 4096,
      system: params.system,
      messages: params.messages,
      tools: [EMIT_TURN_TOOL],
      tool_choice: { type: "tool", name: "emit_turn" },
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
      lastError = new Error("Model response contained no tool_use block for emit_turn.");
      continue;
    }

    const parsed = StateDeltaSchema.safeParse(toolUse.input);
    if (parsed.success) {
      return parsed.data;
    }
    lastError = parsed.error;
  }

  throw new StateDeltaValidationError(
    `Failed to extract a valid state delta after ${maxRetries + 1} attempt(s): ${String(lastError)}`,
    maxRetries + 1
  );
}
