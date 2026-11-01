# P4 Canon Revision Cascade Tracing & Dependency/Continuity Ledger — Design Spec

GitHub issue: #72 ("[P4] Implement Canon Revision cascade tracing & Continuity Ledger")
PRD refs: §7.6 FR-6.4 (Option B), §8 NFR-2, §12 (Risks: Canon Revision cascade complexity).
Builds directly on #64's already-shipped Canon Revision Path
(`web/src/lib/storyArchitectureEngine/canonRevision.ts`,
`web/src/lib/canonEngine/storyStore.ts`'s `P4PendingConflict`/`appendP4CanonRevisionLog`) and on
#64's own design spec's explicit deferral: "Full cross-project cascade tracing beyond P3's own
reused machinery (issue #72)."

## Problem

#64 shipped the halt-and-3-choice flow and a minimal cascade: when `accept_and_update` resolves a
`canon_contradiction`, it already surfaces (a) other P4 units citing the same `contradictedRef`,
and (b) for a Project-3-sourced contradiction only, Confirmed World Bible elements that
`depends_on` the contradicted pillar (via `canonEngine/canonStore.ts`'s `listDependents`). Two
gaps remain, both explicitly named in the issue:

1. **Cascade tracing is incomplete.** `unit_regression` conflicts get zero cascade review today
   (`resolveP4Conflict` only computes `cascadeReview` inside the `kind === "canon_contradiction"`
   branch). And even for `canon_contradiction`, the only axis traced is "cites the same canon
   ref" plus (P3 only) the generic `depends_on` graph — there is no notion of "later work in
   THIS screenplay that was built assuming the thing that just changed."
2. **No ledger a human can query.** `appendP4CanonRevisionLog` is write-only — no reader exists
   anywhere in the codebase (tracked separately as issue #159). Separately, and un-tracked
   anywhere before this issue: ordinary `Confirmed` transitions reached through ordinary turn
   processing (not through the Canon Revision Path) are never logged at all — there is no record
   of "who confirmed what, when" for the common case.

## Research: what "downstream" can actually mean here, per source

Investigated before designing, per this codebase's established convention of checking what
machinery genuinely exists before assuming a cascade can reuse it:

- **P4-internal, by shared canon ref (already shipped).** `canonRefs: string[]` on
  `StructuralUnit` only ever holds P1-3 canon ids (confirmed in `sp04-sae-systemprompt.md`
  Section 8 and `architectureTurnSchema.ts`'s own field description: "ids of any Confirmed
  P1-P3 canon this unit draws from"). It never holds another P4 unit's `unitId`. So there is no
  existing P4-unit-to-P4-unit reference graph beyond "two units cite the same external ref" —
  confirmed by grepping every write site; nothing ever puts a `unitId` into `canonRefs`.
- **P3 (World Bible), by `depends_on` (already shipped, kept as-is).** `WORLD_ELEMENTS_COLLECTION`
  pillars are genuine `CanonElement`s with a real `depends_on` graph, and the `contradicted_ref`
  the model is told to report for a Project-3 source is the pillar's real `elementId`
  (`architecture-chat/route.ts`'s own grounding block: `contradicted_ref` set to "the elementId
  shown here"). `listDependents(storyId, contradictedRef, WORLD_ELEMENTS_COLLECTION)` therefore
  returns real, correctly-keyed dependents. No change needed here.
- **P2 (Character Bible), by `depends_on` — investigated, does NOT work, left alone.**
  `CHARACTER_FACTS_COLLECTION` also has a real `depends_on` graph, which looked promising per
  this issue's own hint ("existing `depends_on` graph machinery ... as a precedent"). But the ref
  format doesn't match: `architecture-chat/route.ts`'s grounding block tells the model to report
  `contradicted_ref` as the bare **charId** for a Project-2 source ("contradicted_ref set to the
  charId shown here"), while every `characterFacts` element id — and therefore every value ever
  written into another fact's `depends_on` array — is the composite `${charId}.${field}`
  (`character-chat/route.ts` line 116: `patch.depends_on = u.depends_on.map(f => \`${charId}.${f}\`)`).
  An `array-contains` query for the bare charId against those composite strings will never match
  a real entry. Calling `listDependents` here would silently return `[]` forever — worse than not
  calling it, because it would look like "verified no dependents" rather than "this axis doesn't
  apply." **Decision: do not call `listDependents` against `CHARACTER_FACTS_COLLECTION` for a
  Project-2 source.** `characterFacts`' own `depends_on` graph is intra-character psychological
  traceability (`causalChain.ts`), not a cross-character or P4-citation graph anyway.
- **P1 (Story Foundation) — no graph exists at all.** Confirmed by #64's own design doc and by
  `ingestCanon.ts`'s `IngestedProject1Canon`: P1 canon surfaced to P4 is plain fields off a
  versioned document (`premise`, `logline`, `storyDna`, ...), never `CanonElement`s, never given
  stable per-field ids. There is nothing a `contradicted_ref` could even key into deterministically
  for Project 1, and nothing this issue can build without inventing an id scheme P1 itself doesn't
  have. **Out of scope**, same as #64 already concluded.
- **A genuinely new axis exists and is cheap: structural position (`stepNumber`).** Every
  `StructuralUnit` already persists `stepNumber` (1-10, issue #56) — "which of the 10 structural
  steps this unit was last written under." A screenplay is sequential: a scene built at Step 7
  was very plausibly written assuming whatever was true at Step 3 still holds. This is a real,
  already-persisted ordering with no fabrication involved, and — unlike `canonRefs` — it applies
  identically to **both** trigger kinds (`unit_regression` has no `contradictedRef` to search by,
  but every affected unit always has a `stepNumber`). This is the one new tracing axis this
  design adds.

## Decision: cascade-tracing scope for issue #72

Cascade tracing is extended along exactly two axes beyond what #64 already ships, both backed by
real, already-persisted data — no new cross-project graph is fabricated for P1 or P2:

1. **Structural downstream (NEW, both trigger kinds).** For the unit that was just regressed or
   whose contradiction was just accepted, find every other P4 unit whose `stepNumber` is strictly
   greater (i.e. built at a later structural step) than the affected unit's `stepNumber`. Skipped
   entirely when the affected unit's `stepNumber` is `null` (nothing to compare against — a unit
   never tagged to a step has no defined position to be "downstream" of). This runs for
   `unit_regression` (closing gap 1 above entirely) and for `canon_contradiction` (added
   alongside the existing same-ref-citer scan).
2. **Cross-project dependents (UNCHANGED from #64).** Still only for a Project-3-sourced
   `canon_contradiction`, still via `canonEngine/canonStore.ts`'s existing `listDependents`
   against `WORLD_ELEMENTS_COLLECTION`, filtered to `Confirmed`. Project 1 and Project 2 sources
   get no equivalent, per the Research section above — this is a deliberate, investigated "no,"
   not an oversight.

Both axes are **one-hop** (direct citers / direct step-later units / direct `depends_on`
entries), matching every existing cascade-review implementation in this codebase
(`worldEngine/conflictResolution.ts`'s `computeCascadeReview`, `world-chat/canon-status/route.ts`'s
Dependency Review gate, #64's own P3-dependents scan) — none of them walk a transitive closure.
A transitive multi-hop walk is **out of scope**: it has no precedent anywhere in this codebase,
risks combinatorial blow-up on a large screenplay, and the author already gets to re-run the
Canon Revision Path's review iteratively as they work through flagged units, which is how every
other cascade in this app already expects the author to use it.

Results from both axes are merged and de-duplicated by unit/element id (a unit can legitimately
appear in both the same-ref-citer scan and the structural-downstream scan; it is reported once).

This is still **read-only discovery, never a write** into P1/P2/P3's own canon, and never a write
into other P4 units beyond their existing content — identical to #64's own constraint. Nothing
here mutates a flagged unit's status or content; it only surfaces it for the author's attention,
exactly like #64's existing P3-dependents list already does.

## Decision: the Dependency & Continuity Ledger

The issue's second half ("every `Confirmed` state transition and every Canon Revision decision is
timestamped and logged ... queryable/viewable by the author") is a distinct deliverable from
`p4CanonRevisionLog` — that collection only ever captures Canon-Revision-Path *resolutions*, never
an ordinary `Confirmed` transition reached through everyday turn processing (the common case —
most units become `Confirmed` without ever triggering a conflict). Rather than overload
`p4CanonRevisionLog`'s existing shape (and risk colliding with issue #159's in-flight reader work
on that exact collection, per this issue's own brief), this adds a **new, additive** subcollection
that is a superset of what the author needs to see in one place:

- New Firestore subcollection `p4ContinuityLedger` (sibling to `p4CanonRevisionLog`,
  `p3ConflictLog`, etc.), one entry per event, two kinds:
  - `"confirmed_transition"` — written the moment ordinary turn processing (not the Canon
    Revision Path) accepts a unit's transition **into** `Confirmed` for the first time (i.e. the
    unit's status immediately before this turn was not already `Confirmed` — re-reporting an
    already-Confirmed unit's content on a later turn, which issue #64's regression guard
    channels through the Canon Revision Path anyway, never produces a duplicate entry here).
  - `"canon_revision"` — written every time `resolveP4Conflict` resolves a conflict (all three
    resolutions: `revert`/`park`/`accept_and_update`, mirroring `appendP4CanonRevisionLog`'s own
    "every path appends one entry" rule), carrying the resolution choice and — new — the merged
    cascade-review result computed above, so the ledger itself records *what was flagged*, not
    just *that something was decided*. When `accept_and_update` additionally lands the unit on
    `Confirmed` (either directly, or after #64's existing gates-not-passed clamp leaves it at
    `Working` instead), a **separate** `"confirmed_transition"` entry is also appended for that
    same turn — the two facts ("a Canon Revision was accepted" and "a unit became Confirmed") are
    both independently true and both independently within this issue's AC wording, so both get
    their own entry rather than overloading one entry with two unrelated semantics.
- `appendP4ContinuityLedgerEntry` / `listP4ContinuityLedger` in `storyStore.ts`, mirroring
  `appendP3ConflictLog`/`listP3ConflictLog`'s existing shape exactly (`orderBy("ts", "asc")`).
- Every entry carries `unitId`, `description` (plain-language "what changed"), `resolvedBy` (uid —
  "who"), `ts` (ISO string — "when"), and `turnId`, satisfying the AC's explicit "who/when/what
  changed" wording for every entry, of either kind.
- Best-effort, non-blocking writes: both append call sites wrap the ledger write in the same
  "log a `console.warn`, never fail the turn" pattern `deferred_items` persistence already uses
  in `architecture-chat/route.ts` — a ledger-write failure must never 500 an otherwise-successful
  chat turn.

### Queryable/viewable by the author

No existing GET reader exists for any P4-side log today (`p4CanonRevisionLog` included — that's
exactly issue #159's own gap, independently tracked). Per this issue's own instruction to make the
smaller, UI-consistent choice rather than stall on an open design question: a **panel in the
existing `/story-architecture` screen**, following `WorldSidePanel.tsx`'s already-proven shape
exactly (a `"use client"` component that fetches from one new GET route keyed by `storyId`, scoped
to the Firestore-backed facts an author needs to review, rendered as a plain list with no new
page/route/nav entry):

- New GET route `web/src/app/api/architecture-chat/ledger/route.ts` — `requireUser` +
  `getMembership` + `storyId` query param, same shape as `world-chat/entries/route.ts`'s GET
  handler; returns `{ entries: P4ContinuityLedgerEntry[] }` from `listP4ContinuityLedger`.
- New component `web/src/components/ArchitectureLedgerPanel.tsx`, mounted inside
  `ArchitectureInterview.tsx`'s scrollable content area (same mount point style
  `WorldInterview.tsx` uses for `WorldSidePanel`), refetching on a `refreshToken` prop bumped by
  `messages.length` (same convention `WorldSidePanel` already uses) so a fresh ledger entry from
  the turn that just completed shows up without a manual refresh, plus a manual Refresh button for
  parity with `WorldSidePanel`.
- This panel is additive to, and does not replace, the existing inline `pendingConflict`/
  `cascadeReview` banners in `ArchitectureInterview.tsx` — those remain the in-the-moment
  "something needs your decision right now" UI; the new panel is the durable, scrollable-back
  history of everything already decided.
- If issue #159 lands a reader for `p4CanonRevisionLog` concurrently in another worktree, that is
  a separate, narrower view of a subset of what this panel already shows (Canon Revision
  decisions only, no cascade detail, no `Confirmed`-transition entries) — no functional collision,
  only a possible later consolidation left for a follow-up, exactly as this issue's brief
  anticipated ("don't worry about colliding ... your PR will rebase naturally").

## What's out of scope (and why)

- **Transitive (multi-hop) cascade walks.** No existing cascade implementation in this codebase
  does this; see "Decision: cascade-tracing scope" above.
- **A cross-project dependency graph for Project 1 or Project 2.** Investigated and rejected for
  concrete, cited reasons above (P1: no id scheme exists at all; P2: the id scheme that exists
  doesn't match the ref format the model is told to report) — not an oversight.
- **Any write into P1/P2/P3's own canon stores**, or into another P4 unit beyond its own existing
  content. Cascade tracing/flagging stays strictly read-only discovery + logging, identical to
  #64's own already-established constraint.
- **Consolidating with issue #159's `p4CanonRevisionLog` reader**, if/when it lands. Both logs
  continue to coexist; a later follow-up can decide whether to merge the two panels once #159's
  shape is known. Flagged explicitly rather than silently duplicated effort.
- **Retroactively backfilling ledger entries for `Confirmed` transitions that happened before this
  ships.** The ledger is forward-looking only, same as every other log/history collection in this
  codebase (e.g. `p3ConflictLog`, `characterConflictsLog`) — none of them backfill pre-existing
  state either.

## Files touched

- Modify: `web/src/lib/canonEngine/storyStore.ts` (`P4ContinuityLedgerEntry` type,
  `appendP4ContinuityLedgerEntry`, `listP4ContinuityLedger`)
- Modify: `web/src/lib/storyArchitectureEngine/canonRevision.ts` (structural-downstream cascade
  helper, extended `resolveP4Conflict` cascade computation for both trigger kinds, ledger-entry
  writes alongside the existing `appendP4CanonRevisionLog` call)
- Modify: `web/src/app/api/architecture-chat/route.ts` (ledger-entry write on an ordinary
  `Confirmed` transition, best-effort/non-blocking per the existing `deferred_items` pattern)
- Create: `web/src/app/api/architecture-chat/ledger/route.ts` (GET reader)
- Create: `web/src/components/ArchitectureLedgerPanel.tsx`
- Modify: `web/src/components/ArchitectureInterview.tsx` (mounts the new panel)

## Testing

Vitest unit tests (this repo now has a real suite, unlike #64's era):

- `canonRevision.test.ts` — extend with coverage for: structural-downstream cascade computed for
  `unit_regression` (previously always `null`); structural-downstream merged with the existing
  same-ref-citer scan for `canon_contradiction`, de-duplicated; `stepNumber: null` on the affected
  unit skips structural-downstream entirely; ledger entries appended for all three resolutions,
  including a `"confirmed_transition"` entry only when `accept_and_update` actually lands on
  `Confirmed`.
- `storyStore.ts` has no existing test file (it's a thin Firestore wrapper, same as
  `appendP4CanonRevisionLog`/`appendP3ConflictLog`, which also have none) — not adding one here
  either, consistent with that precedent; the new append/list functions are exercised indirectly
  through `canonRevision.test.ts`'s mocks.
- Manual/API-route-level verification (no live-model test, matching #64's own disclosed
  limitation) via `tsc --noEmit`, `npm run lint`, `npm run build`.
