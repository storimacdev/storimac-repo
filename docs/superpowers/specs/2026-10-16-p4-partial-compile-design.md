# P4 Partial/Incremental Compilation — Design Spec

GitHub issue: #71 ("[P4] Support partial/incremental compilation")
PRD refs: §7.8 FR-8.5, §11 test case 5.

Depends on the document shape from issues #165/#173 being stable (both already shipped/merged
conceptually ahead of this issue, per the task's own ordering) - this spec builds directly on
`compileArchitectureDocument.ts`'s current 7-section `ScreenplayArchitectureDocument` and
`screenplayArchitectureCompiler.ts`'s existing versioning orchestration.

## Problem

Today, compiling the Screenplay Architecture Document always means the WHOLE document -
`generateScreenplayArchitectureDocument(storyId)` has no concept of "just Act 1." An author
partway through the outline, wanting a readable snapshot of one Act to review or share, has no
option except waiting until the entire screenplay satisfies the Pre-Compilation Audit (75-150
Confirmed scenes, all 10 Critical Beats tagged) - which may be sessions away.

## Research: what "test case 5" is actually asking for, separated from what already exists

Issue #71's AC's own test case ("3 Working-status scenes remaining -> lists them under Outstanding
Decisions, excludes them from Scene Register") is **already true of the existing full compiler** -
`compileScreenplayArchitectureDocumentJson` has always built Section 4 from `getConfirmedUnits`
only and Section 7's `outstanding` from every non-`Confirmed` unit, full compile or not. This test
case is not new work; it's confirming the existing invariant also holds for whatever subset of
units a partial compile operates over. The two AC bullets that ARE new work:

1. "Author can request compilation of a named subset (e.g. a single Act)."
2. "Partial compiles are versioned as drafts, not treated as final canon."

## Design

### 1. What a "named subset" means: one of the 4 framework Acts

`structuralFramework.ts`'s `STRUCTURAL_ACTS` (`ActId = "1" | "2A" | "2B" | "3"`, each with a fixed
`stepNumbers` array) is the only existing concept of a named structural subset in this codebase -
the same constant Section 3 of the compiled document already renders. A `StructuralUnit`'s own
`stepNumber` field (issue #56, set on every content upsert) is what lets a unit be attributed to
an Act at all. **Scoping rule:** a unit belongs to a requested Act if `unit.stepNumber !== null &&
act.stepNumbers.includes(unit.stepNumber)`. A unit with `stepNumber: null` (never yet tagged to a
step) is excluded from every Act-scoped partial compile - a disclosed limitation, not a silent
wrong answer (same class as `sceneDensity.ts`'s own "roughly uniform density" disclosed
approximation): there is no other signal to attribute it.

No other "named subset" shape is in scope here (e.g. an arbitrary unit-id list, or a step-level
subset) - the issue's own example ("just Act 1") and PRD test case both describe Act-level
granularity, and the framework's only existing named-subset concept is the Act. A future issue
could extend `scope` to other kinds without touching this one's shape (see §6, out of scope).

### 2. The compiler itself stays scope-agnostic; the ORCHESTRATOR owns scoping

`compileScreenplayArchitectureDocumentJson` already takes `units: StructuralUnit[]` as a plain
parameter (not a fetch) - partial compilation needs no new filtering logic INSIDE that pure
function. The caller (a new orchestrator, §4) pre-filters `units` to the requested Act before
calling it, exactly the same "caller owns what's in scope" shape issue #174 already established
for the full compiler. Four new, independently-defaulted parameters are added so a draft can be
visually distinguished without changing the full-compile call sites at all:

```ts
export interface CompileScreenplayArchitectureDocumentParams {
  // ...unchanged existing fields...
  status?: "Compiled" | "Draft"; // default "Compiled"
  scopeLabel?: string | null; // default null
  versionLabel?: string; // default `v${version}`
  actScope?: ActId | null; // default null - when set, Section 3 shows only this Act
}
```

`ScreenplayArchitectureDocument["1_screenplay_metadata"]` gains two fields: `status` widens from
the `"Compiled"` literal to `"Compiled" | "Draft"`, and a new `scope: string | null` field (null
for every full compile - unaffected, same as today).

Section 5 (Critical Beat Earmark Index) and Section 6 (Setup & Payoff Ledger) are built from
whatever `units` the caller passed in, same as today - for an Act-scoped draft this means they
will show gaps for beats/setups outside that Act. **This is correct, not a bug**: a draft
explicitly isn't claiming document-wide completeness (see §3's framing below), so an incomplete
Earmark Index or a Setup/Payoff pair that looks "dangling" only because its payoff lives in a
different, not-yet-drafted Act is an honest reflection of a partial view, not a fabricated gap.

### 3. Versioned as drafts, not final canon: a fully separate storage path and counter

"Not treated as final canon" is read literally: drafts never touch `p4ArchitectureVersions` (the
full-document version history `screenplayArchitectureCompiler.ts` already owns) or its version
counter. A sibling path, scoped per-Act, keeps its own independent counter:

