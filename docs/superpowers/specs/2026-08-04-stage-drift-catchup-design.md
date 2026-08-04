# Stage-Gate Catch-Up & Element-ID Drift Prevention — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-04

## Problem

A production investigation (2026-08-04, story `NtEdq7hZfyaW33eN2DCE`) found the Story Canon side panel stuck showing Stage 1 while the author was substantively conversing at Stage 4. Root cause, confirmed by reading the live code (not just the data):

1. **Element-ID drift.** `EMIT_TURN_TOOL`'s `element_id` property (`web/src/lib/canonEngine/stateDelta.ts`) is `{ type: "string" }` with no enum and no description — the model gets zero guidance on what string to use and is free to invent one. In the affected story it wrote things like `world.premise_assumptions_deva_attachment` and `format_primary` instead of the canonical `premise_assumptions` and `primary_format` that `stageDefinitions.ts`'s `requiredElementIds` actually check for. This wasn't a one-off: the repair needed 18 canonical aliases across nearly every stage.
2. **No catch-up logic.** `checkStageGate`/`advanceStage` (`stageFsm.ts`) only evaluate the *current* stage's required elements, and `web/src/app/api/chat/route.ts` only calls `advanceStage` once per turn (advancing at most one stage). If drift permanently blocks one stage's gate, the pointer can never walk past it later, even once every subsequent stage's canon is substantively complete under correct IDs.

A related, previously undiscovered gap: there is no single canonical registry of every element ID Project 1 uses. The vocabulary is implicitly split across `stageDefinitions.ts`'s `requiredElementIds` (29 stage-gated IDs) and `foundationDoc.ts`'s literal field lookups (~17 more IDs that no stage gates but the document compiler reads directly — `medium`, `logline`, `principal_characters`, etc.).

A manual Firestore repair already fixed the one known-affected story. This spec is the systemic prevention + self-healing fix, plus a one-time detection sweep for any other affected stories already in production.

## Decisions (confirmed during brainstorming, 2026-08-04)

1. **Scope includes a read-only detection audit**, not just the forward-looking code fix — there may be other stories in the same stuck state that haven't been reported yet.
2. **Unknown element IDs are accepted and logged, never rejected.** Enum steering on the tool schema is the primary defense; a hard Zod/backend rejection on a schema miss would risk creating a new 502 failure class (the same class the sp01 branch just removed for a different field), for a problem that's better handled by visibility + the catch-up loop than by blocking the turn.
3. **Project 1's element-ID vocabulary is closed, not open-ended.** Unlike character/world-building projects with dynamic per-entity IDs, Project 1 produces one fixed-schema document — every fact belongs in one of a known, enumerable set of slots. This is what makes a hard `enum` constraint on the tool schema architecturally correct here (it would not be correct for a project with dynamic entity IDs).

## Architecture

### 1. Canonical Element Registry — `web/src/lib/canonEngine/elementRegistry.ts` (new file)

Single source of truth, built as a union of two existing sources rather than a new independent list:
- `PROJECT1_STAGES[].requiredElementIds`, imported from `stageDefinitions.ts` (29 IDs, already exists).
- A new explicit `DOCUMENT_ONLY_ELEMENT_IDS` array covering every ID `foundationDoc.ts` reads that no stage requires: `medium`, `target_length`, `core_story_promise`, `story_identity`, `narrative_priorities`, `always_emphasize`, `never_become`, `comparable_works`, `supporting_formats`, `premise`, `logline`, `external_theme`, `internal_theme`, `narrative_purpose`, `emotional_journey`, `principal_characters`, `nature_of_world`.

Exports:
- `PROJECT1_ELEMENT_IDS: string[]` — the full deduplicated union, used to build the tool schema's `enum`.
- `isKnownElementId(id: string): boolean`.

A comment above `DOCUMENT_ONLY_ELEMENT_IDS` tells future editors: adding a field to `foundationDoc.ts` means adding it here too, or the model will never be steered toward populating it.

### 2. Tool-schema enum — `web/src/lib/canonEngine/stateDelta.ts`

`EMIT_TURN_TOOL`'s `updates[].element_id` property changes from:
```ts
element_id: { type: "string" },
```
to:
```ts
element_id: {
  type: "string",
  enum: PROJECT1_ELEMENT_IDS,
  description: "The canonical element ID this update is for - always pick the closest match from the enum. Never invent a new key; every fact captured during the interview belongs in one of these fixed slots.",
},
```

### 3. Defense in depth: log-only visibility for schema misses

`web/src/app/api/chat/route.ts`, right before the existing `applyStateDelta` call(s) for `updates`/`remainingUpdates`: for any update whose `element_id` fails `isKnownElementId`, `console.warn` (matching the existing `[chat]`-prefixed, non-blocking log style already used nearby) and let the write proceed unchanged. No new error class, no schema rejection — this is purely a Cloud Logging signal for prompt-tuning review, the same posture as `turnGuardrails.ts`.

### 4. Stage-gate catch-up loop — `web/src/app/api/chat/route.ts`

