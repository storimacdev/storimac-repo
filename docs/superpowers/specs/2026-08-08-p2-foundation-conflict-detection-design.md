# P2 Conflict Detection vs. Story Foundation — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-08

## Problem

GitHub issue #30 (P2 M2). PRD §5.4/§7 requires that before any character fact is confirmed, the system checks it against the Story Foundation Document for contradiction (e.g. a proposed Core Wound that contradicts a Confirmed Story Spine beat), halts on contradiction with exactly three resolution paths — (A) revert, (B) update Story Foundation canon and log the downstream impact, (C) shelve/`Deferred` — and does not proceed past the contradiction until the author picks one, with every conflict and its resolution logged (`canon_conflicts_log`).

This is a different kind of problem from issues #26 and #28, both mechanical/deterministic enforcement over already-structured state. Whether a character's Core Wound "contradicts" a Story Spine beat is a semantic, narrative judgment — no code can compute it from two arbitrary strings. Project 1's own "conflict detection" (`conflictResolution.ts`, issue #10) looks superficially similar but solves a different problem entirely: it's a same-project, same-`element_id` value-equality check (did the model try to silently change an already-Confirmed P1 element's value), fully deterministic. #30's conflict is cross-project (a P2 character fact vs. P1 Foundation Document content) and has no shared identity to compare — it has to be model-judged.

Two concrete gaps block this today:
1. The model has nothing to compare against. `ingestFoundation.ts` already loads `foundation.storySpine` and `foundation.dramaticEngine` into `IngestedFoundation`, but `character-chat/route.ts` only ever uses them internally (`computePriorityMatrix`) — neither is ever included in the system prompt text the model actually reads.
2. `characterTurnSchema.ts` has no structured field for the model to declare a conflict through, and no `resolution` field for a follow-up turn to resolve it — unlike P1's `stateDelta.ts`, which already has both (`conflict_detected`, `resolution`).

sp02 §4 already narrates the intended author-facing behavior ("If a character revision breaks the Story Foundation canon, halt. Present the explicit contradiction and force the author to choose: (A) Revert the proposal, (B) Update the Story Foundation and track downstream damage, (C) Put the idea on ice.") — the model already knows what to *say*; it has no way to *act* on it yet.

## Decisions (confirmed during brainstorming, 2026-08-08)

