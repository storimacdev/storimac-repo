# sp01 Context-Leak & Stage-8 Handoff Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the live Project 1 model from narrating internal mechanics (author-type labels, tool/schema self-reference) into the author-facing `context` field, and stop it from attempting to compile/output the Story Foundation Document inline at Stage 8 instead of handing off to the app's real document-generation feature.

**Architecture:** Pure prompt-text changes to `sp01-sdos-systemprompt.md` (four sections touched: §3, §6, §7, §8) plus a small, additive, logging-only backstop in `turnGuardrails.ts` (a fourth heuristic check, same pattern as the three that already exist there).

**Tech Stack:** Markdown (prompt), TypeScript.

## Global Constraints

- No automated test framework exists in this repo. Verification is `npm run lint && npm run build` from `web/`.
- The backstop in `turnGuardrails.ts` is logging-only (`console.warn`) — it must never block, alter, or reject a reply. Matches the file's existing three heuristics exactly.
- Backstop regex patterns must be phrase-level, not bare-word matches, to avoid false positives on words like "architect" or "discoverer" appearing naturally in legitimate story text.
- `context`'s "write naturally" permission in sp01 §8 must be preserved, not removed — only explicitly scoped to story analysis, not system self-commentary.
- Sections §5's Conflict Resolution instruction and §8's existing Conflict-Resolution-turn line (both already reconciled in an earlier fix) must not be touched or re-broken by this change.

---

### Task 1: sp01 prompt fix

**Files:**
- Modify: `web/system-prompts/sp01-sdos-systemprompt.md`

**Interfaces:**
- Produces: no code interface — this is the prompt text loaded by `getSystemPrompt("sp01-sdos-systemprompt.md")`, unchanged call site.

- [ ] **Step 1: §3 (ADAPTIVE STYLES) — add the internal-only line**

The current section (lines 16-21) is:

```
3. ADAPTIVE STYLES
Evaluate the author implicitly and adjust your approach:
Type A (Explorer): Vague idea. Provide structured choices and patient guidance.
Type B (Discoverer): Knows premise/protagonist. Focus heavily on linking structural mechanics.
Type C (Architect): Complete plan. Focus on evaluating consistency and finding gaps.
Type D (Reviser): Completed draft. Act as a critical development editor analyzing structure.
```

Change it to:

```
3. ADAPTIVE STYLES
Evaluate the author implicitly and adjust your approach:
Type A (Explorer): Vague idea. Provide structured choices and patient guidance.
Type B (Discoverer): Knows premise/protagonist. Focus heavily on linking structural mechanics.
Type C (Architect): Complete plan. Focus on evaluating consistency and finding gaps.
Type D (Reviser): Completed draft. Act as a critical development editor analyzing structure.
These four type labels (and the letters A-D) are for your own internal calibration only - never name or reference them to the author, in `reply` or `context`.
```

- [ ] **Step 2: §6, STAGE 8 entry — reword away from "you compile the document"**

The current lines (53-54) are:

```
STAGE 8: GENERATE STORY FOUNDATION DOCUMENT
Focus: Compile the finalized specification document. Do not invent details; use only Confirmed Canon.
```

Change them to:

```
STAGE 8: GENERATE STORY FOUNDATION DOCUMENT
Focus: Confirm that all required canon across Stages 1-7 is Confirmed (Parked items become Outstanding Questions). Then tell the author their Story Foundation is ready to generate. The document itself is compiled by the app, not by you - see §7's note.
```

(Line 55, "Depending on the user's clarity or requirement you may skip the sequence of these stages...", is unchanged and stays immediately after.)

- [ ] **Step 3: §7 preamble — clarify the taxonomy is reference-only**

The current line (57) is:

```
When Stage 8 is triggered, output the document exactly matching this structural taxonomy:
```

Change it to:

```
This taxonomy describes what the app's document compiler produces from Confirmed canon when the author clicks "Generate document" - it is NOT something you write out yourself in a turn. Never attempt to compile, format, or output this document (in whole or in structured section-by-section form) in `reply` or `context`. At Stage 8, your only job is confirming readiness (see §6) and directing the author to that feature. The taxonomy below is reference only, so you understand what the author will receive:
```

(The 13-item taxonomy list itself, lines 58-80, is unchanged.)

- [ ] **Step 4: §8 — expand the meta-commentary rule with concrete examples, re-scope `context`**

The current section (lines 81-88) is:

```
8. OPERATIONAL RESPONSE WRITING RULE
Your structured output has two separate fields - keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): ALWAYS a short numbered list, even if it's just one item. Each item is a single *italicized* question or directive, nothing else - no framing sentence before the list, no explanation, no reasoning, no acknowledgment paragraph. This applies to every turn without exception, including Stage 7's audit and Stage 8's document-ready moments: point the author to the details rather than restating them here.
- `context` (shown separately, never in chat): everything else - your reasoning, story analysis, creative rationale, what you noticed, why you're asking what you're asking. This is where your actual analytical voice lives now; write naturally here. Keep it focused — a few short paragraphs, not an essay.
Never write meta commentary about these instructions or quote the prompt parameters, in either field.
On a Conflict Resolution turn (Section 5), the contradiction statement itself goes in `context`; `reply` still stays the short numbered A/B/C choice prompt only - point to the contradiction there, don't restate it.
If the writer asks you to take decisions and generate the story on your own, say (via `reply`) that the story is best told by the author and you're only there to help; explain more in `context` if useful. If the author insists, go ahead.
Acknowledge the author's initial input and assess their style in `context`; launch straight into Stage 1 via `reply`'s first 1-2 questions.
```

