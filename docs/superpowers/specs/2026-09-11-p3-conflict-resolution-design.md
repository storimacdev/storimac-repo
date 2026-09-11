# P3 Conflict Resolution Protocol (Issue #47) — Design

**Issue:** #47, "[P3] Implement Conflict Resolution Protocol"
**AC:** detect contradictions against the immutable Story Foundation OR a previously `Confirmed` world canon entry; halt forward progress and force exactly three choices — (A) Revert the new idea, (B) Revise existing canon (showing the resulting Dependency Review), (C) Defer to Outstanding Questions; log the chosen resolution + rationale with a timestamp (`conflictLog`); enforced by code, not left to the model.

## Reuse reality check — the third false "shared component" claim in P3's issues

The architecture note says to "configure the shared Canon Engine's `ConflictResolution` flow (reference: #10)... not as an independent conflict flow." Investigated, same as #45 (CanonPanel) and #46 (GuardrailRunner) before it: **this claim doesn't hold either.** Project 2 (`foundationConflict.ts`) imports *zero* functions from `canonEngine/conflictResolution.ts` — it's a deliberate, hand-forked parallel module, and its own doc-comment says so plainly: detection against Foundation prose has "no deterministic way to judge," so P2 built model-self-report instead of P1's structural diff. The only genuinely shared things are one level down: `canonStore.ts`'s generic `applyStateDelta`/`upsertElement` (already collection-parameterized) and the "one pending-conflict field + a resolve function + a log" *shape*, not the specific functions.

Two additional concrete blockers to literal reuse, found by inspection: (1) `conflictResolution.ts`'s four functions are hardcoded to Project 1's own `"elements"` collection — none take the `collection` parameter every sibling `canonStore.ts` function already has, so calling them as-is from P3 would silently touch Project 1's canon. Generalizing that is explicitly **issue #48's job** (already flagged during issue #42's review as a pre-existing gap affecting P2's `characterFacts` too) — this design does not fix it, to avoid duplicating #48's planned work. (2) P1's own `resolveConflict()` computes a `cascadeReview` that `chat/route.ts` discards and never displays — AC-(B)'s "showing the resulting Dependency Review" was never actually wired end-to-end even in the reference implementation, so #47 can't copy a working example of that part; it has to build it.

**Decision:** build a new, P3-local module (`web/src/lib/worldEngine/conflictResolution.ts`), following P2's precedent (a bespoke fork with P3's own vocabulary and types) rather than P1's literal functions — reusing only the genuinely generic primitives underneath (`canonStore.ts`, `appendOutstandingQuestions`).

## Two conflict kinds, one resolution vocabulary

**Kind 1 — `confirmed_entry`: a proposed edit contradicts a `Confirmed` World Entry.** Detected structurally (deterministic, no model judgment needed) — this is already the exact point `worldEntryStore.ts`'s `updateWorldEntry` hard-blocks today:
```ts
if (existing.status === "Confirmed" && valueFieldsPresent && !leavingConfirmed) {
  return { ok: false, error: "...Conflict Resolution for Confirmed canon isn't available yet - issue #47." };
}
```
This literal line is the concrete "what to build" marker in the codebase. Instead of a hard failure, this becomes the conflict-detection trigger.

**Kind 2 — `foundation`: a new idea contradicts the immutable Story Foundation Document.** The Foundation is prose (premise, genre, world rules), not a value under some `element_id` — there's no deterministic diff possible. Mirrors P2's precedent exactly: the model self-reports via new turn-schema fields (`conflict_detected`, `conflict_description`), since P2's own doc-comment already established "no deterministic way to judge" this kind of contradiction.

**Both kinds share one halt-and-choose UX, and both kinds' resolution choices reuse the same three labels — but "Revise" means something different for each, because the Foundation is immutable and can't literally be rewritten:**