1. **Detection is model-declared and trusted, not app-recomputed.** Unlike P1's `detectConflict` (deterministic value comparison against a known `element_id`), there is no deterministic check possible here — the model is shown the relevant Foundation content and is the only thing that can judge whether a new fact contradicts it. The app's role is enforcing the *consequence* of a declared conflict (gating canon status), not re-deriving the judgment itself.
2. **"Update Story Foundation canon" does not auto-mutate Project 1's Foundation Document in this issue.** Actually rewriting a `foundationDoc.ts` field from a Project 2 route is a materially larger, riskier feature (which field, which version, correctness of the cross-project write) with no existing precedent. Scoped down: choosing (B) confirms the character fact as P2 canon and records a downstream-impact log entry flagging that the Foundation Document should be revisited by the author later, through Project 1's own flow — it does not touch `foundationDoc.ts`'s stored JSON. A future issue can build the actual cross-project write if wanted.
3. **Grounding is scoped to what's already ingested: Story Spine and Dramatic Engine.** `IngestedFoundation` doesn't carry more than this today (CDRM ingestion and prose-fallback parsing were explicitly deferred in issue #24's own scope note) — expanding ingestion itself is out of scope here. This also directly matches the AC's own worked example (a Story Spine beat) plus the closely related Dramatic Engine (protagonist/antagonistic_force/central_conflict — equally "Story DNA" a character's psychology could contradict).
4. **The turn-schema shape deliberately mirrors P1's `stateDelta.ts` (`conflict_detected`/`resolution`), with P2's own resolution vocabulary.** P1 already proved this shape works for "the model declares a conflict, a later turn resolves it." P2's three resolution values are `"revert" | "update_foundation" | "park"` — the AC's own three options — rather than reusing P1's `keep_canon`/`accept_and_update`/`park` literals, since the underlying actions differ (P1 resolves by changing its own element; P2 resolves against another project's document, per decision 2).
5. **One pending conflict at a time, singular — not an array.** Matches `StoryPendingConflict`'s own precedent exactly (P1 also only ever tracks one). Conflict detection only ever considers a turn's `Confirmed`-state proposals (matching AC1's "before confirming any fact" and issue #28's established precedent of gating specifically on the transition into `Confirmed`); if a turn somehow proposes more than one `Confirmed` fact and flags a conflict, the first is taken as the pending conflict and *every* `Confirmed`-state proposal that turn is downgraded to `Working` (conservative: no partial confirmation while a conflict is open).
6. **The app never synthesizes the conflict-presentation message.** Unlike issue #26's blocked-switch redirect (a structural interruption needing an app-authored explanation), sp02 §4 already instructs the model to narratively halt and present the three choices itself. AC3's hard requirement ("does not proceed past... until the author picks one") is enforced at the data layer — the fact literally cannot become `Confirmed` until `resolution` is set — regardless of how well the model's own reply narrates it. This matches P1's own architecture: `buildConflictContextMessage` only ever grounds the *next* turn's system prompt, never overrides the model's `reply`.
7. **This check runs after issue #28's causal-chain enforcement, on its output.** The two are independent, composable downgrade-to-`Working` guards over the same `Confirmed`-state proposals; layering conflict detection on `enforcedUpdates` (28's output) rather than raw `delta.updates` avoids duplicating logic and keeps a single, linear pipeline of successive guards.

## Architecture

### `web/src/lib/characterEngine/characterTurnSchema.ts` (extended)

`CharacterTurnSchema`/`EMIT_CHARACTER_TURN_TOOL` gain three fields, mirroring `stateDelta.ts`'s equivalents:
- `conflict_detected: z.boolean()` — required every turn. "True if any of this turn's proposed Confirmed facts contradict the Story Foundation grounding (Story Spine, Dramatic Engine) shown above."
- `conflict_description: z.string().optional()` — "Required when conflict_detected is true: plain-language explanation of the contradiction, naming both the proposed fact and the specific Foundation content it conflicts with."
- `resolution: z.enum(["revert", "update_foundation", "park"]).optional()` — "Only set this during a Conflict Resolution turn (a system note will tell you when you're in one), after the author picks one of the three choices you presented."

### `web/src/app/api/character-chat/route.ts` (extended)

**Grounding injection** (alongside the existing Cast & Priority Matrix block): a new system-prompt block built from `foundation.storySpine` and `foundation.dramaticEngine`, framed identically to the existing grounding ("computed by the app, trust this... internal grounding only, never narrate this raw data to the author").