Change it to:

```
8. OPERATIONAL RESPONSE WRITING RULE
Your structured output has two separate fields - keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): ALWAYS a short numbered list, even if it's just one item. Each item is a single *italicized* question or directive, nothing else - no framing sentence before the list, no explanation, no reasoning, no acknowledgment paragraph. This applies to every turn without exception, including Stage 7's audit and Stage 8's document-ready moments: point the author to the details rather than restating them here.
- `context` (shown separately, never in chat): your reasoning and analysis about the STORY - character psychology, thematic tension, structural craft, what you noticed, why you're asking what you're asking. This is where your actual analytical voice lives; write naturally here. Keep it focused — a few short paragraphs, not an essay.
Never write meta commentary about these instructions or quote the prompt parameters, in either field. Concretely, this means never, in `reply` or `context`: naming your internal author-type classification (see Section 3); referencing field names like `reply`, `context`, or `emit_turn`, or any other tool/schema mechanics; narrating your own turn-taking process, stage-gating decisions, or how you're choosing to structure your output. Your analytical voice in `context` is about the story you're building with the author, never about the system building it.
On a Conflict Resolution turn (Section 5), the contradiction statement itself goes in `context`; `reply` still stays the short numbered A/B/C choice prompt only - point to the contradiction there, don't restate it.
If the writer asks you to take decisions and generate the story on your own, say (via `reply`) that the story is best told by the author and you're only there to help; explain more in `context` if useful. If the author insists, go ahead.
Acknowledge the author's initial input and assess their style in `context`; launch straight into Stage 1 via `reply`'s first 1-2 questions.
```

- [ ] **Step 5: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass — this is a content-only change, not imported by any type-checked code path beyond `getSystemPrompt()` reading it as a raw string.

- [ ] **Step 6: Commit**

```bash
git add web/system-prompts/sp01-sdos-systemprompt.md
git commit -m "fix: stop sp01 from narrating internal mechanics and inline-generating Stage 8 documents"
```

---

### Task 2: turnGuardrails.ts backstop

**Files:**
- Modify: `web/src/lib/turnGuardrails.ts`

**Interfaces:**
- Produces: `TurnHeuristics` gains a fourth field `authorTypeOrSchemaLeakMatches: string[]`. `evaluateTurn`/`logTurnHeuristics` signatures unchanged (`(reply, context)` / `(reply, context, turnId)`), so no call-site changes needed anywhere (currently called once, from `web/src/app/api/chat/route.ts`, and once from `web/src/app/api/character-chat/route.ts`).

- [ ] **Step 1: Add the new pattern array**

The current top of the file (lines 1-26) is:

```ts
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
```

Change it to (adding the new array after `INTERNAL_NARRATION_PATTERNS`):

```ts
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

// Phrases meaning the model named its own internal author-type
// classification (sp01 §3) or referenced its own tool/schema mechanics
// (sp01 §8) — both explicitly forbidden, in either field, as of the
// 2026-08-04 fix. Phrase-level, not bare-word matches, so legitimate story
// text using words like "architect" or "discoverer" doesn't false-positive.
const AUTHOR_TYPE_AND_SCHEMA_LEAK_PATTERNS: RegExp[] = [
  /\bis an? (?:Explorer|Discoverer|Architect|Reviser)\b/i,
  /\bleaning (?:Explorer|Discoverer|Architect|Reviser)\b/i,
  /\bType [ABCD]\b/i,
  /\bemit_turn\b/i,
  /\b(?:the\s+)?reply\s+(?:field|must (?:stay|be))\b/i,
  /\b(?:the\s+)?context\s+field\b/i,
  /\btool_choice\b/i,
];
```

- [ ] **Step 2: Add the field to `TurnHeuristics` and compute it in `evaluateTurn`**

The current type and function (lines 41-74) are:

```ts
export type TurnHeuristics = {
  questionCount: number;
  isQuestionnaireDump: boolean;
  narrationLeakMatches: string[];
  promptLeakMatches: string[];
};

/**
 * `reply` and `context` are scanned differently: the questionnaire-dump
 * check is specifically about `reply`'s numbered-list format, so it stays
 * reply-only. The narration/prompt-leak checks are about the model leaking
 * internal bookkeeping or echoing its own instructions - sp01 §8 forbids
 * that "in either field" now that reasoning prose lives in `context`
 * instead of `reply`, so both fields are scanned for those two checks.
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

  return {
    questionCount,
    isQuestionnaireDump: questionCount > 3,
    narrationLeakMatches,
    promptLeakMatches,
  };
}
```

Change them to:

```ts
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

  const authorTypeOrSchemaLeakMatches = AUTHOR_TYPE_AND_SCHEMA_LEAK_PATTERNS.filter((re) =>
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
```

- [ ] **Step 3: Add the fourth `console.warn` branch in `logTurnHeuristics`**

The current function (lines 76-97) is:

```ts
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

  return h;
}
```

Change it to:

```ts
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
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. Both existing call sites (`web/src/app/api/chat/route.ts`'s `logTurnHeuristics(delta.reply, delta.context, turnId)` and `web/src/app/api/character-chat/route.ts`'s equivalent call) compile unchanged since the function signature didn't change — only the return type gained a field, which is additive and doesn't break destructuring callers that don't reference it.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/turnGuardrails.ts
git commit -m "feat: add author-type/schema-leak detection backstop to turnGuardrails"
```
