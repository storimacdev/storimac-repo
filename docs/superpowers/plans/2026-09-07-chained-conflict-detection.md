# Chained Conflict Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision note:** Tasks 1 and 2 below were executed and individually
> reviewed clean as written — the "chain into a new pending conflict"
> approach they describe. The final whole-branch review then found two
> real problems with that approach (the just-resolved field could get
> silently un-confirmed; a new conflict could carry a misattributed
> description), and a follow-up fix commit revised both tasks' code to a
> "suppress and defer" approach instead: no new pending conflict is
> created within the same turn; the field is downgraded and surfaced only
> via a warning log, to be caught by the existing fresh-detection branch
> on a later turn. See `docs/superpowers/specs/2026-09-07-chained-conflict-detection-design.md`
> (updated in place) for the current design. The task text below is left
> as the historical record of what Tasks 1-2 actually implemented at the
> time; it no longer describes the final shipped behavior on its own —
> read it together with the fix commit.

**Goal:** Fix issue #106 — a turn that resolves a pending Story-Foundation conflict AND also declares a fresh conflict for a different field currently drops the new one entirely; chain into the same detection logic already used for a first-time conflict, and fix the route's persistence logic so it doesn't overwrite the chained result back to `null`.

**Architecture:** `web/src/lib/characterEngine/foundationConflict.ts`'s resolution branch currently returns immediately after handling the resolved field. It gains a fallthrough check (reusing a new shared helper, `findConflictCulprit`, also used by the existing fresh-detection branch) that looks for a fresh conflict among the turn's remaining proposals before returning. `web/src/app/api/character-chat/route.ts`'s persistence logic, which currently hardcodes `setP2PendingConflict(storyId, null)` whenever a resolution happened this turn, is changed to persist `conflictResult.nextPendingConflict` instead — whatever the module actually decided, not an assumption that it's always `null`.

**Tech Stack:** TypeScript, Firebase Admin/Firestore. No test runner is configured in this repo (`npm test` has no script) — verification is `npm run lint` (must be clean), `npm run build` (must succeed), and manual/code-trace verification, matching every other feature in this codebase. `foundationConflict.ts` is a pure, I/O-free module (by design, per its own file header) — Task 1's verification traces its logic directly against concrete input/output pairs, since there's no test runner to execute assertions with.

## Global Constraints

