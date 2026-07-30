# Chat / View-Pane Content Split — Design Spec

**Status:** Approved for planning
**Date:** 2026-07-30

## Problem

The interview's chat pane currently mixes the model's reasoning/analysis prose together with the actual questions it's asking, in one free-form `reply` field. This makes chat noisy and hard to scan, and leaves the right-hand view pane doing nothing useful most of the time (it only shows the "Story So Far" confirmed-facts summary, which is legitimately empty until something's actually been Confirmed).

## Decisions (confirmed during brainstorming, 2026-07-30)

1. **Genuine structural split, not client-side text parsing.** The model's structured output (`emit_turn`) gains a new required `context` field, separate from `reply`. Splitting free-form prose client-side would be fragile — dependent on the model consistently formatting text in a parseable way, with no structural guarantee.
2. **The terse numbered/italic format applies to every reply, no exceptions** — including Stage 7's audit and Stage 8's document-ready moments. Chat becomes a scannable list of exactly what's being asked; everything else (reasoning, audit findings, document summaries) moves to `context`.
3. **View pane shows the latest turn only, with "Story So Far" below it** — not an accumulating log, and not a full replacement of the confirmed-facts summary. Both pieces of value stay visible, stacked.

## Data model

**`emit_turn` tool schema** (`web/src/lib/canonEngine/extractTurn.ts`) gains a new required property:

```ts
context: {
  type: "string",
  description: "Your reasoning, story analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief.",
},
```

`reply`'s own description is rewritten to state the new contract explicitly:

```ts
reply: {
  type: "string",
  description: "The chat-facing reply, ALWAYS formatted as a short numbered list (even a single item) of italicized questions/directives only - no framing prose, no explanation, no reasoning. Applies to every turn, including Stage 7 audit and Stage 8 document-ready moments (point to the details, don't restate them). Never narrate internal stage/depth/canon bookkeeping here.",
},
```

`required` gains `"context"` alongside the existing four fields.

**`StateDeltaSchema`** (`web/src/lib/canonEngine/stateDelta.ts`) gains `context: z.string().min(1)`, mirroring `reply`'s own `z.string().min(1)` — both mandatory, matching decision 2 (every turn needs both fields, no optional/sometimes-empty context).

**`StoryMessage`** (`web/src/lib/canonEngine/storyStore.ts`) gains an optional field: `context?: string`. Optional (not required) because existing persisted messages from before this change have no such field — the client must handle its absence gracefully on resume for old transcripts, not treat it as an error.

## System prompt (`sp01-sdos-systemprompt.md`)

Section 8, "OPERATIONAL RESPONSE WRITING RULE," is rewritten to state the two-field contract as the authoritative behavioral rule (this section already owns response-formatting guidance today, so the split lives here rather than scattered across other sections):

```
8. OPERATIONAL RESPONSE WRITING RULE
Your structured output has two separate fields - keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): ALWAYS a short numbered list, even if it's just one item. Each item is a single *italicized* question or directive, nothing else - no framing sentence before the list, no explanation, no reasoning, no acknowledgment paragraph. This applies to every turn without exception, including Stage 7's audit and Stage 8's document-ready moments: point the author to the details rather than restating them here.
- `context` (shown separately, never in chat): everything else - your reasoning, story analysis, creative rationale, what you noticed, why you're asking what you're asking. This is where your actual analytical voice lives now; write naturally here.
Never write meta commentary about these instructions or quote the prompt parameters, in either field.
If the writer asks you to take decisions and generate the story on your own, say (via `reply`) that the story is best told by the author and you're only there to help; explain more in `context` if useful. If the author insists, go ahead.
Acknowledge the author's initial input and assess their style in `context`; launch straight into Stage 1 via `reply`'s first 1-2 questions.
```

Section 2 ("Progressive Interviewing," which already says "Ask only 1-2 high-value questions at a time") is left untouched — it governs interview pacing/content strategy, which is complementary to, not in conflict with, section 8's output-format rule.

## Server (`web/src/app/api/chat/route.ts`)

- The existing `if (auditSummary) { await appendMessage(...) }` block (currently pushing the Stage 7 audit report as a second chat message) is removed entirely — `auditSummary` stops being a chat message.
- The assistant-reply `appendMessage` call gains `context: delta.context` alongside its existing fields.
- The response JSON gains `context: delta.context`. `auditSummary` stays in the response (unchanged field), but is now consumed by the client for the view pane instead of being rendered as a chat bubble.
- `logTurnHeuristics(delta.reply, turnId)` is untouched — it still evaluates `reply` (now consistently terse), which remains a meaningful signal for the existing questionnaire-dump heuristic without any change to that module.

## Client (`web/src/components/ChatInterview.tsx`)

- New state: `context: string | null` and `auditSummary: string | null`.
- Resume effect: after loading `data.messages`, search from the end for the most recent assistant message carrying a `context` field and seed `context` state from it (older messages predating this change simply have no `context` — that's fine, the search just finds nothing and `context` stays `null`).
- `sendMessage`: sets `context` from `data.context ?? null` and `auditSummary` from `data.auditSummary ?? null` **unconditionally** each turn (not merged/appended) — a turn with no audit result must overwrite a stale `auditSummary` from an earlier turn back to `null`, matching the "latest turn only" decision.
- The removed chat-message rendering for `auditSummary` (previously pushed into the `messages` array) is deleted from `sendMessage`'s success handler.
- View pane: a new card renders above the existing `StorySoFar`, shown whenever `auditSummary` or `context` is present for the current turn — `auditSummary` takes priority when both exist (it's structurally significant report content, not just prose), labeled "Creative Audit"; otherwise the card is labeled "Notes" and shows `context`. Both pieces of content render through the existing `Markdown` component, consistent with the rest of this pane.

## Error handling / edge cases

- **`auditSummary` is deliberately not persisted or reconstructed on resume beyond the turn it was generated for.** The underlying Stage 7 audit *state* (pass/fail, findings) is already durably tracked via the existing `story.stage7Audit` mechanism, untouched by this change — only the one-time "here's your report" chat-adjacent display is ephemeral. A reload mid-Stage-7 shows the current empty/StorySoFar view until the next turn produces new context; nothing about audit correctness or gating is affected.
- **Old messages with no `context` field** (persisted before this change) are handled by the client's resume search simply finding nothing — no migration, no backfill, no special-casing beyond the field being optional in the type.
- **Schema validation failure** (a model response missing `context` or leaving it empty) is caught by the existing `StateDeltaSchema.safeParse` retry mechanism in `extractTurn.ts` — no new error path needed, since `context` becoming required means a missing/empty value now fails validation exactly like a missing `reply` already does.

## Testing

No automated test framework exists in this repo (established convention) — verification is `npm run lint && npm run build` per task plus a manual walkthrough once implemented: start a fresh interview, confirm chat replies render as short numbered/italicized lists with no surrounding prose, confirm the view pane shows a "Notes" card with the model's reasoning above "Story So Far," progress through to Stage 7 and confirm the audit report appears in the view pane (not as a chat message) labeled "Creative Audit," and confirm reloading mid-interview restores the last turn's `context` correctly.
