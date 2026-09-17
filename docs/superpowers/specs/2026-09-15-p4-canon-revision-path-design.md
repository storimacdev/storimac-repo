# P4 Canon Revision Path — Design Spec

GitHub issue: #64 ("[P4] Implement Relational Impact Check / Canon Revision path")
PRD refs: §7.6 FR-6.4, §11 test case 4.
Also closes the scope `developmentLoop.ts`'s own header comment already attributes to this
issue: enforcing that a `Confirmed` structural unit can't silently revert to
`Exploring`/`Working` (the guard `canonEngine/transitions.ts`'s `isValidTransition` already
provides for every other project's canon elements).

## Problem

Two related gaps, both about the same underlying rule — a `Confirmed` fact can't be silently
undone, whether it's P4's own or another project's:

1. **P4-internal regression.** `attemptStatusTransition` today applies whatever status the
   model requests with zero check against the unit's *current* status. A unit that's already
   `Confirmed` can be silently downgraded back to `Working`/`Exploring` in a single turn, with
   no halt, no logging, no author confirmation — the exact hole `canonEngine/transitions.ts`'s
   `isValidTransition` already closes for every other project (`Confirmed` only ever forward-
   reaches `Parked`; anything else needs the Conflict Resolution flow, per that file's own
   comment).
2. **Cross-project contradiction.** A P4 structural unit's proposed content can imply changing
   an already-locked P1-3 fact it cites via `canon_refs` (the issue's own test case: proposing
   a change to a character's Core Wound). Nothing detects or halts on this today.

## Research: what "locked P1-3 canon" actually means per project

Investigated before designing (per this codebase's own established convention — P2 forked
its own conflict-resolution module rather than reusing P1's, and P3 explicitly investigated
and followed P2's precedent rather than assuming reuse):

- **P1 (Story Foundation):** a versioned document (`p1Locked` boolean), not a `CanonElement`.
- **P2 (Character Bible):** a compiled sign-off document per character
  (`characterBibleEntries`), not a `CanonElement` either — `ingestCanon.ts`'s own
  `resolveCharacterProgress` reads `characterProgress[charId].status === "signed_off"`.
- **P3 (World Bible):** pillars genuinely are `CanonElement`s (`WORLD_ELEMENTS_COLLECTION`),
  with per-pillar `Confirmed` status — the only one of the three P4 can write back into using
  already-existing generic machinery (`canonEngine/canonStore.ts`'s `upsertElement`,
  `canonEngine/conflictResolution.ts`'s `findCascadeReview`).

**Decision (confirmed with the user, revised once during design):** Option B ("update parent
canon") never writes into P1, P2, or P3's own stores, for any source project. The first pass
of this decision proposed a "real write" path for P3 specifically (pillars are actual
`CanonElement`s with existing `upsertElement` machinery) — but P4's contradiction always
originates from a screenplay scene's free-text content, and the model never produces a
structured replacement value for the pillar/entry itself, unlike P3's own conflict flow (issue
#47), which always has a clean new value because it originates from a *structured* entry
proposal in the first place. Writing anything into P3's canon here would mean fabricating a
pillar value from scene prose, which is worse than not writing at all. So for every source
project, Option B logs the decision and flags it as a required upstream revision (Outstanding
Decisions + `canon_revision_log`); the author makes the actual edit on that project's own
screen. The one thing still reused from existing machinery: for a P3-sourced contradiction,
`canonEngine/canonStore.ts`'s existing `listDependents(storyId, elementId,
WORLD_ELEMENTS_COLLECTION)` (its own comment already names "Project 4's Relational Impact
Check" as a future caller) surfaces the pillar's current Confirmed dependents as an
*informational* cascade list — never a write, just context for the author's decision.

## Design

This mirrors `worldEngine/conflictResolution.ts`'s (issue #47) exact multi-turn shape — a
P4-local fork, not a call-through, following the same "investigate reuse, fork when the
storage shape genuinely differs" precedent P2 and P3 already established. P4's canon
(`StructuralUnit[]`) doesn't live in `canonEngine/canonStore.ts`'s generic `elements`
collection at all, so it can't share P1's literal functions either.

### 1. Two detection triggers, one shared halt-and-3-choice flow

**Trigger A — unit regression (deterministic, app-side, zero new model field).** Before
processing a `proposed_unit`, check `existing && !isValidTransition(existing.status,
proposed.requested_status)` — reusing `canonEngine/transitions.ts`'s existing, already-generic
function directly (`StructuralUnit.status` is already typed `CanonStatus`). True exactly when
an already-`Confirmed` unit is asked to move to `Exploring`/`Working`. No semantic judgment
needed — this is exactly as deterministic as `isValidTransition` already is for every other
project.

**Trigger B — cross-project contradiction (model-reported, same reasoning as `validation_result`
and `causal_tag`).** Add `canon_contradiction` to `proposed_unit` in `architectureTurnSchema.ts`:

```ts
canon_contradiction: z
  .object({
    contradicted_ref: z.string().min(1),
    source_project: z.enum(["Project 1", "Project 2", "Project 3"]),
    explanation: z.string().min(1),
  })
  .nullable(),
```

Null when the model detects no contradiction (the normal case, every turn). The app cannot
detect this itself — whether new content contradicts an already-locked fact is exactly the
kind of semantic judgment issue #111 already established must come from the live model, with
the app owning only the deterministic *consequence*.

Both triggers produce the same `P4PendingConflict` shape and the same halt: forward progress
on `proposed_unit` stops entirely until the author picks one of the three choices, mirroring
`world-chat/route.ts`'s exact sequencing (`if (pendingConflictBefore && delta.resolution !==
null) { resolve } else if (!pendingConflictBefore && <trigger fires>) { open a new one }`,
with ordinary unit processing running only when neither branch fires).

### 2. Pending-conflict storage (mirrors `story.p3PendingConflict` exactly)

New type in `storyStore.ts`, alongside the existing `P4State`:

```ts
export type P4PendingConflict =
  | {
      kind: "unit_regression";
      unitId: string;
      requestedStatus: "Exploring" | "Working";
      requestedContent: string;
      requestedCanonRefs: string[];
      ts: string;
    }
  | {
      kind: "canon_contradiction";
      unitId: string;
      sourceProject: "Project 1" | "Project 2" | "Project 3";
      contradictedRef: string;
      explanation: string;
      requestedStatus: "Exploring" | "Working" | "Confirmed" | "Parked";
      requestedContent: string;
      requestedCanonRefs: string[];
      ts: string;
    };
```

Both variants carry the triggering turn's full requested content/status/canon_refs — the same
reason `P3PendingConflict`'s `confirmed_entry` variant stores `newValue` at detection time:
so that `accept_and_update` can apply the original request later without asking the model to
re-propose it from scratch on the resolution turn.

`Story.p4PendingConflict?: P4PendingConflict | null` (new field, alongside the existing
`p4`/`p4Units`), with `setP4PendingConflict(storyId, conflict: P4PendingConflict | null):
Promise<void>` — a plain top-level field write, same shape as `setP3PendingConflict`.

### 3. Resolution — new top-level turn field, new P4-local module

Add to `architectureTurnSchema.ts`'s top level (not nested — resolving a pending conflict is a
turn-level action, matching `worldTurnSchema.ts`'s own `resolution` field placement):

```ts
resolution: z.enum(["revert", "accept_and_update", "park"]).nullable(),
```

New file `web/src/lib/storyArchitectureEngine/canonRevision.ts` (P4's own fork):

- `buildP4ConflictContextMessage(conflict: P4PendingConflict): string` — grounding block
  instructing the model to present exactly the three choices from the issue's own AC wording
  in `reply`, and report `resolution` on its next turn. Mirrors
  `worldEngine/conflictResolution.ts`'s `buildConflictContextMessage` shape exactly.
- `resolveP4Conflict(params): Promise<{ units: StructuralUnit[]; cascadeReview: CascadeReviewEntry[] | null }>`:
  - **`revert`**: no unit write. The unit stays exactly as it was before the triggering turn.
  - **`park`**: `setUnitStatus(unit, "Parked")` on the affected unit — always safe regardless
    of trigger kind, matching `canonEngine/transitions.ts`'s own "`Parked` reachable from
    anywhere" rule.
  - **`accept_and_update`**: applies the conflict's stored `requestedStatus`/`requestedContent`/
    `requestedCanonRefs` to the unit (the author's original idea now proceeds). No write ever
    happens against P1, P2, or P3's own canon, for any source project — the log entry (next
    section) is the durable record, and the author makes the actual matching edit on the
    owning project's own screen. When `kind === "canon_contradiction" && sourceProject ===
    "Project 3"`, additionally calls `canonEngine/canonStore.ts`'s existing `listDependents(storyId,
    contradictedRef, WORLD_ELEMENTS_COLLECTION)`, filtered to `Confirmed`, as a purely
    informational cascade list (that function's own comment already names "Project 4's
    Relational Impact Check" as a future caller) — context for the author's decision, not a
    write.
  - Every path appends one entry to a new `canon_revision_log` subcollection (mirrring
    `appendP3ConflictLog`'s shape) with a timestamp, the resolution choice, and a plain-language
    rationale — the issue's own AC: "Resolution choice and rationale are logged to
    canon_revision_log with a timestamp."
  - Cascade review beyond the informational P3-dependents list above is explicitly **out of
    scope** here — issue #72 owns "trace and flag all downstream structural units affected
    across Projects 1-4." This spec's cascade review is scoped to what already exists cheaply
    (P3's own `listDependents`) plus a P4-internal scan (`units.filter(u =>
    u.canonRefs.includes(contradictedRef))`) for units elsewhere in the SAME screenplay that
    cite the same contradicted reference — not a full cross-project ledger.

### 4. sp04 prompt

New Section 9, "CANON REVISION PATH" (renumbering the current Section 9 "OPENING TURN" to
Section 10), explaining: a `Confirmed` unit cannot revert to Exploring/Working without going
through this path (Trigger A is enforced by the app regardless of what the model says — this
is disclosed, not hidden, matching every other app-side clamp's own convention); when the
model itself recognizes new content contradicts an already-locked P1-3 fact it's citing, it
must report `canon_contradiction` rather than silently accepting the new idea; and once a
conflict is open (grounding block present), present exactly the three choices and stop all
other structural development until `resolution` is set.

### 5. Route wiring and UI

`route.ts` gains the pending-conflict-before injection, the two-trigger detection (ordered:
resolve first if one is pending and `resolution` was reported; otherwise check Trigger A then
Trigger B before any ordinary unit processing runs), and response fields `pendingConflict`/
`cascadeReview`. `ArchitectureInterview.tsx` gets one new banner rendering
`pendingConflict`'s plain-language summary when present (mirroring the existing
`placementFlag`/rejection-reason banners' styling), plus a `cascadeReview` list when non-null.

## What's out of scope

- Full cross-project cascade tracing beyond P3's own reused machinery (issue #72).
- A cross-project write path into P1's Foundation or P2's Character Bible (confirmed with the
  user — flag, don't write).
- Live-model verification of the halt-and-present-3-choices conversational behavior (PRD test
  case 4) — matches #111's #143 and #63's #152; tracked as a follow-up after this ships.

## Files touched

- Modify: `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts` (top-level
  `resolution`; `proposed_unit.canon_contradiction`)
- Modify: `web/src/lib/canonEngine/storyStore.ts` (`P4PendingConflict` type,
  `Story.p4PendingConflict`, `setP4PendingConflict`, a `canon_revision_log` append function)
- Create: `web/src/lib/storyArchitectureEngine/canonRevision.ts`
  (`buildP4ConflictContextMessage`, `resolveP4Conflict`)
- Modify: `web/system-prompts/sp04-sae-systemprompt.md` (new Section 9, renumber old 9 to 10)
- Modify: `web/src/app/api/architecture-chat/route.ts` (grounding injection, two-trigger
  detection, resolution handling, response fields)
- Modify: `web/src/components/ArchitectureInterview.tsx` (pending-conflict + cascade-review
  banners)

## Testing

No test suite exists in this project. Verification is `tsc --noEmit`, `npm run lint`,
`npm run build`, and direct code trace by the task reviewer, matching #63's and #111's own
standard.