```
stories/{storyId}/p4ArchitectureDrafts/{scopeKey}/items/{draftVersion}
```

where `scopeKey` is `` `act-${actId}` `` (e.g. `"act-1"`, `"act-2A"`). This nested-subcollection
shape (rather than a flat collection filtered by a `scopeKey` field) means listing/getting a
scope's own draft history is a plain single-field `orderBy("draftVersion")` query, needing no
composite Firestore index - a real operational cost a flat-collection-plus-`where` design would
have incurred.

```ts
export interface ScreenplayArchitectureDraftScope {
  type: "act";
  act_id: ActId;
}

export interface StoredScreenplayArchitectureDraft {
  draftId: string; // `${scopeKey}-${draftVersion}`
  scopeKey: string; // `act-${actId}` - also the Firestore path segment
  scope: ScreenplayArchitectureDraftScope;
  draftVersion: number; // increments independently PER SCOPE - act-1's and act-2A's own drafts never share a counter
  date: string;
  summaryOfChanges: string;
  json: ScreenplayArchitectureDocument;
  markdown: string;
  unitsSnapshot: Record<string, { status: string; content: unknown }>; // scoped units only - same "snapshot everything in scope" shape StoredScreenplayArchitectureVersion already has
  createdAt: string;
}
```

Each Act gets its own independent `draftVersion` sequence (drafting Act 1 five times never
advances Act 2A's counter) - matching "a named subset" being a genuinely separate, repeatable
draft-and-revise loop per Act, not one shared draft timeline. A draft's own Section 7 version
history is built the same way the full compiler already builds its own (via a shared, exported
`diffUnitsSnapshot` helper - renamed/exported from `screenplayArchitectureCompiler.ts`'s existing
private `diffSummary`, reused verbatim rather than duplicated) but strictly within that scope's own
prior drafts, never mixed with the full document's `p4ArchitectureVersions` history - a draft
timeline and the canon timeline are deliberately parallel, never interleaved.

`screenplay_architecture_version` in a draft's own Section 1 metadata reads `` `draft-v${n}` ``
(via the new `versionLabel` override, §2) - visually unmistakable from a real `v{n}` canon
version, so a draft markdown/JSON export can never be confused for a canon one even if
downloaded and read in isolation, without the surrounding UI's "Draft" framing.

### 4. New orchestrator: `generatePartialScreenplayArchitectureDraft`

New function in `screenplayArchitectureCompiler.ts` (same file - this is a sibling orchestration
entry point over the same compiler, not a separate concern):

```ts
export interface GeneratePartialScreenplayArchitectureDraftParams {
  storyId: string;
  units: StructuralUnit[]; // the FULL, unfiltered snapshot - same "caller already fetched it" convention issue #174 established; this function does the Act-filtering itself
  actId: ActId;
}

export async function generatePartialScreenplayArchitectureDraft(
  params: GeneratePartialScreenplayArchitectureDraftParams
): Promise<StoredScreenplayArchitectureDraft>
```

Looks up `actId` in `STRUCTURAL_ACTS` (throws a plain `Error` on an unknown id - the route, §5,
is what actually validates the request body before this is ever called, so this is a defensive
backstop, not the primary validation surface). Filters `units` per §1's rule. Fetches canon
(`ingestCanon`, same as the full compiler - P1-3 canon isn't Act-scoped, so no filtering needed
there) and this scope's own latest prior draft in parallel. Computes `draftVersion`, the
`unitsSnapshot`, and `summaryOfChanges` the same way the full compiler does (shared
`diffUnitsSnapshot` helper). Calls `compileScreenplayArchitectureDocumentJson` with `status:
"Draft"`, `scopeLabel` (a human-readable sentence naming the Act and disclosing draft status),
`versionLabel: `draft-v${draftVersion}``, and `actScope: actId`. Persists via a new
`saveScreenplayArchitectureDraft` and returns the stored draft.

### 5. New route: a sibling, not an overload of the existing compile route

`POST /api/architecture-chat/document/draft` (new file, sibling to the existing
`architecture-chat/document/route.ts`), body `{ storyId: string, actId: "1" | "2A" | "2B" | "3" }`.
Auth/membership checks identical to the existing compile route. 400 on a missing/invalid `actId`
(validated against `STRUCTURAL_ACTS` directly, not duplicated as a literal union check).

**Deliberately skips the Pre-Compilation Audit and Thematic Anchor Audit entirely - no 409/
`acknowledged` gate.** This is the one place this issue asks for a judgment call beyond directly
copying an existing pattern, resolved as follows: both audits exist specifically to protect
*final-canon* integrity before the whole document is treated as done (`checkScale`'s 75-150
target assumes the WHOLE screenplay; `checkEarmark`'s "all 10 tags" assumes the WHOLE Confirmed
set). Neither question is well-formed for "just Act 1" - a single Act legitimately has far fewer
than 75 scenes and will almost certainly be missing most of the 10 Critical Beats (most beats
belong to other Acts entirely, per `CRITICAL_BEAT_LOOKUP`'s own per-step attribution). Gating a
draft on checks that assume document-wide completeness would make "compile a subset before it's
done" - this issue's entire point - impossible by construction. The issue's own AC ("versioned as
drafts, not final canon") already establishes that a draft is explicitly NOT the thing those audits
protect. `checkSceneRegisterFormat`'s per-scene formatting is still enforced at write time
(unchanged, same as always) - only the WHOLE-DOCUMENT-shaped checks are skipped, and only for this
explicitly-marked-as-draft path.

Response mirrors the full compile route's shape with draft-specific field names:
```ts
{
  draftId: string;
  scopeKey: string;
  scope: ScreenplayArchitectureDraftScope;
  draftVersion: number;
  date: string;
  summary_of_changes: string;
  markdown: string;
  json: ScreenplayArchitectureDocument;
  outstandingCount: number; // same derivation as the full route's own field
}
```

### 6. UI: a second, clearly-labeled compile action

`ArchitectureInterview.tsx` gains an Act `<select>` (the 4 `STRUCTURAL_ACTS`, by name) and a
"Compile Draft" button beside the existing "Compile" button. The result renders in its own panel,
visually distinct from the final-compile success banner (a different border/background color,
same differentiation convention every other banner in this file already uses to separate concerns
- e.g. rose for a blocking gap, purple for a successful full compile), headed "Draft - Act {id}
({name}) - not final canon," with its own "Download .md" button (`downloadText`, identical
mechanism to the full compile's). No `.json`/`.docx`/`.pdf` export for drafts (see §7 - YAGNI,
not oversight).

### 7. Deliberately out of scope (disclosed, not oversight)

- **docx/PDF export for drafts.** The full compile already has all four formats; a draft - by
  definition non-final, likely to be re-compiled repeatedly as the Act develops - doesn't carry
  the same "share a polished file" need the full canon export does. `.md`/`.json` (available via
  the same JSON object the UI already holds) cover "read it" and "feed it to another tool";
  extending the docx/PDF generators to accept a draft is mechanical and can be added later with no
  retrofit cost if it turns out to matter.
- **A non-Act "named subset"** (arbitrary unit-id list, single-step scope, etc.) - see §1. The
  Act-level `ActId`-based `scope` shape could extend to a discriminated union later
  (`{type: "act", act_id}` already anticipates more variants) without a breaking change.
- **Promoting/merging a draft into the full canon document.** Nothing in the issue's AC asks a
  draft to ever become, or feed into, a real `p4ArchitectureVersions` entry - an author who wants
  the real thing still uses the existing full "Compile" action once ready. Keeping the two
  timelines genuinely separate (§3) is what makes this safe to skip rather than a deferred need.
- **Gating/warning when a draft is requested for an Act with zero units tagged to it at all.**
  `compileScreenplayArchitectureDocumentJson` already degrades honestly to an empty Scene Register
  ("_No units are Confirmed yet._") - the exact same message a brand-new full compile would show -
  so this needs no new handling.

## Files touched

- Modify: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts` (`status`,
  `scopeLabel`, `versionLabel`, `actScope` params; Section 1/3 wiring; markdown renders `scope`
  when present)
- Modify: `web/src/lib/canonEngine/storyStore.ts` (`ScreenplayArchitectureDocument["1_screenplay_metadata"]`
  type; new `StoredScreenplayArchitectureDraft`/`ScreenplayArchitectureDraftScope` types; new
  `listScreenplayArchitectureDrafts`/`getLatestScreenplayArchitectureDraft`/
  `saveScreenplayArchitectureDraft` functions)
- Modify: `web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.ts` (export
  `diffUnitsSnapshot` - renamed from the existing private `diffSummary`, reused verbatim; new
  `generatePartialScreenplayArchitectureDraft`)
- Create: `web/src/app/api/architecture-chat/document/draft/route.ts`
- Modify: `web/src/components/ArchitectureInterview.tsx` (Act selector, "Compile Draft" button,
  draft result panel)

## Testing

Follows this suite's own established convention. New/extended unit tests:
- `compileArchitectureDocument.test.ts`: `status`/`scopeLabel`/`actScope` default to today's exact
  full-compile behavior when omitted (regression safety); a `Draft` status and non-null `scope`
  render correctly in both JSON and markdown; `actScope` filters Section 3 to one Act.
- New `screenplayArchitectureCompiler.test.ts` additions (or the file created by issue #174, if
  that lands first): `generatePartialScreenplayArchitectureDraft` filters units to the requested
  Act's `stepNumbers` (a Confirmed unit with a different/null `stepNumber` is excluded even though
  it's Confirmed); `draftVersion` increments independently per `scopeKey` (drafting Act 1 twice
  then Act 2A once: Act 1 reads `draftVersion: 2`, Act 2A reads `draftVersion: 1`); throws on an
  unknown `actId`.
- `npm run lint`, `npm run build`, `npm run test` before considering this done. The new route has
  no dedicated test file, matching this codebase's own established precedent for route handlers
  (verified via `tsc`/lint/build plus direct code trace, e.g. issue #91's plan).
