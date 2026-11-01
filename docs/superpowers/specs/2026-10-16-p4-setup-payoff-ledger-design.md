# P4 Setup & Payoff Ledger — Design Spec

GitHub issue: #173 ("[P4] No issue owns Setup & Payoff Ledger tracking")

## Problem

`compileArchitectureDocument.ts`'s Section 6 ("Setup & Payoff Ledger") has rendered a disclosed
placeholder (`NOT_TRACKED_LEDGER`) since issue #70, because no data model anywhere in the app
tracks planted setups and their target payoff scenes. This issue owns building that data model
and wiring Section 6 to real data, per the issue's own three-part AC: (1) how a setup/payoff pair
is identified, (2) where it's stored, (3) how it's surfaced during development, not just at
compile time.

## Research: the nearest precedent already in this codebase

Issue #66's `[CRITICAL BEAT: X]` tag convention is the closest existing analog — an author-typed
marker inside a `StructuralUnit.content` string, parsed deterministically by regex
(`developmentLoop.ts`'s `CRITICAL_BEAT_TAG_PATTERN`/`parseSceneRegisterEntry`), with no separate
Firestore field or LLM-schema field. Section 5 (Critical Beat Earmark Index, issue #165) already
proves this pattern scales cleanly from "tag in content" to "compiled index."

**Why Setup/Payoff can mirror the tagging mechanism but not the validation mechanism:** Critical
Beats are a *closed, framework-defined set of exactly 10* (`CRITICAL_BEAT_LOOKUP`), so
`checkSceneRegisterFormat` can hard-validate a tag's value against that lookup at write time
(reject an unrecognized tag name outright). Setups and payoffs have no such closed catalog — they
are entirely story-specific and author-invented ("the gun on the mantel," "her mother's ring"),
open-ended in both name and count. There is nothing to validate a name *against*. This is the
same class of distinction this codebase already draws elsewhere (`checkPlacementDeviation`'s
"loose guardrail, flagged, never blocked" vs. `attemptStatusTransition`'s hard gate) — a tag with
no fixed catalog to check against gets advisory tracking, not a hard format gate.

## Design

### 1. How a setup/payoff pair is identified: author-tagged, free-text name, same tag syntax as Critical Beats

Two new tags, parallel to `[CRITICAL BEAT: X]`, written directly in a unit's `content` string by
the author (via the live chat agent, same as every other in-content marker this app has):

```
[SETUP: <name>]   — marks this unit as planting a setup named <name>
[PAYOFF: <name>]  — marks this unit as paying off the setup named <name>
```

`<name>` is free text (not drawn from a fixed lookup, per the research above). Matching across
tags is **case-insensitive, trimmed** (`"the Gun"` and `"THE GUN"` refer to the same ledger
entry), but the *first-seen* casing is kept for display — the same "normalize for matching,
preserve for display" shape `parseSceneRegisterEntry` already uses for `criticalBeatTags`
(collected uppercase for lookup) vs. `slugline` (kept as-authored).

A unit's content may carry zero, one, or several `[SETUP: ...]`/`[PAYOFF: ...]` tags — a single
scene can both pay off an earlier setup and plant a new one. No per-scene requirement exists (same
posture as Critical Beat tags: the app has no reliable way to know a given scene *should* carry
one).

**Deliberately not hard-gated.** Unlike `checkSceneRegisterFormat`'s Critical Beat validation,
`[SETUP: ...]`/`[PAYOFF: ...]` tags are never checked against `attemptStatusTransition` or any
Working/Confirmed gate. Two reasons: (a) no fixed catalog exists to validate a name against (see
Research above), and (b) unlike a Critical Beat (which belongs to exactly one scene, decidable the
moment that scene is written), a setup's payoff is *expected* to remain unresolved for most of
development — a setup planted in Act 1 might not pay off until Act 3, scenes away and sessions
later. "Unresolved so far" is normal mid-development state, not an error, so this is advisory
tracking (mirrors `sceneDensity.ts`'s "strictly advisory, never gates a transition" posture), not
a blocking check (mirrors `preCompilationAudit.ts`'s gated-with-override posture, which is the
wrong fit here since there's no natural "done" moment before compile where every setup *should*
already be paid off either — some may legitimately span into a sequel, a deliberate dangling
thread, etc.; the ledger's job is to surface this for the author's own judgment, never to block).

### 2. Where it's stored: nowhere new — derived from `StructuralUnit.content`, same as Critical Beats

No new Firestore field, no new LLM turn-schema field. The tags live in the exact same
`Story.p4Units[].content` strings that already store Critical Beat tags, sluglines, and
paragraphs. This follows the codebase's own "no fabrication / single source of truth" rule
(`compileArchitectureDocument.ts`'s own header comment) — a parallel `setupPayoffs: {...}[]` array
on `StructuralUnit` would create a second place this same fact could live, which could drift from
the content string's own tags the moment one was edited without the other. The ledger is always
*computed*, never independently persisted.

New pure module, `web/src/lib/storyArchitectureEngine/setupPayoffLedger.ts` (mirrors
`sceneDensity.ts`'s own "standalone single-concern module, pure functions over `StructuralUnit[]`"
shape, rather than piling into `developmentLoop.ts`, which is scoped to *turn-level* deterministic
checks, or `compileArchitectureDocument.ts`, which is scoped to compiling the final document):

```ts
export const SETUP_TAG_PATTERN = /\[SETUP:\s*([^\]]+)\]/gi;
export const PAYOFF_TAG_PATTERN = /\[PAYOFF:\s*([^\]]+)\]/gi;

export interface ParsedSetupPayoffTags {
  setupNames: string[];
  payoffNames: string[];
}

/** Extracts every [SETUP: name] / [PAYOFF: name] tag from one unit's
 * content, trimmed, original casing preserved, de-duplicated within
 * this single unit. Never throws - absence of either tag type is the
 * normal case for most scenes. */
export function parseSetupPayoffTags(content: string): ParsedSetupPayoffTags;

export interface SetupPayoffLedgerLocation {
  unitId: string;
  sceneNumber: number | null;
  slugline: string | null;
}

export interface SetupPayoffLedgerEntry {
  name: string; // first-seen casing
  planted: SetupPayoffLedgerLocation | null; // null = orphaned payoff (paid off, never planted)
  paidOff: SetupPayoffLedgerLocation | null; // null = dangling setup (planted, not yet paid off)
}

export interface SetupPayoffSourceEntry {
  unitId: string;
  content: string;
  sceneNumber?: number | null; // omit/null pre-compile, when no Scene Register ordering exists yet
  slugline?: string | null;
}

/** Builds the ledger from an ORDERED list of entries (ledger order =
 * input order - the caller decides what "order" means: Section 4's
 * Confirmed-only scene order at compile time, or plain ledger-array
 * order during development). Groups by case-insensitive, trimmed name;
 * for each distinct name, `planted` is the FIRST entry carrying a
 * [SETUP: name] tag and `paidOff` is the FIRST entry carrying a
 * [PAYOFF: name] tag for that same name - "first occurrence wins" is
 * the same disclosed simplification parseSceneRegisterEntry's own
 * criticalBeatTag (singular) already uses; a setup re-planted or paid
 * off more than once is a known, disclosed limitation (not silently
 * wrong - see "Out of scope" below), not a crash or a fabricated
 * resolution. Entries are returned in order of each name's first
 * appearance (planted or paid off, whichever comes first). */
export function buildSetupPayoffLedger(entries: SetupPayoffSourceEntry[]): SetupPayoffLedgerEntry[];

export interface SetupPayoffAdvisory {
  danglingSetups: string[]; // planted, no payoff yet - the normal mid-development state
  orphanedPayoffs: string[]; // paid off, but no [SETUP: name] tag exists anywhere - likely a real continuity slip
}

/** Pure derived summary for development-time surfacing - see §3. */
export function summarizeSetupPayoffAdvisory(ledger: SetupPayoffLedgerEntry[]): SetupPayoffAdvisory;
```

### 3. How it's surfaced during development, not just at compile time

Mirrors `sceneDensity.ts`'s exact wiring shape (a pure function computed fresh from `units` on
every turn and on every resume, returned as a sibling field on the API response, rendered as a
banner) — **without** that module's dismissal-persistence machinery, because nothing here needs
dismissing: a dangling setup is expected, normal, ongoing state for most of development (unlike a
pacing alert, which the author actively dismisses once they've seen and judged it once);
re-showing it every turn costs nothing and risks nothing.

- `architecture-chat/route.ts`: after `units` reaches its final state for the turn (same point
  `sceneDensityReading` is already computed, right before the response is built), compute
  `buildSetupPayoffLedger` over **Working + Confirmed** units (matching `sceneDensity.ts`'s own
  `counted` set — a Working scene's tags are real author intent worth surfacing early, not just
  Confirmed ones) with `sceneNumber`/`slugline` omitted (no Scene Register ordering exists before
  compile), then `summarizeSetupPayoffAdvisory`. Returned as a new top-level response field,
  `setupPayoffAdvisory: SetupPayoffAdvisory`.
- `workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (GET, resume): same computation from
  `story.p4Units ?? []`, returned as a sibling of the existing `sceneDensity` field, so a page
  reload shows the current advisory without waiting for the next chat turn (mirrors that route's
  own already-established `sceneDensity` precedent exactly).
- `ArchitectureInterview.tsx`: one new banner, styled like the existing `cascadeReview` banner
  (informational list, not a validation-failure color), rendered whenever either list is
  non-empty: dangling setups framed as "planted, not yet paid off" and orphaned payoffs framed as
  "paid off, but never planted — check for a missing `[SETUP: ...]` tag or a typo in the name."
  No dismiss button (see above - nothing to dismiss).

### 4. Section 6 at compile time: cross-referenced from Section 4, same invariant as Section 5

`compileArchitectureDocument.ts`'s own Section 4/5 invariant ("Section 5 cannot name a scene
Section 4 doesn't contain," enforced by resolving Section 5's entries from the already-built
`sceneRegister` array, never re-deriving unit data independently) extends identically to Section
6: build the ledger from the *same* `parsedEntries`/`sceneRegister` arrays Section 4 and 5 already
build (Confirmed units only, in Scene Register order), via `buildSetupPayoffLedger`, passing each
Confirmed unit's real `sceneNumber`/`slugline` already resolved by Section 4. Section 6 can now
never name a scene Section 4 doesn't contain either.

`ScreenplayArchitectureDocument["6_setup_payoff_ledger"]` changes from `string` to:

```ts
"6_setup_payoff_ledger": {
  setup_name: string;
  planted: { unit_id: string; scene_number: number; slugline: string } | null;
  paid_off: { unit_id: string; scene_number: number; slugline: string } | null;
}[];
```

An empty array (no `[SETUP: ...]`/`[PAYOFF: ...]` tags anywhere in the Confirmed set) is a real,
honest answer — "no setups/payoffs tagged yet" — not a placeholder; this is exactly the same
"empty list is real data, not a gap" posture Section 4 already has for zero Confirmed units.

Markdown/docx/PDF renderers: a table, mirroring Section 5's own table shape exactly (`Setup Name |
Planted (Scene #, Slugline) | Paid Off (Scene #, Slugline)`, with "— (dangling)" / "— (orphaned)"
for a null side, matching the "—" convention issue #175 just unified across all three renderers).

### 5. Out of scope (disclosed, not oversight)

- **Multiple plants/payoffs of the same name** (a setup re-planted, or paid off more than once —
  e.g. a red-herring payoff followed by a real one). "First occurrence wins" for both `planted`
  and `paidOff`, same disclosed-limitation class as `parsePlacementPercent`'s regex extraction and
  `countSentences`'s sentence-splitting. A future issue could extend the ledger to a list of
  occurrences per name if this proves to matter in practice.
- **Fuzzy/typo-tolerant name matching.** `"the gun"` and `"the Gun on the mantel"` are different
  names under exact (post-trim, post-casefold) matching — exactly why the development-time
  "orphaned payoff" advisory exists: a typo'd payoff name surfaces immediately as orphaned rather
  than silently failing to match. No fuzzy matching is attempted (would risk false-positive pairs,
  worse than a visible orphan).
- **Hard gating / blocking compile.** Explicitly rejected in §1 above — unresolved setups are
  normal mid-development state, and this issue's AC never asks for a gate (unlike #65's/#91's
  audits, which this issue does not extend or touch).
- **A dedicated chat-visible slash-command or UI to list/browse the full ledger pre-compile** —
  the advisory banner (§3) surfaces *that something needs attention*; browsing the full table is
  already available via Compile, matching issue #71's own "partial compile" territory, not this
  issue's.

## Files touched

- Create: `web/src/lib/storyArchitectureEngine/setupPayoffLedger.ts` (tag patterns, parsing,
  ledger builder, advisory summarizer)
- Modify: `web/src/lib/canonEngine/storyStore.ts` (`ScreenplayArchitectureDocument["6_setup_payoff_ledger"]`
  type: `string` → typed array)
- Modify: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts` (Section 6 built
  from `parsedEntries`/`sceneRegister`, replacing `NOT_TRACKED_LEDGER`; markdown table)
- Modify: `web/src/lib/docx/screenplayArchitectureDocx.ts` (Section 6 table)
- Modify: `web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx` (Section 6 table)
- Modify: `web/src/app/api/architecture-chat/route.ts` (per-turn `setupPayoffAdvisory` field)
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (resume-time
  `setupPayoffAdvisory` field)
- Modify: `web/src/components/ArchitectureInterview.tsx` (advisory banner)

## Testing

Follows this suite's own established convention (`compileArchitectureDocument.test.ts`,
`preCompilationAudit.test.ts`): direct unit tests for `setupPayoffLedger.ts`'s pure functions
(parsing, pairing by name across units, dangling/orphaned classification, case-insensitive
matching, first-occurrence-wins for duplicates), plus a `compileArchitectureDocumentJson` test
proving the Section 4/6 cross-reference invariant the same way the existing Section 4/5 test
already does. `npm run lint`, `npm run build`, `npm run test` before considering this done.