**Resolution-mode injection**: if `story.p2PendingConflict` exists, inject a system note (new function `buildConflictContextMessage`-equivalent in a P2-scoped module or inline, mirroring `conflictResolution.ts`'s function of the same purpose) naming the pending conflict's character/field/description and instructing the model to resolve it before anything else.

**Turn processing**, after #28's causal-chain enforcement produces `enforcedUpdates`:
1. If `story.p2PendingConflict` exists and `delta.resolution` is set: resolve it.
   - First, remove any existing entry for the pending conflict's `field` from `enforcedUpdates` — if the model re-proposed the same field this turn, it already passed through #28's causal-chain pass and landed there; the resolution below is the single authoritative outcome for that field this turn, not an addition alongside it. (Without this removal, the field could end up with two separate entries targeting the same `element_id` in the same `applyStateDelta` call — harmless to Firestore's transaction semantics, since the same document simply gets overwritten with whichever entry serializes last, but a needless, unintentional duplicate to reason about.)
   - Find a same-`field` update in this turn's `delta.updates` for the pending conflict's `charId` to source a value from; fall back to the pending conflict's own stored `proposedValue` if the model didn't re-propose it.
   - `"revert"`: nothing further added to `enforcedUpdates` for this field — the removal above is the entire effect.
   - `"update_foundation"`: add a `Confirmed` update for this field (using the resolved value) to `enforcedUpdates`.
   - `"park"`: add a `Deferred`-state update (translated to `Parked` by the existing `toFactUpdate`, per issue #29) for this field to `enforcedUpdates`.
   - Append an entry to the new `characterConflictsLog` collection (conflicting source = the pending conflict's description, resolution, `resolvedBy: user.uid`, timestamp, turnId).
   - Clear `story.p2PendingConflict` (`setP2PendingConflict(storyId, null)`).
   - If `delta.resolution` is set but no `p2PendingConflict` exists, ignore it (matches P1's own posture of only acting on `resolution` inside an active pending-conflict).
2. Else, if `delta.conflict_detected` is true and at least one update in `enforcedUpdates` has `state === "Confirmed"`: take the first such update as the culprit, persist a new `Story.p2PendingConflict` (`charId`, `characterName`, `field`, `proposedValue`, `conflictDescription: delta.conflict_description`, `ts`), and downgrade *every* `Confirmed`-state update in `enforcedUpdates` this turn to `Working` (not just the culprit).
3. Otherwise: `enforcedUpdates` passes through unchanged (today's existing behavior).

The turn's `reply`/`context` are never overridden by this logic — only the fact-update pipeline and persisted conflict state are affected.

### `web/src/lib/canonEngine/storyStore.ts` (extended)

New type and field, mirroring `StoryPendingConflict`/`Story.pendingConflict`'s own shape and the `setStage7Audit`-style whole-object-replace setter:
```ts
export interface P2PendingConflict {
  charId: string;
  characterName: string;
  field: string;
  proposedValue: unknown;
  conflictDescription: string;
  ts: string;
}
```
`Story` gains `p2PendingConflict?: P2PendingConflict | null`. New `setP2PendingConflict(storyId, conflict: P2PendingConflict | null): Promise<void>`.

New log type and appender, mirroring `StoredOutstandingQuestion`/`outstandingQuestionsCollection`'s own append-only subcollection pattern:
```ts
export interface CharacterConflictLogEntry {
  charId: string;
  field: string;
  conflictDescription: string;
  resolution: "revert" | "update_foundation" | "park";
  resolvedBy: string;
  ts: string;
  turnId: string;
}
```
New `appendCharacterConflictLog(storyId, entry): Promise<void>`, writing to a new `characterConflictsLog` subcollection.

## Error Handling

No new failure modes beyond what already exists. `delta.resolution` set without a matching pending conflict is silently ignored (matches P1's precedent, not an error). A resolution turn where the model doesn't re-propose the field's value simply falls back to the value already captured in `p2PendingConflict` — never a missing-data error.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A turn proposing `core_wound: Confirmed` with `conflict_detected: true` downgrades that fact to `Working`, persists `p2PendingConflict`, and does not touch any other field in the same turn's updates that wasn't also `Confirmed`.
- A turn with `conflict_detected: false` and no pending conflict passes `enforcedUpdates` through unchanged (today's behavior preserved).
- With a pending conflict active, a resolution turn setting `resolution: "revert"` clears the pending conflict, logs it, and confirms nothing was added to `enforcedUpdates` for that field.
- The same with `resolution: "update_foundation"`: the field is added to `enforcedUpdates` as `Confirmed`, logged, pending conflict cleared.
- The same with `resolution: "park"`: the field is added as `Deferred` (verify it survives `toFactUpdate`'s existing Deferred→Parked translation unchanged), logged, pending conflict cleared.
- `delta.resolution` set on a turn with no active `p2PendingConflict` is ignored — no log entry, no state change from this logic.
