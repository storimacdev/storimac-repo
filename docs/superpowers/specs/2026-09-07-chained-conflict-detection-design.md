# Chained Conflict Detection on a Resolution Turn (Issue #106) — Design

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

returns immediately once it's handled `pendingConflict.field`. It never
inspects `conflictDetected` on that same turn. If a turn both resolves an
existing pending conflict AND the model's newly-proposed Confirmed
fact(s) trigger a fresh `conflict_detected: true` for a *different*
field, that new conflict is dropped entirely — no pending conflict
recorded, nothing downgraded, nothing logged. The new fact passes
straight through to `applyStateDelta` as Confirmed, unnoticed.

The fresh-detection branch immediately below already has everything
needed to handle this correctly:

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

It's just unreachable from a resolution turn, since the resolution
branch's early `return` happens first.

## Fix: chain into the same detection logic

Extract the culprit-finding predicate into a small shared helper:

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

The fresh-detection branch calls it with no `excludeField` (unchanged
behavior — nothing to exclude when there was no pending conflict this
turn). The resolution branch, instead of returning immediately after
building `resolvedUpdates`/`logEntry`/`resolvedField`, calls it against
`rawUpdates` with `excludeField: pendingConflict.field` (the field that
was JUST resolved this same turn must never be re-flagged as its own
new conflict), and only then returns:

```ts
if (pendingConflict && pendingConflict.charId === charId && resolution) {
  // ... existing resolution logic building resolvedUpdates/resolvedField ...
  const logEntry: ConflictLogEntryDraft = {
    charId, field: pendingConflict.field, conflictDescription: pendingConflict.conflictDescription, resolution,
  };

  if (conflictDetected) {
    const culprit = findConflictCulprit(rawUpdates, alreadyConfirmedFields, pendingConflict.field);
    if (culprit) {
      return {
        enforcedUpdates: downgradeAllConfirmed(resolvedUpdates, alreadyConfirmedFields),
        nextPendingConflict: {
          charId, characterName, field: culprit.field, proposedValue: culprit.value ?? null,
          conflictDescription: conflictDescription ?? "The model flagged a conflict but didn't provide a description.",
          ts,
        },
        logEntry,
        resolvedField,
      };
    }
  }

  return { enforcedUpdates: resolvedUpdates, nextPendingConflict: null, logEntry, resolvedField };
}
```

Both branches now go through the identical culprit-finding logic;
`rawUpdates` is used in both (matching the module's existing rationale
— a causal-chain-downgraded fact's Foundation conflict must still be
caught even though `enforcedUpdates` no longer shows it as Confirmed).

## Data flow — no other change needed

`nextPendingConflict` already flows unchanged into `Story.p2PendingConflict`
(the caller in `character-chat/route.ts` already does this for both the
resolution and fresh-detection branches identically), which already drives
`buildConflictContextMessage`'s injection into the next turn's system
prompt. The author sees the new conflict's three-choice prompt on their
very next turn — the exact same mechanism already used for any other
conflict. No route, schema, or UI change is needed; this is a pure
`foundationConflict.ts` module fix.

## Invariant preserved

`Story.p2PendingConflict` is still ever at most one entry — resolving
conflict N and detecting conflict N+1 happen within the same call, so
the story is never persisted with two pending conflicts. This keeps the
original singular-pending-conflict design decision (issue #30) intact,
per this issue's own explicit constraint.

## Edge cases

- **The just-resolved field re-appears as `conflictDetected`'s target**:
  excluded via `excludeField`, so a stale/redundant `conflict_detected`
  flag left over from restating the same conflict can't loop back into
  re-flagging the field that was just settled this turn.
- **`conflictDetected` is true but every remaining Confirmed proposal is
  already-confirmed or there simply are no remaining Confirmed
  proposals**: `findConflictCulprit` returns `undefined`, the `if
  (culprit)` guard fails, and the function falls through to the final
  `return` — same shape as the pre-existing fresh-detection branch's own
  behavior when `conflictDetected` is true but no real culprit exists
  (a model false-positive, effectively a no-op for the flag).
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
  UI flow — the newly-chained conflict uses the exact same message-building
  and resolution vocabulary as any other pending conflict.
- No queueing of more than one conflict beyond what naturally falls out of
  "resolve one, detect the next, in the same turn" — a third conflict
  declared on the SAME turn as a second (i.e. the model flagging
  `conflict_detected` for yet another field while also resolving one and
  triggering a second) is not a real scenario the schema supports:
  `conflict_detected`/`conflict_description` are singular per-turn fields,
  not a list, so at most one fresh conflict can ever be declared on any
  given turn regardless of how many Confirmed proposals that turn carries.