- `Story.p2PendingConflict` must never hold more than one entry at a time (the singular-pending-conflict invariant from issue #30) — resolving conflict N and detecting conflict N+1 must happen within the same `processConflict` call, never leaving two conflicts open simultaneously across turns.
- The field that was just resolved this turn must never be re-flagged as its own new conflict — the fresh-conflict check on a resolution turn must exclude `pendingConflict.field` from its candidate search.
- Both the pre-existing fresh-detection branch and the new resolution-turn fallthrough must search `rawUpdates` (pre-causal-chain-enforcement proposals), not `enforcedUpdates` — matching the module's existing documented rationale (a causal-chain-downgraded fact's Foundation conflict must still be caught even though `enforcedUpdates` no longer shows it as Confirmed).
- No change to `buildConflictContextMessage`, the causal-chain enforcement logic (issue #28), the FSM/lock logic (issue #26), or the character-turn schema — all explicitly out of scope.
- The route's `else if (!pendingConflictBefore && conflictResult.nextPendingConflict)` branch (the fresh-detection-with-no-prior-conflict case) must remain unchanged — only the `if (conflictResult.logEntry)` branch's persistence line changes.

---

### Task 1: Chain fresh-conflict detection into the resolution branch

**Files:**
- Modify: `web/src/lib/characterEngine/foundationConflict.ts`

**Interfaces:**
- Produces: `findConflictCulprit(updates: FactUpdateInput[], alreadyConfirmedFields: Set<string>, excludeField?: string): FactUpdateInput | undefined` (new local function, not exported — Task 2 doesn't need it, only `processConflict`'s existing exported signature/return shape, which is unchanged).
- `ConflictProcessingResult`'s shape is unchanged (`enforcedUpdates`, `nextPendingConflict`, `logEntry`, `resolvedField`) — this task changes what values can appear together (a resolution turn can now return both a non-null `logEntry` AND a non-null `nextPendingConflict` in the same result, which was previously impossible), not the shape itself.

- [ ] **Step 1: Extract the culprit-finding helper**

Find the fresh-detection branch (currently around line 177-194):

```ts
  if (!pendingConflict && conflictDetected) {
    const culprit = rawUpdates.find((u) => u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field));
    if (culprit) {
      return {
        enforcedUpdates: downgradeAllConfirmed(enforcedUpdates, alreadyConfirmedFields),
        nextPendingConflict: {
          charId,
          characterName,
          field: culprit.field,
          proposedValue: culprit.value ?? null,
          conflictDescription: conflictDescription ?? "The model flagged a conflict but didn't provide a description.",
          ts,
        },
        logEntry: null,
        resolvedField: null,
      };
    }
  }
```

Add a new function above `processConflict` (right after `downgradeAllConfirmed`, before the `processConflict` function's own doc comment):

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

Then update the fresh-detection branch to call it (no `excludeField` — nothing to exclude when there was no pending conflict this turn):

```ts
  if (!pendingConflict && conflictDetected) {
    const culprit = findConflictCulprit(rawUpdates, alreadyConfirmedFields);
    if (culprit) {
      return {
        enforcedUpdates: downgradeAllConfirmed(enforcedUpdates, alreadyConfirmedFields),
        nextPendingConflict: {
          charId,
          characterName,
          field: culprit.field,
          proposedValue: culprit.value ?? null,
          conflictDescription: conflictDescription ?? "The model flagged a conflict but didn't provide a description.",
          ts,
        },
        logEntry: null,
        resolvedField: null,
      };
    }
  }
```

(Only the `const culprit = ...` line changes here — everything else in this branch is unchanged.)

- [ ] **Step 2: Chain the fresh-conflict check into the resolution branch**

Find the resolution branch (currently around line 138-175):

```ts
  if (pendingConflict && pendingConflict.charId === charId && resolution) {
    const remaining = enforcedUpdates.filter((u) => u.field !== pendingConflict.field);
    const reproposed =
      enforcedUpdates.find((u) => u.field === pendingConflict.field) ??
      rawUpdates.find((u) => u.field === pendingConflict.field);
    const value = reproposed?.value ?? pendingConflict.proposedValue ?? null;

    let resolvedUpdates: FactUpdateInput[] = remaining;
    let resolvedField: string | null = null;
    if (resolution === "update_foundation") {
      resolvedUpdates = [
        ...remaining,
        {
          field: pendingConflict.field,
          value,
          state: "Confirmed",
          rationale: reproposed?.rationale,
          depends_on: reproposed?.depends_on,
        },
      ];
      resolvedField = pendingConflict.field;
    } else if (resolution === "park") {
      resolvedUpdates = [...remaining, { field: pendingConflict.field, value, state: "Deferred" }];
    }
    // "revert": resolvedUpdates stays as `remaining` - the field is dropped entirely.

    return {
      enforcedUpdates: resolvedUpdates,
      nextPendingConflict: null,
      logEntry: {
        charId,
        field: pendingConflict.field,
        conflictDescription: pendingConflict.conflictDescription,
        resolution,
      },
      resolvedField,
    };
  }
```

Replace the final `return` statement with logic that checks for a chained fresh conflict first:

```ts
  if (pendingConflict && pendingConflict.charId === charId && resolution) {
    const remaining = enforcedUpdates.filter((u) => u.field !== pendingConflict.field);
    const reproposed =
      enforcedUpdates.find((u) => u.field === pendingConflict.field) ??
      rawUpdates.find((u) => u.field === pendingConflict.field);
    const value = reproposed?.value ?? pendingConflict.proposedValue ?? null;

    let resolvedUpdates: FactUpdateInput[] = remaining;
    let resolvedField: string | null = null;
    if (resolution === "update_foundation") {
      resolvedUpdates = [
        ...remaining,
        {
          field: pendingConflict.field,
          value,
          state: "Confirmed",
          rationale: reproposed?.rationale,
          depends_on: reproposed?.depends_on,
        },
      ];
      resolvedField = pendingConflict.field;
    } else if (resolution === "park") {
      resolvedUpdates = [...remaining, { field: pendingConflict.field, value, state: "Deferred" }];
    }
    // "revert": resolvedUpdates stays as `remaining` - the field is dropped entirely.

    const logEntry: ConflictLogEntryDraft = {
      charId,
      field: pendingConflict.field,
      conflictDescription: pendingConflict.conflictDescription,
      resolution,
    };

    // Issue #106: this same turn might ALSO declare a fresh conflict for a
    // different field - the field just resolved above is excluded so it
    // can't loop back into being flagged as its own new conflict.
    if (conflictDetected) {
      const culprit = findConflictCulprit(rawUpdates, alreadyConfirmedFields, pendingConflict.field);
      if (culprit) {
        return {
          enforcedUpdates: downgradeAllConfirmed(resolvedUpdates, alreadyConfirmedFields),
          nextPendingConflict: {
            charId,
            characterName,
            field: culprit.field,
            proposedValue: culprit.value ?? null,
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

- [ ] **Step 3: Verify**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings). Run `npm run build` from `web/` — must succeed.

`foundationConflict.ts` is pure and I/O-free — trace these concrete cases by hand against the new code (no test runner in this repo):
- **Ordinary resolution, no chained conflict**: `pendingConflict` set, `resolution: "update_foundation"`, `conflictDetected: false`. Confirm the function returns `nextPendingConflict: null` and the same `logEntry`/`resolvedField` shape as before this change.
- **Resolution with a chained fresh conflict**: `pendingConflict` set (field `"core_wound"`), `resolution: "park"`, `conflictDetected: true`, `conflictDescription: "..."`, and `rawUpdates` containing a second entry (field `"backstory"`, `state: "Confirmed"`) not in `alreadyConfirmedFields`. Confirm the result has `logEntry.field === "core_wound"` (the resolved one) AND `nextPendingConflict.field === "backstory"` (the newly chained one) — both present in the same result.
- **Resolution with `conflictDetected: true` but the only candidate is the just-resolved field itself**: `rawUpdates` contains only the `"core_wound"` entry (no other Confirmed proposal). Confirm `findConflictCulprit(rawUpdates, alreadyConfirmedFields, "core_wound")` returns `undefined` (the exclusion correctly filters it out), so the function falls through to `nextPendingConflict: null` — no infinite loop back onto the same field.
- **Fresh-detection branch (no pending conflict) still works unchanged**: `pendingConflict: null`, `conflictDetected: true`, a Confirmed culprit in `rawUpdates`. Confirm the result matches what the pre-change code would have produced (same `nextPendingConflict` shape, `logEntry: null`).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/foundationConflict.ts
git commit -m "feat: chain fresh conflict detection into a resolution turn"
```

---

### Task 2: Fix the route's persistence logic to not overwrite a chained conflict

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: Task 1's `processConflict` — specifically, that a resolution turn's result can now carry a non-null `nextPendingConflict` alongside a non-null `logEntry` (previously impossible, since the pre-Task-1 resolution branch always returned `nextPendingConflict: null`).

- [ ] **Step 1: Persist `conflictResult.nextPendingConflict` instead of a hardcoded `null`**

Find this block (currently around line 624-640):

```ts
    if (conflictResult.logEntry) {
      console.warn(
        `[character-chat] Story Foundation conflict resolved (${conflictResult.logEntry.resolution}) for ${conflictResult.logEntry.field} on turn ${turnId}`
      );
      await appendCharacterConflictLog(storyId, {
        ...conflictResult.logEntry,
        resolvedBy: user.uid,
        ts: new Date().toISOString(),
        turnId,
      });
      await setP2PendingConflict(storyId, null);
    } else if (!pendingConflictBefore && conflictResult.nextPendingConflict) {
      console.warn(
        `[character-chat] Story Foundation conflict detected for ${conflictResult.nextPendingConflict.field} on turn ${turnId}: ${conflictResult.nextPendingConflict.conflictDescription}`
      );
      await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
    }
```

Replace with:

```ts
    if (conflictResult.logEntry) {
      console.warn(
        `[character-chat] Story Foundation conflict resolved (${conflictResult.logEntry.resolution}) for ${conflictResult.logEntry.field} on turn ${turnId}`
      );
      await appendCharacterConflictLog(storyId, {
        ...conflictResult.logEntry,
        resolvedBy: user.uid,
        ts: new Date().toISOString(),
        turnId,
      });
      if (conflictResult.nextPendingConflict) {
        console.warn(
          `[character-chat] Story Foundation conflict detected for ${conflictResult.nextPendingConflict.field} on turn ${turnId} (chained after resolving a prior conflict): ${conflictResult.nextPendingConflict.conflictDescription}`
        );
      }
      await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
    } else if (!pendingConflictBefore && conflictResult.nextPendingConflict) {
      console.warn(
        `[character-chat] Story Foundation conflict detected for ${conflictResult.nextPendingConflict.field} on turn ${turnId}: ${conflictResult.nextPendingConflict.conflictDescription}`
      );
      await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
    }
```

The only changes: `await setP2PendingConflict(storyId, null);` becomes `await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);`, with a new warning log added just before it for the case where that value is non-null (a chained conflict). The `else if` branch is completely untouched.

- [ ] **Step 2: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed.

Manually trace (no test runner in this repo, and exercising this via a real authenticated multi-turn session isn't available in this environment):
- **Ordinary resolution, no chained conflict** (the common case, unchanged behavior required): `conflictResult.logEntry` set, `conflictResult.nextPendingConflict: null`. Confirm `setP2PendingConflict(storyId, null)` is called — same effect as before this change, just reached via the variable instead of a literal.
- **Resolution with a chained conflict**: `conflictResult.logEntry` set AND `conflictResult.nextPendingConflict` set (per Task 1's new capability). Confirm `setP2PendingConflict(storyId, conflictResult.nextPendingConflict)` persists the NEW conflict (not `null`), and the chained-conflict warning log fires.
- **Fresh detection with no prior conflict** (the pre-existing `else if` case): confirm this path is byte-identical to before — `pendingConflictBefore` falsy, `conflictResult.logEntry` null, `conflictResult.nextPendingConflict` set → the `else if` branch runs exactly as it did pre-change.
- **Re-gate case** (conflict stays open, no resolution, no fresh detection this turn): `conflictResult.logEntry` is `null` and `pendingConflictBefore` is truthy, so the `else if`'s `!pendingConflictBefore` check is false — neither branch fires, matching pre-change behavior (no redundant write).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "fix: persist a chained conflict instead of always clearing to null on resolution"
```
