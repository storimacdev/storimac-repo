import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { acquireAnthropicSlot, recordAnthropicUsage, estimateInputTokens } from "@/lib/rateLimit/anthropicGate";

/**
 * Structured turn extraction — GitHub issue #9, reference implementation of
 * the shared Canon Engine's StructuredDeltaExtractor (ARCHITECTURE.md §2).
 * One tool, forced every turn, whose own output carries both the
 * natural-language reply and a project-specific structured payload as
 * sibling fields — this guarantees a single model call produces both (PRD
 * §8 latency requirement), rather than hoping Claude mixes a text block and
 * a tool_use block when tool_choice is "auto" (unreliable) or doing two
 * round-trips (explicitly disallowed by the PRD).
 *
 * Generic over the tool/schema pair (issues #26/#27's Project 2 interview
 * engine is the second consumer, after Project 1's own emit_turn/
 * StateDeltaSchema in stateDelta.ts) so each project supplies its own shape
 * without duplicating this retry-loop-plus-rate-limit-gating logic.
 *
 * This module only extracts and schema-validates the payload — it does not
 * apply it to any store or enforce stage-gating; that's each caller's job.
 */

export class TurnValidationError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "TurnValidationError";
    this.attempts = attempts;
  }
}

export type ExtractTurnParams<T> = {
  anthropic: Anthropic;
  model: string;
  system: string;
  messages: Anthropic.MessageParam[];
  tool: Anthropic.Tool;
  schema: ZodType<T>;
  maxTokens?: number;
  maxRetries?: number;
};

/**
 * Calls the model with `params.tool` forced, validates the tool input
 * against `params.schema`, and retries (re-issuing the same call) on an
 * invalid payload rather than silently applying malformed state - PRD §13's
 * flagged risk, addressed here rather than left to the model's discretion.
 */
export async function extractTurn<T>(params: ExtractTurnParams<T>): Promise<T> {
  const maxRetries = params.maxRetries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const maxOutputTokens = params.maxTokens ?? 4096;
    // Each retry attempt gates independently, so worst-case added latency is
    // roughly (maxRetries + 1) * ANTHROPIC_GATE_MAX_WAIT_MS on top of model
    // latency - worth checking this against whatever request timeout the
    // deployment platform enforces if maxRetries or the gate's wait bound
    // ever change.
    const reservation = await acquireAnthropicSlot({
      inputTokens: estimateInputTokens(params.system, params.messages),
      maxOutputTokens,
    });

    const response = await params.anthropic.messages.create({
      model: params.model,
      // 1536 was too tight for a substantial natural-language reply plus a
      // structured payload in the same forced tool call - the model would
      // truncate mid-JSON, failing schema validation on both retry attempts
      // and surfacing as a slow 502 in production (2026-07-30: 4 failures,
      // ~44-48s each, same session, on Project 1's emit_turn). Each
      // project's own tool schema (see stateDelta.ts's EMIT_TURN_TOOL, the
      // reference example) should keep its long-form free-text field(s)
      // ordered last in properties/required, so a similar mid-JSON
      // truncation drops the free-text field instead of the short required
      // ones.
      max_tokens: maxOutputTokens,
      system: params.system,
      messages: params.messages,
      tools: [params.tool],
      tool_choice: { type: "tool", name: params.tool.name },
    });

    recordAnthropicUsage(reservation, response.usage.output_tokens);

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse) {
      lastError = new Error(`Model response contained no tool_use block for ${params.tool.name}.`);
      continue;
    }

    const parsed = params.schema.safeParse(toolUse.input);
    if (parsed.success) {
      return parsed.data;
    }
    lastError = parsed.error;
  }

  throw new TurnValidationError(
    `Failed to extract a valid turn after ${maxRetries + 1} attempt(s): ${String(lastError)}`,
    maxRetries + 1
  );
}
