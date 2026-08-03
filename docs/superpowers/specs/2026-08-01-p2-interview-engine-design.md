# P2 Interview Engine (issues #26 + #27) — Design Spec

**GitHub issues:** #26 (sequential interview engine) + #27 (session-start onboarding flow), combined
**Status:** Approved for planning
**Date:** 2026-08-01

## Problem

Project 2 (Character Bible) has no live interview yet — only two pure functions exist (`ingestFoundation.ts` from #24, `computePriorityMatrix.ts` from #25). #26 and #27 together describe the actual conversational engine: how a session opens (#27 — structural evaluation + priority matrix + first Stage-1 questions for the Protagonist) and how it proceeds turn by turn thereafter (#26 — one character at a time through 6 fixed stages, depth scaled to priority tier, never more than 1-2 questions per turn). They're combined here because they're not independently buildable or testable — #27 is turn 1 of the same loop #26 governs turns 2+ of.

## Decisions (confirmed during brainstorming, 2026-08-01)

1. **#26 and #27 are one deliverable**, closed together when this ships.
2. **Persistence scope: reuse existing message persistence, not new structured state.** Matches P1's own M1→M2 precedent (P1's original M1 was in-memory-only; structured canon-element state came later). `current_character`/`current_stage` ride along as optional fields on each persisted assistant message — the same pattern already used for P1's `context` field — rather than a new Story-level field or a `characters/{charId}` state machine. Real structured, transcript-independent resume is explicitly #36's job (milestone M4), not this issue's.
3. **`extractTurn.ts` is generalized to accept a pluggable tool/schema pair**, rather than duplicating its retry-loop-plus-rate-limit-gating logic in a parallel P2-specific function. Matches ARCHITECTURE.md's stated (but previously unrealized) intent that `StructuredDeltaExtractor` is a shared engine piece each project configures.
4. **Sequential-character enforcement is prompt-only**, matching this codebase's established pattern for this class of requirement (P1 trusts the prompt for its own reply-format rule, backstopped by a logging heuristic, not a hard app-code block). No new guardrail is added beyond reusing `turnGuardrails.ts`'s existing question-count heuristic — it already operates on `reply` text generically, nothing P1-specific about it.
5. **New turn schema is deliberately minimal — no fact-tracking field.** `reply`, `context`, `current_character`, `current_stage`, `character_signed_off` only. Per-fact canon state (`updates`-equivalent) is #29's job (milestone M2); adding it later extends this schema without needing to redesign it.
6. **P2 inherits P1's `reply`/`context` UI contract** (terse numbered chat replies, reasoning in a separate view-pane surface) for UI consistency across the app, using the same `ChatInterview.tsx`-style split-pane layout already built.

## Architecture

Two existing shared-engine pieces get generalized (small, behavior-preserving changes to already-hardened P1 code); everything else is new, P2-scoped code.

**Generalize `web/src/lib/canonEngine/extractTurn.ts`:** add a type parameter so `extractTurn<T>()` accepts `tool: Anthropic.Tool` and `schema: ZodSchema<T>` as explicit params instead of the hardcoded `EMIT_TURN_TOOL`/`StateDeltaSchema` baked into the function body. The retry loop, the `acquireAnthropicSlot`/`recordAnthropicUsage` rate-limit gating, and `StateDeltaValidationError`'s shape (renamed generically, still thrown the same way) are all unchanged in behavior — only the schema/tool the loop validates against becomes a parameter. `web/src/app/api/chat/route.ts`'s call site is updated to pass its existing tool+schema explicitly; P1's behavior does not change.

**Generalize `web/src/lib/systemPrompt.ts`:** `getSystemPrompt()` becomes `getSystemPrompt(fileName: string)`, caching per-filename instead of a single module-level string. P1's call site becomes `getSystemPrompt("sp01-sdos-systemprompt.md")` (currently implicit); P2 calls `getSystemPrompt("sp02-cdc-systemprompt.md")`.

**Generalize `web/src/lib/canonEngine/storyStore.ts`'s message functions:** `appendMessage`/`listMessages` currently hardcode a single `/stories/{storyId}/messages` subcollection. Since a Story is shared across all 5 projects (per ARCHITECTURE.md §1), P1's Foundation-interview transcript and P2's Character-interview transcript must not collide in one collection. Both functions gain an optional `collection` parameter (default `"messages"`, preserving P1's exact current behavior with zero call-site changes needed there); P2's route passes `collection: "characterMessages"`.

