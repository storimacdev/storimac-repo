# P3 Stage 2 — Assess & Pillar Mapping — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-26

## Problem

GitHub issue #40 (P3 Phase 1). Acceptance criteria:
- System proposes the WCL (from #39) for author confirmation/override at this stage.
- System proposes an ordered list of relevant World Pillars (e.g. Technology, Government & Bureaucracy, Economy, Culture, Geography, Underworld, History) derived from the Story Foundation.
- Author can add, remove, or reprioritize pillars before Stage 3 begins.

PRD refs: §6 Stage 2, §8.2 indicative data model (`pillars[] { name, priority, status }`).

## Decisions (confirmed during brainstorming, 2026-08-26)

1. **AC1 (WCL proposal/confirmation at this stage) needs no new work.** Issue #39 already built WCL propose/confirm/change as a turn-agnostic flow — it reacts to whatever the model proposes on any turn, regardless of `current_stage`. Verified by reading the current `world-chat/route.ts` and `WorldInterview.tsx`: nothing there is stage-gated. This issue's scope is genuinely just AC2 and AC3.
2. **Pillar order is not a separate `priority` field.** The PRD's indicative data model shows `pillars[] { name, priority, status }`, but storing both an array position and a redundant `priority` number invites the two drifting out of sync. `pillars: string[]` — array index *is* priority — satisfies "ordered list" and "reprioritize" (reordering the array) with one source of truth.
3. **Per-pillar `status` is explicitly out of scope for this issue.** It belongs to the Canon Registry (#41) and the Discover/Develop/Validate cycle (#43) — a `status` field with nothing to drive it yet would be dead state. This issue only produces the flat, ordered name list those later issues will attach state to.
4. **Pillar editing uses an explicit UI list editor**, not chat-mediated add/remove/reorder — confirmed with the user directly. The AC's verbs ("add, remove, reprioritize") are direct list manipulation, a poor fit for parsing free-text commands, and this builds on the explicit-UI-control precedent #39 already established for WCL.
5. **The model's proposal and the author's working list are two separate fields**, matching WCL's `proposed`/confirmed split exactly:
   - `proposedPillars: string[] | null` — updates from any turn where the model reports a list via `proposed_pillars`.
   - `pillars: string[] | null` — the author's actual working list. `null` means "not adopted yet" (nothing but a proposal exists); `[]` is a distinct, valid state meaning "the author deliberately cleared it out." Once non-null, it never gets silently overwritten by a later model proposal — same "author is final authority once decided" posture as WCL (its decision 4).
6. **The chat route never auto-adopts a proposal into the working list.** Auto-seeding `pillars` from `proposedPillars` the first time a proposal arrives would require the chat route to read-check "is `pillars` still empty?" against a `story` snapshot fetched before the model call — the exact stale-snapshot shape that caused #39's race condition. Keeping the chat route's write scope to `proposedPillars` only preserves full read/write disjointness between the chat route and the pillar-editor route, with no locking or freshness logic needed. Adoption becomes an explicit client action instead (Decision 5 of the UI section below).
7. **The pillar-editor PATCH route always replaces the whole array**, not per-item add/remove endpoints. One owner (the author, via one UI list) writes one field; a whole-array replace is the same shape already used by the WCL PATCH and the canvases rename PATCH, and avoids inventing concurrent-multi-writer machinery this field doesn't need.
8. **No `sp03-wdc-systemprompt.md` prose changes.** Like `proposed_wcl`, the `proposed_pillars` tool-schema field description alone carries the instruction to the model; section 6's Stage 2 line already tells it to "isolate necessary World Pillars," and section 9 (Structured Output Contract) doesn't enumerate every structured field in prose today either.

## Architecture

### `web/src/lib/worldEngine/worldTurnSchema.ts` (extended)

Adds `proposed_pillars: z.array(z.string().min(1)).nullable()` to `WorldTurnSchema`, and a matching `proposed_pillars` property to `EMIT_WORLD_TURN_TOOL` (JSON schema `type: ["array", "null"]`, `items: { type: "string" }`), added to `required`. Description: report the ordered list of World Pillars you've identified as relevant for this world, most important first, or `null` if you haven't assessed this yet. Report the list again on every later turn you've assessed one, even if unchanged (mirrors `proposed_wcl`'s existing instruction).

### `web/src/lib/canonEngine/storyStore.ts` (extended)

```ts
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  proposedPillars: string[] | null;
  pillars: string[] | null;
}
```

New functions, following the exact disjoint-dotted-path pattern `setP3ProposedLevel`/`setP3ConfirmedLevel` established in #39's final-review fix:

```ts
export async function setP3ProposedPillars(storyId: string, pillars: string[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.proposedPillars": pillars, updatedAt: new Date().toISOString() });
}

export async function setP3Pillars(storyId: string, pillars: string[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.pillars": pillars, updatedAt: new Date().toISOString() });
}
```

### `web/src/app/api/world-chat/route.ts` (extended)

After a turn's `delta` is extracted: if `delta.proposed_pillars !== null`, call `setP3ProposedPillars(storyId, delta.proposed_pillars)` and include the updated value in the `p3` object of the turn's JSON response (same shape as the existing `proposed_wcl` handling — `p3ForResponse` gains a `proposedPillars` field alongside the existing WCL fields; `pillars` is passed through unchanged from the story's current state, never written here).

### `web/src/app/api/world-chat/pillars/route.ts` (new, `PATCH`)

Same auth pattern as every existing route (`requireUser` → `getStory` 404 → `getMembership` 403). Body: `{ storyId: string, pillars: string[] }`. Validation: `pillars` must be an array; every element must be a non-empty string after trimming; reject (400) otherwise. Calls `setP3Pillars(storyId, pillars)` with the trimmed values, returns the updated `P3State`. No dedup/casing normalization — the author can see exactly what they typed, and a plausible false-positive on "duplicate" pillar names (e.g. "Politics" vs "Political System") isn't this route's call to make.

### `web/src/components/WorldInterview.tsx` (extended)

New state: `pillarDraft: string[]` (local-only, pre-adoption editing surface), `pillarsUpdating: boolean`. On resume, `wclState` (already reads the whole `p3` object) now also carries `proposedPillars`/`pillars`; `pillarDraft` initializes from `pillars ?? proposedPillars ?? []` whenever `pillars` is still `null`.

New panel in the right-panel scroll area, above the existing Notes card (a list needs more room than the header's WCL chip strip):

- **`pillars === null`** (nothing adopted yet): title "Proposed World Pillars" (or "World Pillars" with an empty-state message if `proposedPillars` is also `null`/empty). Renders `pillarDraft` as an editable list — each row has the pillar name, a ✕ remove button, and ▲/▼ reorder buttons (disabled at the ends) — plus an "Add pillar" text input + button that appends to the local draft. All of these mutate `pillarDraft` locally only. A **"Confirm pillar list"** button PATCHes the current `pillarDraft` to `/api/world-chat/pillars`, which sets `pillars` (and re-syncs `pillarDraft` from the response so it also reflects the server's trimmed values).
- **`pillars !== null`** (adopted, including `[]`): the same list-editor UI, but now "live" — every add/remove/reorder immediately PATCHes the resulting full array (no separate confirm step; the author already owns this field). No proposal banner is shown, even if `proposedPillars` later changes — matching WCL's decision 4 posture.

All pillar controls are `disabled={pillarsUpdating || loading}`, matching the existing WCL controls' guard against firing during an in-flight chat turn.

## Error Handling

The new PATCH route follows the exact same domain-error mapping as every other route (`errorResponse` for auth/membership/story-not-found). A malformed `pillars` body (not an array, or containing a blank/non-string entry) is a 400 with a clear message, not a 500. Client-side PATCH failures reuse the existing `error` banner (already shared with chat-turn failures) — no new error UI surface invented.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A fresh session's Stage 2 turn, once the model reports a pillar list, shows it as an editable draft with a "Confirm pillar list" button.
- Adding, removing, and reordering pillars in the draft before confirming only changes local state — no network call until "Confirm pillar list" is clicked.
- After confirming, the same list is now live: any further add/remove/reorder immediately PATCHes, and a resumed session shows the confirmed list directly (never the draft/proposal view), even if the model proposes a different list on a later turn.
- The PATCH route rejects a non-array body and an array containing an empty string with a 400, not a crash.
- A resumed session where `story.p3.pillars` is already set (e.g. `[]`, deliberately cleared) shows the live empty-list editor, not the proposal draft, even if `proposedPillars` is non-empty.