The existing preamble-plus-single-advance block:
```ts
let currentStage = story.currentStage;
let outstandingQuestions: OutstandingQuestion[] = [];
let auditSummary: string | null = null;
const isLastStage = story.currentStage >= PROJECT1_STAGES[PROJECT1_STAGES.length - 1].stage;
const blockedByStage7 = story.currentStage === 7 && !stage7Responded;
if (!nextPendingConflict && delta.stage_ready_to_advance && !isLastStage && !blockedByStage7) {
  const freshElements = await listElements(storyId);
  const gate = checkStageGate(story.currentStage, freshElements);
  if (gate.canAdvance) {
    const result = advanceStage(story.currentStage, freshElements);
    currentStage = result.nextStage;
    outstandingQuestions = result.outstandingQuestions;
    await touchStory(storyId, { currentStage });
    await appendOutstandingQuestions(storyId, outstandingQuestions);
    if (currentStage === 7) { /* run Stage 7 audit */ }
  }
}
```
becomes a loop that repeats the same body — same per-stage side effects, same order — for as long as the *current* (now possibly already-advanced) stage's gate keeps passing and the story isn't blocked or at the last stage. Note the top-level `isLastStage`/`blockedByStage7` consts are removed entirely (they'd otherwise be unused once their only use site moves inside the loop, which would fail `npm run lint`) — the loop recomputes them fresh every iteration against the evolving `currentStage` instead:
```ts
let currentStage = story.currentStage;
let outstandingQuestions: OutstandingQuestion[] = [];
let auditSummary: string | null = null;
if (!nextPendingConflict && delta.stage_ready_to_advance) {
  // No writes happen to elements between iterations below, so one snapshot
  // is valid for every gate check this turn - no re-listing needed.
  const elements = await listElements(storyId);
  const allOutstanding: OutstandingQuestion[] = [];

  while (true) {
    const isLastStage = currentStage >= PROJECT1_STAGES[PROJECT1_STAGES.length - 1].stage;
    const blockedByStage7 = currentStage === 7 && !stage7Responded;
    if (isLastStage || blockedByStage7) break;

    const gate = checkStageGate(currentStage, elements);
    if (!gate.canAdvance) break;

    const result = advanceStage(currentStage, elements);
    currentStage = result.nextStage;
    allOutstanding.push(...result.outstandingQuestions);
    await touchStory(storyId, { currentStage });
    await appendOutstandingQuestions(storyId, result.outstandingQuestions);

    if (currentStage === 7) {
      const commonMistakes = collectCommonMistakes(elements);
      const audit = runStage7Audit(elements, commonMistakes);
      await setStage7Audit(storyId, audit);
      auditSummary = formatAuditSummary(audit);
    }
  }
  outstandingQuestions = allOutstanding;
}
```
Trigger condition is unchanged (`delta.stage_ready_to_advance` from this turn's model output starts the process); only how far a single qualifying turn can walk the pointer changes. `blockedByStage7`'s existing semantics are preserved exactly: since `stage7Responded` is computed once per turn from the story's state *before* this turn started, entering Stage 7 inside the loop immediately halts further advancement in the same turn (identical to today's behavior), and only a subsequent turn (after the author's next message counts as their audit response) can proceed to Stage 8.

The response JSON's `elements: elementsAfter` field (populated further down in the handler from a post-write `listElements` call) is unaffected by this change — it already re-lists after all writes for the turn complete, so it correctly reflects however many stages were crossed.

### 5. Read-only drift-audit script — `web/scripts/audit-stage-drift.ts` (new)

A standalone script, run via `npx tsx web/scripts/audit-stage-drift.ts`, reusing the real `checkStageGate` and the new `elementRegistry` rather than reimplementing detection heuristics. Adds `tsx` as a devDependency in `web/package.json` so the script can import the app's own TypeScript modules directly (`@/lib/canonEngine/*`) instead of duplicating logic in hand-rolled JS.

For every story in the `stories` collection, it lists that story's elements and flags two independent signals, neither requiring any write:
- **Unknown element IDs**: any element whose `element_id` isn't in `PROJECT1_ELEMENT_IDS` — direct drift evidence, and the only signal that can retroactively catch already-drifted data (the catch-up loop and enum only help going forward).
- **Stage-tag/pointer mismatch**: the highest `stage` number tagged on any of the story's elements is more than one stage ahead of the story's stored `currentStage` — evidence the model itself asserted later-stage progress the FSM pointer never caught up to.

Output is a console report per flagged story: story ID, stored `currentStage`, highest element-tagged stage, and the list of non-canonical element IDs found (if any) — for human triage, exactly like the one repair already done. The script makes no writes.

## Error Handling

No new failure modes. The enum constraint is best-effort steering (Anthropic tool schemas don't guarantee 100% enum compliance), the schema-miss log is non-blocking by design (decision 2), and the catch-up loop can only ever advance through gates that already independently pass `checkStageGate` — it changes *how many* stages one turn can cross, not the correctness criteria for crossing any single one. The audit script is read-only and cannot itself corrupt data.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus:
- Manual read-through confirming the catch-up loop's Stage 7 pause behaves identically to today's single-advance code for the common (no-drift) case — this is a refactor of existing, working logic, not new behavior, for stories that never hit drift.
- Running the audit script against production read-only (no credential/permission changes needed beyond what `firebaseAdmin.ts` already uses) to get a first real report of any other affected stories, before deciding whether any further one-off repairs are needed.
