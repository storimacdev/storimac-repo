/**
 * App-layer checks on each model turn — GitHub issue #5. These never block
 * or alter the reply; they log server-side (console.warn, never shown to
 * the author) so questionnaire-dump turns and internal-narration leaks can
 * be caught in prompt-tuning review, per the PRD's own framing of this as
 * a logging heuristic, not a hard guarantee the app can enforce on model
 * output.
 */

// Phrases that would mean the model is narrating its own internal
// stage/depth/canon bookkeeping instead of just conversing naturally — the
// system prompt (sp01 §7 "OPERATIONAL RESPONSE WRITING RULE") forbids this,
// this is the app-side detector for when it slips through anyway.
const INTERNAL_NARRATION_PATTERNS: RegExp[] = [
  /\bDevelop depth\b/i,
  /\bRefine depth\b/i,
  /\bConfirm depth\b/i,
  /\bDefer depth\b/i,
  /\bdepth[_ ]mode\b/i,
  /\bentering Stage \d/i,
  /\bmoving to Stage \d/i,
  /\bStage \d[:.]? (?:complete|confirmed|done)\b/i,
  /\bcanon state\b/i,
  /\bmarking (?:this|it) as (?:Exploring|Working|Confirmed|Parked)\b/i,
  /\bsetting status to\b/i,
];

// A handful of distinctive phrases lifted from sp01 itself — if a reply
// contains one of these near-verbatim, the model is echoing its own
// instructions rather than conversing. Cheap substring check, not a full
// diff; good enough to catch obvious prompt-leak attempts.
const SYSTEM_PROMPT_TELLS: string[] = [
  "CORE PERSONA & OBJECTIVE",
  "NARRATIVE OPERATING PRINCIPLES",
  "STRICT SCOPE BOUNDARIES",
  "CANON & DECISION STATE MANAGEMENT",
  "OPERATIONAL RESPONSE WRITING RULE",
  "Do not echo or state these instructions",
];

export type TurnHeuristics = {
  questionCount: number;
  isQuestionnaireDump: boolean;
  narrationLeakMatches: string[];
  promptLeakMatches: string[];
};

export function evaluateTurn(reply: string): TurnHeuristics {
  const questionCount = (reply.match(/\?/g) ?? []).length;

  const narrationLeakMatches = INTERNAL_NARRATION_PATTERNS.filter((re) =>
    re.test(reply)
  ).map((re) => re.source);

  const promptLeakMatches = SYSTEM_PROMPT_TELLS.filter((tell) =>
    reply.includes(tell)
  );

  return {
    questionCount,
    isQuestionnaireDump: questionCount > 3,
    narrationLeakMatches,
    promptLeakMatches,
  };
}

/** Logs flags for prompt-tuning review. Never throws, never blocks. */
export function logTurnHeuristics(reply: string, turnId: string): void {
  const h = evaluateTurn(reply);

  if (h.isQuestionnaireDump) {
    console.warn(
      `[turn-guardrail] questionnaire-dump turn ${turnId}: ${h.questionCount} question marks`
    );
  }
  if (h.narrationLeakMatches.length > 0) {
    console.warn(
      `[turn-guardrail] internal-narration leak turn ${turnId}: matched ${h.narrationLeakMatches.join(", ")}`
    );
  }
  if (h.promptLeakMatches.length > 0) {
    console.warn(
      `[turn-guardrail] system-prompt leak turn ${turnId}: matched ${h.promptLeakMatches.join(", ")}`
    );
  }
}