- **Revert** (both kinds): drop the new idea, keep existing state, log the resolution. No Firestore write beyond the log.
- **Revise, `confirmed_entry`:** apply the proposed new value to the entry (the entry *is* mutable canon), show the resulting Dependency Review (which other entries `depends_on` it), log the resolution.
- **Revise, `foundation`:** there is no mutable "canon" the contradiction is against — so "Revise" here follows P2's own precedent for the identical problem: P2's `ConflictResolutionChoice` literally includes `"update_foundation"`, meaning "the new idea supersedes the Foundation-implied assumption **within this project's own state going forward**" — not a literal rewrite of Project 1's document. P3's "Revise" for a `foundation` conflict means the same thing: proceed with the new idea as the World Bible's working position, log it, no Dependency Review section (nothing to cascade from a prose contradiction).
- **Defer** (both kinds): park the decision instead of choosing. For `confirmed_entry`, this adds an `OutstandingQuestion` to the entry itself (issue #44's existing per-entry mechanism) — genuinely visible to the author, since issue #45's side panel already displays these. For `foundation` (no specific entry to attach to), use the generic `outstanding_questions` subcollection (`appendOutstandingQuestions`, already used by issue #46's guardrail) with `defer_to: null` (parked within Project 3 itself, not deferred to another project).

## What's genuinely reusable vs. new

- Reusable as-is: `canonStore.ts`'s `upsertElement`/`applyStateDelta` (already collection-parameterized), `appendOutstandingQuestions`/`StoredOutstandingQuestion` (issue #46 already established the pattern for P3), the "inject a bracketed grounding block, forbid naming it in the closing reminder" convention (proven 3× already: Story Foundation grounding, World Entries grounding, now the conflict grounding).
- New, mechanical extension: `worldEntryStore.ts`'s `UpdateWorldEntryResult`'s `{ok:false}` branch gains a machine-readable `reason` field (`"not_found" | "invalid_transition" | "confirmed_conflict"`) plus, only for `confirmed_conflict`, the old/new values needed to build the pending-conflict record — so callers can react specifically without string-matching the error message. The direct CRUD API (`entries/route.ts`) is unaffected: it already just returns `result.error` generically regardless of `reason`.
- New, P3-local: `P3PendingConflict` type (discriminated union, `story.p3PendingConflict` — a new top-level `Story` field, mirroring `pendingConflict`/`p2PendingConflict`'s existing precedent of one bespoke field per project, not a shared type) and a `p3ConflictLog` subcollection + `appendP3ConflictLog`/`listP3ConflictLog` (modeled on P2's `characterConflictsLog`/`appendCharacterConflictLog`, but this is a fresh P3-shaped copy, not a generalization of P2's — generalizing that is a separate, not-asked-for refactor).
- New: `web/src/lib/worldEngine/conflictResolution.ts` — `buildConflictContextMessage()` (Revert/Revise/Defer labels) and `resolveP3Conflict()` (the three-choice orchestration described above), plus a minimal `computeCascadeReview(storyId, entryId)` scoped directly to `WORLD_ENTRIES_COLLECTION` via a direct `depends_on array-contains` query (not reusing/fixing the shared, currently-`"elements"`-hardcoded `listDependents` — that's #48's job, tracked separately).
- New: `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL` gain `conflict_detected: boolean`, `conflict_description: string | null`, `resolution: "revert" | "revise" | "defer" | null` (mirrors P2's fields; P3's own resolution vocabulary per the architecture note's instruction to use P3's own copy).
- New UI: a dedicated conflict card in `WorldInterview.tsx`'s chat pane, following **Project 1's precedent** (a card with three lettered buttons that send canned confirmation messages), not Project 2's weaker purely-conversational approach — the AC's own wording ("halt forward progress and **force** a three-way choice... enforced... not left to the model to remember unaided") reads as wanting a real UI affordance, and P1's card is the stronger, already-proven pattern for that. When a `confirmed_entry`-kind conflict is resolved via Revise, the card also renders the Dependency Review list from the response (the one piece of AC-(B) that P1 itself never actually wired end-to-end).

## Halting semantics

Mirrors P1/P2's existing convention exactly: `story.p3PendingConflict` is a single field, not a per-entry list. While it's set, the turn handler applies no other Stage 3 writes that turn (matching P1's "apply nothing this turn" behavior) until the author picks one of the three options — consistent with existing precedent rather than inventing thread-scoped partial halting, which neither P1 nor P2 does and the AC doesn't clearly require either.

## Error handling

Every new Firestore write in this flow (the conflict log append, the deferred outstanding-question append) follows the same degrade-gracefully convention established in issue #43: logged via `console.warn`, never a hard error to the author, and always after the turn's reply has already been persisted.