**New P2-scoped files**, all under `web/src/lib/characterEngine/` (consistent with #24/#25's existing scope note: this directory holds Project-2-specific glue, not reimplemented shared-engine machinery):
- `characterTurnSchema.ts` — the Zod schema (`CharacterTurnSchema`) and Anthropic tool definition (`EMIT_CHARACTER_TURN_TOOL`) for P2's turn shape.
- `depthLabels.ts` — a pure function mapping `PriorityTier` (`Critical`/`Major`/`Supporting`/`Minor`, from #25) to the PRD's depth labels (`Exhaustive`/`Comprehensive`/`Standard`/`Basic`).

**New route:** `web/src/app/api/character-chat/route.ts`, closely mirroring `web/src/app/api/chat/route.ts`'s shape (auth, workspace-membership check, message persistence, system-prompt assembly, `extractTurn` call, response) but without any of P1's stage-gate/canon-element/conflict-resolution/Stage-7-audit machinery — none of that exists for P2 yet, deliberately deferred to later M2/M3 issues.

**New page:** `web/character-bible` page + a `CharacterInterview.tsx` component, adapted from `ChatInterview.tsx`'s already-built shape (the resizable split pane, `Markdown` rendering, the `reply`/`context` view-pane card) — reused UI patterns, new data underneath.

**Dashboard entry point:** `ProjectDashboard.tsx` gets a second button next to the existing "Resume" link — "Character Bible", linking to `/character-bible?workspaceId=...&canvasId=...`, gated on the same `hasDoc` check already computed for the Export dropdown (a Foundation Document version must exist, since P2 ingests P1's JSON export via `ingestFoundation.ts`).

## Data model

**`CharacterTurnSchema`** (`characterTurnSchema.ts`):

```ts
export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
});
```

Mirrors `StateDeltaSchema`'s `reply`/`context` contract exactly (same required-both-fields, same intent: `reply` is the terse numbered chat list, `context` is reasoning). `current_character` and `current_stage` are the model's own self-reported position — trusted the same way `stage_ready_to_advance` is trusted in P1 today, no independent verification.

**`EMIT_CHARACTER_TURN_TOOL`**: the matching Anthropic tool definition, same shape/pattern as P1's `EMIT_TURN_TOOL` (description-per-field, all five properties required) — field ordering follows the same truncation-risk lesson already learned on P1: `reply` and the three short fields (`current_character`, `current_stage`, `character_signed_off`) precede `context` in both `properties` and `required`, so a truncated response drops the free-text field first.

**`StoryMessage`** (in `storyStore.ts`, already has optional `context?: string` from prior work) gains two more optional fields: `current_character?: string`, `current_stage?: number`. Optional for the same reason `context` is — not every message (e.g. user turns) carries them.

## System prompt

New `web/system-prompts/sp02-cdc-systemprompt.md`, adapted from `project-docs/storimac-prompts/P2-Prompt2...md` (already read in full during brainstorming). Structural changes from the reference doc:
- Section 7 ("OPERATIONAL RESPONSE DIRECTIVE") rewritten to state the `reply`/`context` two-field contract, following sp01 §8's exact wording pattern (terse numbered `reply`, reasoning in `context`, both fields never blended).
- A new instruction (wherever the reference doc's Sequential Interview Workflow section lands) telling the model to refuse a character switch before the current character's Stage 6 sign-off unless the author explicitly asks to switch — and to emit `current_character`/`current_stage`/`character_signed_off` accurately every turn regardless of what's discussed.
- Section 2 (Character Priority Budget) is otherwise unchanged — it already defines the tier→depth mapping this system uses.

## Server (`web/src/app/api/character-chat/route.ts`)

- Auth (`requireUser`) + workspace-membership check, same as `/api/chat`.
- Every turn (not just the first — the model needs cast/tier grounding regardless of which character is currently under discussion), ingest the Foundation (`ingestFoundation(storyId)`) and compute the priority matrix (`computePriorityMatrix(foundation)`); inject both into the system prompt as grounding context, and inject the tier→depth mapping (`depthLabels.ts`) per cast member. Both calls are cheap (one Firestore read + pure functions), so recomputing every turn is simpler and more robust than caching against the "first turn only" question of what counts as first.
- Replay `characterMessages` via `listMessages(storyId, { collection: "characterMessages" })`, mapping `content` the same way P1 does today (`context` appended when present, mirroring the existing `route.ts:227-230` pattern) so the model sees its own prior reasoning.
- Call `extractTurn({ ..., tool: EMIT_CHARACTER_TURN_TOOL, schema: CharacterTurnSchema })`.
- Persist the assistant reply via `appendMessage(storyId, { role: "assistant", content: delta.reply, context: delta.context, current_character: delta.current_character, current_stage: delta.current_stage, ts, turnId }, { collection: "characterMessages" })`.
- Response JSON: `{ reply, context, current_character, current_stage, character_signed_off }`.
- If `ingestFoundation` returns `status: "missing"` or `"error"`, return a clear error response (no Foundation Document to ingest yet — the dashboard's `hasDoc` gate should prevent reaching this route in that state, but the route itself must not assume the gate was honored).

## Client (`web/src/app/character-bible/page.tsx`, `CharacterInterview.tsx`)

Adapted from `ChatInterview.tsx`: same resizable split-pane layout, same `Markdown`-rendered chat bubbles, same `context` view-pane card pattern — but posting to `/api/character-chat` instead of `/api/chat`, and displaying `current_character`/`current_stage` (e.g. "Interviewing: <name> · Stage <n>/6") in the header where P1 shows `stageName`. No Stage-8-document-card equivalent (P2 has no compiler yet — that's a later M4 issue), no conflict-card equivalent (no conflict resolution yet — M2).

## Error handling

- `RateLimitTimeoutError` and `Anthropic.APIError` handling copied verbatim from `/api/chat`'s existing catch blocks — both are already fully generic, no P2-specific changes needed.
- The generalized `extractTurn`'s validation-failure error (renamed from `StateDeltaValidationError` to a generic name, e.g. `TurnValidationError`, since it's no longer P1-specific) is caught the same way, with P2's own friendly message.
- If `ingestFoundation` returns `"incomplete"` (per #24's existing result type — e.g. missing Story Spine), still proceed but inject a note into the system prompt's grounding so the model knows some Foundation data is thin, rather than blocking the session entirely.

## Testing

No automated test framework exists in this repo (established convention) — verification is `npm run lint && npm run build` per task, plus a manual walkthrough once implemented (this sandbox has no live Firebase/Anthropic credentials, same constraint as every other feature built this session): start a Character Bible session from the dashboard, confirm the opening turn shows a structural evaluation + priority matrix + first Protagonist questions with no other preamble, confirm replies are terse numbered lists with reasoning in the view pane, confirm attempting to discuss a different character before sign-off gets redirected, and confirm reloading mid-session restores the last known `current_character`/`current_stage`.
