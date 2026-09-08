# Chained Conflict Detection on a Resolution Turn (Issue #106) — Design

> **Revision note:** an earlier version of this spec had the resolution
> branch start tracking a fresh conflict as a new `Story.p2PendingConflict`
> within the same turn. A final whole-branch review found two real problems
> with that approach (see "Why not chain into a new pending conflict"
> below), and the design was revised to the suppress-and-defer approach
> documented here before merge. No code implementing the earlier approach
> shipped past the review stage.

## Problem

`web/src/lib/characterEngine/foundationConflict.ts`'s `processConflict`
tracks only one pending conflict at a time (`Story.p2PendingConflict`,
singular — matching Project 1's own `pendingConflict` precedent, an
explicit design decision from issue #30). Its resolution branch:

```ts
if (pendingConflict && pendingConflict.charId === charId && resolution) {
  // ... resolve pendingConflict.field, build the log entry ...
  return { enforcedUpdates: resolvedUpdates, nextPendingConflict: null, logEntry, resolvedField };
}
```

returned immediately once it had handled `pendingConflict.field`. It never
inspected `conflictDetected` on that same turn. If a turn both resolves an
existing pending conflict AND the model's newly-proposed Confirmed
fact(s) trigger a fresh `conflict_detected: true` for a *different*
field, that new conflict was dropped entirely — no pending conflict
recorded, nothing downgraded, nothing logged. The new fact passed
straight through to `applyStateDelta` as Confirmed, unnoticed.

## Why not chain into a new pending conflict

The fresh-detection branch immediately below already has everything
needed to detect a fresh conflict:

```ts
if (!pendingConflict && conflictDetected) {
  const culprit = rawUpdates.find((u) => u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field));
  if (culprit) {
    return {
      enforcedUpdates: downgradeAllConfirmed(enforcedUpdates, alreadyConfirmedFields),
      nextPendingConflict: { charId, characterName, field: culprit.field, proposedValue: culprit.value ?? null, conflictDescription: ..., ts },
      logEntry: null,
      resolvedField: null,
    };
  }
}
```

The first version of this fix made the resolution branch fall through
into this same logic — exclude the just-resolved field from the culprit
search, then start tracking whatever's left as the new pending conflict,
all within the same turn. A final whole-branch review found this
introduces two real problems, both rooted in the fact that
`conflictDetected`/`conflictDescription` are single **turn-level** fields
(the model can only flag one conflict per turn, with one description),
not per-field:

1. **The just-resolved field gets silently un-confirmed.** When
   `resolution === "update_foundation"`, the resolved field is re-added to
   `resolvedUpdates` as `Confirmed` earlier in the same branch. Chaining
   into `downgradeAllConfirmed(resolvedUpdates, alreadyConfirmedFields)`
   sweeps EVERY Confirmed entry — including the one just resolved this
   same turn — back to `Working`. The author's resolution gets logged as
   "applied" but the fact itself would silently land as `Working` anyway,
   with no warning.
2. **A new conflict could carry the WRONG description.** On an
   `update_foundation` turn, the model may legitimately re-set
   `conflict_detected: true` just restating the conflict being resolved,
   since `update_foundation` never actually edits the Foundation
   Document — the contradiction technically still stands from the
   model's point of view. If that same turn also has an unrelated new
   Confirmed fact, the old chaining approach would find that unrelated
   fact as the "culprit" and attach the OLD conflict's `conflictDescription`
   (describing the field that was just resolved) to it — showing the
   author a three-choice prompt about the wrong field with the wrong
   explanation.

Both problems come from forcing "resolve field A" and "detect field B" to
share the same turn-level `conflictDetected`/`conflictDescription` inputs
and the same `downgradeAllConfirmed` sweep. The fix below avoids the
coupling entirely instead of patching around it.

## Fix: suppress and defer, don't chain

A resolution turn that also has `conflictDetected: true` for a different
field downgrades that field (and any other stray Confirmed proposal this
turn, **excluding** the field that was just resolved) to `Working`, and
signals this via a new result field, `suppressedConflictField`, so the
route can log a warning. **No new pending conflict is created this same
turn.** The field will be caught by the module's own existing,
untouched fresh-detection branch on a later turn, once the model
re-proposes it as Confirmed while nothing else is being resolved — at
that point `conflictDetected`/`conflictDescription` genuinely describe
only that field, with no sharing/misattribution risk.

Extract the culprit-finding predicate into a small shared helper (used by
both the fresh-detection branch and the resolution branch's suppression
check):

```ts
function findConflictCulprit(
  updates: FactUpdateInput[],
  alreadyConfirmedFields: Set<string>,
  excludeField?: string
): FactUpdateInput | undefined {
  return updates.find(
    (u) => u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field) && u.field !== excludeField
  );
}
```

A second small helper, mirroring `downgradeAllConfirmed` but sparing one
named field:

```ts
function downgradeAllConfirmedExcept(
  updates: FactUpdateInput[],
  alreadyConfirmedFields: Set<string>,
  excludeField: string
): FactUpdateInput[] {
  return updates.map((u) =>
    u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field) && u.field !== excludeField
      ? { ...u, state: "Working" }
      : u
  );
}
```

The resolution branch, instead of returning immediately after building
`resolvedUpdates`/`logEntry`/`resolvedField`:

```ts
if (pendingConflict && pendingConflict.charId === charId && resolution) {
  // ... existing resolution logic building resolvedUpdates/resolvedField ...
  const logEntry: ConflictLogEntryDraft = {
    charId, field: pendingConflict.field, conflictDescription: pendingConflict.conflictDescription, resolution,
  };

  let suppressedConflictField: string | null = null;
  if (conflictDetected) {
    const culprit = findConflictCulprit(rawUpdates, alreadyConfirmedFields, pendingConflict.field);
    if (culprit) {
      suppressedConflictField = culprit.field;
      resolvedUpdates = downgradeAllConfirmedExcept(resolvedUpdates, alreadyConfirmedFields, pendingConflict.field);
    }
  }

  return { enforcedUpdates: resolvedUpdates, nextPendingConflict: null, logEntry, resolvedField, suppressedConflictField };
}
```

`nextPendingConflict` from this branch is always `null` again (same as
before any #106 fix existed) — no new conflict object is ever
constructed here, so there's nothing to misattribute a description to.
`downgradeAllConfirmedExcept` explicitly spares `pendingConflict.field`,
so the resolution this turn just applied survives.

The fresh-detection branch and the two other branches (re-gate, final
fallthrough) are otherwise unchanged, each gaining only
`suppressedConflictField: null` in their returned object (the field is
required on `ConflictProcessingResult`, not optional).

## Data flow — the route's persistence logic

`character-chat/route.ts`'s existing persistence logic:

```ts
if (conflictResult.logEntry) {
  // ... log the resolution ...
  await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
} else if (!pendingConflictBefore && conflictResult.nextPendingConflict) {
  // ... log the fresh detection ...
  await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
}
```

stays as the general "persist whatever the module decided" shape
(the more robust principle than hardcoding a literal `null`), and gains
one addition: log a warning when `conflictResult.suppressedConflictField`
is set, so the suppression is visible in server logs even though it
produces no user-facing conflict prompt:

```ts
if (conflictResult.logEntry) {
  // ... log the resolution (unchanged) ...
  if (conflictResult.suppressedConflictField) {
    console.warn(
      `[character-chat] conflict_detected still set for ${conflictResult.suppressedConflictField} on turn ${turnId} while resolving a different pending conflict for ${charId} - downgraded to Working instead of starting a second pending conflict this same turn`
    );
  }
  await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
} else if (!pendingConflictBefore && conflictResult.nextPendingConflict) {
  // ... unchanged ...
}
```

`conflictResult.nextPendingConflict` from the resolution branch is always
`null` under this design, so this line persists `null` — the same
effective result as before any #106 fix, just reached by respecting the
module's return value rather than a hardcoded literal.

## Invariant preserved

`Story.p2PendingConflict` is still ever at most one entry, and — unlike
the earlier chaining approach — this design never even attempts to write
a second one within the same turn. The singular-pending-conflict design
decision (issue #30) holds by construction, not by careful sequencing.

## Edge cases

- **The just-resolved field re-appears as `conflictDetected`'s target**:
  excluded via `excludeField` in `findConflictCulprit`, so a
  stale/redundant `conflict_detected` flag left over from restating the
  same conflict can't cause a suppression against the field that was
  just settled this turn (`suppressedConflictField` stays `null`).
- **`conflictDetected` is true but every remaining Confirmed proposal is
  already-confirmed or there simply are no remaining Confirmed
  proposals**: `findConflictCulprit` returns `undefined`, the `if
  (culprit)` guard fails, `suppressedConflictField` stays `null`, and
  `resolvedUpdates` is returned unchanged (no downgrade needed since
  there was nothing to downgrade).
- **The suppressed field's next natural turn**: once the model re-proposes
  it as Confirmed on a later turn where nothing else is being resolved,
  the pre-existing, untouched fresh-detection branch (`!pendingConflict &&
  conflictDetected`) picks it up exactly as it would for any other fresh
  conflict — `conflictDetected`/`conflictDescription` on that later turn
  describe only that field, with no sharing/misattribution risk.
- **A resolution turn under a different character than the one the
  conflict was raised against**: unaffected — that's the pre-existing,
  untouched final `return` case (a pending conflict for a different
  `charId` passes through unchanged), still reachable via issue #26's
  `switch_override` while a conflict is pending for another character.

## Out of scope

- No change to the causal-chain enforcement logic itself (issue #28,
  already shipped) or the FSM/lock logic itself (issue #26, already
  shipped) — this only touches `foundationConflict.ts`'s own resolution
  branch.
- No change to `buildConflictContextMessage`'s wording or the three-choice
  UI flow — nothing about the message-building or resolution vocabulary
  changes; a suppressed field simply doesn't generate a pending conflict
  this turn, so there's no new message to build.
- No same-turn queueing of a second conflict — deliberately deferred by
  one turn instead, per the "Why not chain" section above. A third
  conflict declared on the SAME turn as a suppressed second one isn't a
  real scenario the schema supports either way: `conflict_detected`/
  `conflict_description` are singular per-turn fields, not a list.
- A fresh conflict declared by a DIFFERENT character while character A's
  conflict is still pending is a separate, pre-existing gap in the same
  bug family (the fresh-detection branch is guarded by `!pendingConflict`
  globally, not per-character) — out of scope for this issue, worth its
  own follow-up.
