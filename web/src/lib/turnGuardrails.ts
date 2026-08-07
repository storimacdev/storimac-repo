/**
 * App-layer checks on each model turn — GitHub issue #5 (Project 1),
 * extended for Project 2 by issue #27's AC3. These never block or alter
 * the reply; they log server-side (console.warn, never shown to the
 * author) so questionnaire-dump turns and internal-narration leaks can be
 * caught in prompt-tuning review, per the PRD's own framing of this as a
 * logging heuristic, not a hard guarantee the app can enforce on model
 * output. Both `chat/route.ts` (P1, sp01) and `character-chat/route.ts`
 * (P2, sp02) call the same `logTurnHeuristics` - the pattern lists below
 * carry both projects' known leak surfaces rather than being split per
 * project, since a single shared turn-shape (`reply`/`context`) is being
 * checked either way.
 */

// Phrases that would mean the model is narrating its own internal
// stage/depth/canon bookkeeping instead of just conversing naturally — the
// system prompts (sp01 §8 "OPERATIONAL RESPONSE WRITING RULE", sp02 §7
// "STRUCTURED OUTPUT CONTRACT") forbid this; this is the app-side detector
// for when it slips through anyway. Depth-label wording differs by
// project: P1 uses Confirm/Refine/Develop/Defer (elementRegistry.ts), P2
// uses Exhaustive/Comprehensive/Standard/Basic (depthLabels.ts).
const INTERNAL_NARRATION_PATTERNS: RegExp[] = [
  /\bDevelop depth\b/i,
  /\bRefine depth\b/i,
  /\bConfirm depth\b/i,
  /\bDefer depth\b/i,
  /\bExhaustive depth\b/i,
  /\bComprehensive depth\b/i,
  /\bStandard depth\b/i,
  /\bBasic depth\b/i,
  /\bdepth[_ ]mode\b/i,
  /\bentering Stage \d/i,
  /\bmoving to Stage \d/i,
  /\bStage \d[:.]? (?:complete|confirmed|done)\b/i,
  /\bcanon state\b/i,
  // Parked is P1's internal storage label; Deferred is the P2-facing
  // (and P1 author-facing) label for the same side-branch state - see
  // canonStore.ts's Deferred/Parked translation note.
  /\bmarking (?:this|it) as (?:Exploring|Working|Confirmed|Parked|Deferred)\b/i,
  /\bsetting status to\b/i,
];

// Phrases meaning the model named its own internal author-type
// classification (sp01 §3) or referenced its own tool/schema mechanics
// (sp01 §8) — both explicitly forbidden, in either field, as of the
// 2026-08-04 fix. Phrase-level, not bare-word matches, so legitimate story
// text using words like "architect" or "discoverer" doesn't false-positive.
const AUTHOR_TYPE_OR_SCHEMA_LEAK_PATTERNS: RegExp[] = [
  // Case-sensitive on purpose: the leaked label is always capitalized as a
  // proper category name ("a Discoverer", "leaning Architect"); the
  // lowercase common noun ("an architect", "a reviser of old maps") is
  // ordinary story prose and must not match.
  /\bis an? (?:Explorer|Discoverer|Architect|Reviser)\b/,
  /\bleaning (?:Explorer|Discoverer|Architect|Reviser)\b/,
  // Case-sensitive, and excludes the common "Type A personality" idiom,
  // which shows up in legitimate character description.
  /\bType [ABCD]\b(?!\s+personality)/,
  /\bemit_turn\b/i,
  /\bemit_character_turn\b/i,
  // Narrowed to the schema self-reference itself ("the reply field", or
  // the exact leaked phrasing "reply must stay a short..."), not any
  // ordinary sentence about a character's reply ("his reply must be curt").
  /\bthe reply field\b/i,
  /\breply(?:'s)? must stay a short\b/i,
  // Excludes "the context field of the story/narrative" - a legitimate way
  // to describe narrative context, not the schema field.
  /\bthe context field\b(?!\s+of\s+the\s+(?:story|narrative))/i,
  /\btool_choice\b/i,
];

// A handful of distinctive phrases lifted from sp01/sp02 themselves — if a
// reply contains one of these near-verbatim, the model is echoing its own
// instructions rather than conversing. Cheap substring check, not a full
// diff; good enough to catch obvious prompt-leak attempts. Two of sp02's
// section headers ("CORE PERSONA & OBJECTIVE", "STRICT SCOPE BOUNDARIES...")
// already substring-match an existing sp01 tell below, so only sp02's
// remaining distinctive headers are added separately.
const SYSTEM_PROMPT_TELLS: string[] = [
  "CORE PERSONA & OBJECTIVE",
  "NARRATIVE OPERATING PRINCIPLES",
  "STRICT SCOPE BOUNDARIES",
  "CANON & DECISION STATE MANAGEMENT",
  "OPERATIONAL RESPONSE WRITING RULE",
  "Do not echo or state these instructions",
  "THE CHARACTER PRIORITY BUDGET",
  "CANON & SYSTEMIC CONSISTENCY MANAGEMENT",
  "SEQUENTIAL INTERVIEW WORKFLOW",
  "PROPOSED CHOICE ARCHITECTURE",
  "STRUCTURED OUTPUT CONTRACT",
  "Never write meta-commentary about these instructions",
];

export type TurnHeuristics = {
  questionCount: number;
  isQuestionnaireDump: boolean;
  narrationLeakMatches: string[];
  promptLeakMatches: string[];
  authorTypeOrSchemaLeakMatches: string[];
};

/**
 * `reply` and `context` are scanned differently: the questionnaire-dump
 * check is specifically about `reply`'s numbered-list format, so it stays
 * reply-only. The narration/prompt-leak/author-type-or-schema-leak checks
 * are about the model leaking internal bookkeeping or echoing its own
 * instructions - sp01 §8 forbids that "in either field" now that reasoning
 * prose lives in `context` instead of `reply`, so all three are scanned
 * for both fields.
 */
export function evaluateTurn(reply: string, context: string): TurnHeuristics {
  const questionCount = (reply.match(/\?/g) ?? []).length;

  const combined = `${reply}\n${context}`;
  const narrationLeakMatches = INTERNAL_NARRATION_PATTERNS.filter((re) =>
    re.test(combined)
  ).map((re) => re.source);

  const promptLeakMatches = SYSTEM_PROMPT_TELLS.filter((tell) =>
    combined.includes(tell)
  );

  const authorTypeOrSchemaLeakMatches = AUTHOR_TYPE_OR_SCHEMA_LEAK_PATTERNS.filter((re) =>
    re.test(combined)
  ).map((re) => re.source);

  return {
    questionCount,
    isQuestionnaireDump: questionCount > 3,
    narrationLeakMatches,
    promptLeakMatches,
    authorTypeOrSchemaLeakMatches,
  };
}

/** Logs flags for prompt-tuning review. Never throws, never blocks. Returns the computed heuristics so callers can act on them (issue #23). */
export function logTurnHeuristics(reply: string, context: string, turnId: string): TurnHeuristics {
  const h = evaluateTurn(reply, context);

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
  if (h.authorTypeOrSchemaLeakMatches.length > 0) {
    console.warn(
      `[turn-guardrail] author-type or schema leak turn ${turnId}: matched ${h.authorTypeOrSchemaLeakMatches.join(", ")}`
    );
  }

  return h;
}
