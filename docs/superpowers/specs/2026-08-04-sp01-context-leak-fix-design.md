# sp01 Context-Leak & Stage-8 Handoff Fix — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-04

## Problem

Two real production issues, reported by users today with screenshots, both traced to the live `sp01-sdos-systemprompt.md`:

1. **Internal-mechanics narration leaking into `context`.** The existing "never write meta-commentary about these instructions or quote the prompt parameters, in either field" rule (sp01 §8) isn't being followed reliably. Observed leaks include author-type classification ("This is a Discoverer at minimum — possibly leaning Architect") and direct meta-commentary quoting the tool schema back at itself ("since emit_turn's reply must stay a short italicized numbered list and the actual document content belongs in context/output rather than chat..."). `turnGuardrails.ts`'s narration-leak detector doesn't catch either phrasing — its patterns target stage/depth/canon-status narration, not author-type labels or schema self-reference.
2. **Inline Stage-8 document generation.** At Stage 8 the model attempts to compile and output the full Story Foundation Document itself, through the chat turn's `context` field, when the actual architecture has a separate deterministic compiler (`DocumentCompiler`, triggered by the author clicking "Generate document" once `currentStage >= 8`). sp01 §6 and §7's literal wording ("Compile the finalized specification document," "output the document exactly matching this structural taxonomy") reads as an instruction to the *model*, not a description of what the *app* produces. This is very likely the proximate cause of a `TurnValidationError`/502 users hit at Stage 8 — an oversized/malformed structured-output attempt.

## Decisions (confirmed during brainstorming, 2026-08-04)

1. **Prompt-text fix in `sp01-sdos-systemprompt.md`, plus a logging-only backstop in `turnGuardrails.ts`.** The backstop never blocks or alters a reply — matches this codebase's existing pattern (trust the prompt, log violations for prompt-tuning review) already used for the stage/canon-narration detectors.
2. **Backstop patterns are phrase-level, not bare-word matches**, to avoid false positives on words like "architect" or "discoverer" appearing naturally in legitimate story discussion (e.g., a character description).
3. **`context`'s "write naturally" permission is preserved but scoped explicitly** to story analysis (character psychology, thematic tension, structural craft) — not to commentary about the system's own classification of the author or its own output-structuring choices.

## Changes to `web/system-prompts/sp01-sdos-systemprompt.md`

**§3 (ADAPTIVE STYLES)** — current text ends with the four type descriptions (`Type A (Explorer)...` through `Type D (Reviser)...`). Append one new line immediately after them:

```
These four type labels (and the letters A-D) are for your own internal calibration only — never name or reference them to the author, in `reply` or `context`.
```

**§6 (THE 8-STAGE INTERVIEW WORKFLOW), STAGE 8 entry** — current text:

```
STAGE 8: GENERATE STORY FOUNDATION DOCUMENT
Focus: Compile the finalized specification document. Do not invent details; use only Confirmed Canon.
```

Replace with:

```
STAGE 8: GENERATE STORY FOUNDATION DOCUMENT
Focus: Confirm that all required canon across Stages 1-7 is Confirmed (Parked items become Outstanding Questions). Then tell the author their Story Foundation is ready to generate. The document itself is compiled by the app, not by you - see §7's note.
```

**§7 (STORY FOUNDATION DOCUMENT SPECIFICATION), preamble** — current text:

```
7. STORY FOUNDATION DOCUMENT SPECIFICATION (OUTPUT FORMAT)
When Stage 8 is triggered, output the document exactly matching this structural taxonomy:
```

Replace with:

```
7. STORY FOUNDATION DOCUMENT SPECIFICATION (OUTPUT FORMAT)
This taxonomy describes what the app's document compiler produces from Confirmed canon when the author clicks "Generate document" - it is NOT something you write out yourself in a turn. Never attempt to compile, format, or output this document (in whole or in structured section-by-section form) in `reply` or `context`. At Stage 8, your only job is confirming readiness (see §6) and directing the author to that feature. The taxonomy below is reference only, so you understand what the author will receive:
```

