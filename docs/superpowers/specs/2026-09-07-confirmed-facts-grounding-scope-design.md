# Confirmed-Facts Grounding Scope & Truncation (Issue #107) — Design

## Problem

`web/src/app/api/character-chat/route.ts`'s Confirmed-facts grounding block
(currently lines 286-312) injects, unconditionally on every turn, every
Confirmed fact's full free-text value for **every character with a
`characterProgress` entry** — active, deferred, in-progress, or already
signed off. It reuses `relationshipGroundedIds =
Object.keys(p2State.characterProgress)`, the same array the Relationship
Graph block above it uses, but unlike that block (O(characters), a handful
of short enum-ish fields per relationship) this one is O(characters ×
~30 fields), with each field's value uncapped free text (no `.max()` in
`characterTurnSchema.ts`).

At the time this issue was filed, the shared Anthropic rate-limit gate's
`ITPM_LIMIT` placeholder was 30,000 — a large enough cast could push a
single turn's estimate past that ceiling permanently, at which point
`acquireAnthropicSlot` can never grant capacity and every turn 503s with
no in-app recovery. `ITPM_LIMIT`'s default is now 200,000 (raised
2026-09 after confirming the account has no real capacity constraint),
so that catastrophic scenario is far less likely — but the block is still
unbounded per-turn waste regardless of the ceiling, and worth fixing now
rather than waiting for it to become a real problem again.

## Fix: scope + truncate

### Scoping

The route already computes `p2State` (from `story.p2`) before this block
runs, which includes `activeCharacterId: string | null` — the one
character currently locked by the sequential-interview FSM (issue #26),
authoritative and known server-side before the model is ever called. This
is a materially better signal than "inject everyone, trust the model to
pick out what's relevant," and isn't the same thing as the block's own
comment ("current_character isn't known until after this turn's model
call") — that refers to the *model's own* reported field on its
structured output, not the app's own lock state.

New local helper in `character-chat/route.ts` (alongside the file's other
small local functions like `resolveCharId`, `toFactUpdate`):

```ts
function computeGroundedCharacterIds(p2State: P2State): string[] {
  const signedOffIds = Object.entries(p2State.characterProgress)
    .filter(([, progress]) => progress.status === "signed_off")
    .map(([id]) => id);
  if (!p2State.activeCharacterId) return signedOffIds;
  return signedOffIds.includes(p2State.activeCharacterId)
    ? signedOffIds
    : [p2State.activeCharacterId, ...signedOffIds];
}
```

(The `signedOffIds.includes(...)` guard is defensive dedup only — the FSM
invariant is that signing off clears `activeCharacterId` to `null`, so a
signed-off character should never also be the active one, but the check
costs nothing and protects against that invariant ever drifting.)

The Confirmed-facts block's loop changes from iterating
`relationshipGroundedIds` (all characters) to iterating
`computeGroundedCharacterIds(p2State)`. The Relationship Graph block
immediately above it is **unchanged** — it's O(characters), not flagged
by this issue, and out of scope here.

**When no character is locked** (`activeCharacterId` is `null` — e.g.
right after the opening turn, or in the gap between one character's
sign-off and the next lock): the block includes signed-off characters
only. There's no "don't re-ask X's facts" need when nobody is actively
being interviewed; the "don't contradict an already-finished character"
need still applies exactly as it does on any other turn.

### Truncation (defense-in-depth)

Each included fact's value is capped at 200 characters (matching the
issue's own suggested budget), with `…` appended when truncated, before
being interpolated into the grounding text:

```ts
function truncateFactValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
```

This bounds even a single scoped-in character's very long free-text field
— scoping alone reduces the *count* of characters contributing to the
block, not the length of any one field.

### Combined effect on the block's construction

The existing loop body:

```ts
const fieldLines = confirmed
  .map((e) => `  - ${e.element_id.slice(id.length + 1)}: ${typeof e.value === "string" ? e.value : JSON.stringify(e.value)}`)
  .join("\n");
```

becomes:

```ts
const fieldLines = confirmed
  .map((e) => `  - ${e.element_id.slice(id.length + 1)}: ${truncateFactValue(e.value)}`)
  .join("\n");
```

and the outer loop iterates `computeGroundedCharacterIds(p2State)` instead
of `relationshipGroundedIds`.

## Edge cases

- **A character is both the active lock and signed off**: shouldn't happen
  per the FSM invariant (see above); the helper's dedup guard handles it
  harmlessly either way.
- **No characters signed off yet, and no one locked**: `groundedIds` is
  empty, the block's existing `if (factLines.length > 0)` guard already
  suppresses the whole grounding section — no empty `[Confirmed Facts So
  Far - ...]` header ever renders. No new code needed for this; it falls
  out of the existing guard.
- **A deferred (not active, not signed off) character with Confirmed
  facts**: excluded from the block. This is intentional — nothing is
  currently asking that character anything, so there's no near-term risk
  of the model re-asking a settled fact for them. When the author resumes
  and locks them again, `activeCharacterId` updates and their facts
  reappear in the block on the very next turn.

## Out of scope

- The Relationship Graph block (unchanged, not flagged by this issue).
- Any change to the FSM's locking/sign-off logic itself (issue #26,
  already shipped) — this only reads `p2State`, never writes it.
- Feeding `characterBibleEntries` (issue #34's compiled Bible summaries)
  into grounding — that data still isn't read back into the system
  prompt anywhere in this route; adding it is a separate, larger change
  (a new grounding source, not a fix to this existing one) and isn't
  needed to solve the unbounded-growth problem this issue is about.
- Any change to `CHARACTER_MESSAGE_WINDOW` or the replayed-transcript
  bounding — unrelated, already-bounded mechanism.