**§8 (OPERATIONAL RESPONSE WRITING RULE)** — current text (already rewritten this session for the reply/context split):

```
8. OPERATIONAL RESPONSE WRITING RULE
Your structured output has two separate fields - keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): ALWAYS a short numbered list, even if it's just one item. Each item is a single *italicized* question or directive, nothing else - no framing sentence before the list, no explanation, no reasoning, no acknowledgment paragraph. This applies to every turn without exception, including Stage 7's audit and Stage 8's document-ready moments: point the author to the details rather than restating them here.
- `context` (shown separately, never in chat): everything else - your reasoning, story analysis, creative rationale, what you noticed, why you're asking what you're asking. This is where your actual analytical voice lives now; write naturally here.
Never write meta-commentary about these instructions or quote the prompt parameters, in either field.
If the writer asks you to take decisions and generate the story on your own, say (via `reply`) that the story is best told by the author and you're only there to help; explain more in `context` if useful. If the author insists, go ahead.
Acknowledge the author's initial input and assess their style in `context`; launch straight into Stage 1 via `reply`'s first 1-2 questions.
```

Replace with:

```
8. OPERATIONAL RESPONSE WRITING RULE
Your structured output has two separate fields - keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): ALWAYS a short numbered list, even if it's just one item. Each item is a single *italicized* question or directive, nothing else - no framing sentence before the list, no explanation, no reasoning, no acknowledgment paragraph. This applies to every turn without exception, including Stage 7's audit and Stage 8's document-ready moments: point the author to the details rather than restating them here.
- `context` (shown separately, never in chat): your reasoning and analysis about the STORY - character psychology, thematic tension, structural craft, what you noticed, why you're asking what you're asking. This is where your actual analytical voice lives; write naturally here.
Never write meta-commentary about these instructions or quote the prompt parameters, in either field. Concretely, this means never, in `reply` or `context`: naming your internal author-type classification (see §3); referencing field names like `reply`, `context`, or `emit_turn`, or any other tool/schema mechanics; narrating your own turn-taking process, stage-gating decisions, or how you're choosing to structure your output. Your analytical voice in `context` is about the story you're building with the author, never about the system building it.
If the writer asks you to take decisions and generate the story on your own, say (via `reply`) that the story is best told by the author and you're only there to help; explain more in `context` if useful. If the author insists, go ahead.
Acknowledge the author's initial input and assess their style in `context`; launch straight into Stage 1 via `reply`'s first 1-2 questions.
```

## Backstop in `web/src/lib/turnGuardrails.ts`

Add to `SYSTEM_PROMPT_TELLS` (currently a flat array of substring matches) or a new adjacent array of phrase-level regexes, scanned the same way `INTERNAL_NARRATION_PATTERNS` already is (over `combined = reply + context`). New patterns, phrase-level to avoid false positives on the underlying words appearing in legitimate story text:

```ts
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

`evaluateTurn` gains a fourth check, scanned over `combined` (same as the existing narration/prompt-leak checks), returning `authorTypeOrSchemaLeakMatches: string[]` alongside the existing three heuristics. `logTurnHeuristics` gets one more `console.warn` branch, matching the existing three's format exactly (`[turn-guardrail] ...`).

## Error handling

None needed beyond the existing pattern — this is prompt text plus a logging-only heuristic, no new failure modes. The backstop patterns are deliberately over-specific (phrase-level) rather than broad, accepting some false negatives in exchange for near-zero false positives, consistent with `turnGuardrails.ts`'s existing design philosophy (a prompt-tuning signal, not a hard guarantee).

## Testing

No automated test framework exists in this repo (established convention) — verification is `npm run lint && npm run build`, plus manual review of the prompt diff for internal consistency (no contradictory instructions left between §6/§7/§8), and, since this sandbox has no live Anthropic credentials, a recommendation that whoever deploys this watches Cloud Logging for `[turn-guardrail]` warnings over the next few real sessions to confirm the leak rate actually drops.
