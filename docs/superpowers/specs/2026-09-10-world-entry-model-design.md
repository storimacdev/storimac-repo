# Universal World Entry Model + Importance/Depth Matrix (Issues #42, #44) — Design

## Problem

PRD §4.6/§8.2 (issue #42) requires a structured "World Entry" record
type for standalone world assets (Locations, Cultures, Organizations,
Systems, Objects) — Name & Category, Narrative Role & Importance/Depth,
Functional Description, Systemic Relationships (cross-references),
Governing Rules & Constraints, Outstanding Questions — with real
create/read/update operations tied to the Canon Registry state machine,
not free text. PRD §4.2 (issue #44) requires the Importance × Depth
pairing to be an enforced soft-warning check, not just descriptive
guidance, surfaced at the point of entry creation/edit.

Confirmed by codebase survey: nothing past issue #41 exists for Project
3 today. `worldElements` currently holds only one record per adopted
pillar, tracking status alone (no Name/Category/Importance/Depth/etc.)
— `canon-status/route.ts` even hard-validates `elementId` against
`/^pillar-[a-z0-9-]+$/`, so it structurally cannot hold anything else
today. sp03 §7's Universal World Entry Model is prompt text only, never
parsed into a schema.

## Decision: reuse `CanonElement` generically, in a NEW `worldEntries` collection — don't build a parallel bespoke type

`ARCHITECTURE.md` §6 already anticipates exactly this split:
`/stories/{storyId}/worldElements/{pillarId}` (pillar status, issue
#41) vs. `/stories/{storyId}/worldEntries/{entryId}` (this issue) —
two different collections, not one overloaded one.

Within the new `worldEntries` collection, entries are still plain
`CanonElement` records (the same generic shape every project already
reuses — P1's default `elements`, P2's `characterFacts`, P3's own
`worldElements`) rather than a bespoke new type, because `CanonElement`
already has exactly the fields this model needs:

- `element_id` → the entry's stable id (derived from its name, see
  below).
- `status` → the entry's Canon Registry state (`Exploring`/`Working`/
  `Confirmed`/`Parked`, displayed as `Deferred` — same translation
  `canon-status/route.ts` already does for pillars).
- `value` → the entry's structured content (Name, Category, Narrative
  Role, Importance, Depth, Functional Description, Governing Rules,
  Outstanding Questions) as one JSON object.
- `depends_on` → **directly satisfies "Systemic Relationships"**
  (cross-references to other entries) — this is exactly what
  `depends_on` was designed for (`ARCHITECTURE.md` §6: "needed by
  Project 3's Dependency Review"). **Correction (final review):**
  `canonStore.ts`'s `listDependents`/`listDownstreamImpact` exist but
  are hardcoded to the default `"elements"` collection today (a
  pre-existing gap affecting P2's `characterFacts` too, not P3-specific)
  — they cannot query `WORLD_ENTRIES_COLLECTION` yet. Issue #48 must add
  a `collection` parameter to those functions (the same parameter every
  other `canonStore` function already has) before `depends_on` is
  actually queryable for any non-P1 collection. Building a separate
  `systemicRelationships` field would still be the wrong call — it
  would mean re-deriving dependency-graph machinery issue #48 already
  has a home for, just not yet extended to reach this collection.
- `history`, `rationale`, `retrieval_code` → inherited for free
  (retrieval_code stays unused/null for P3, same as P2).

This means issue #42 needs **zero new store-layer code** — it reuses
`getElement`/`listElements`/`upsertElement`/`applyStateDelta` from
`canonStore.ts` exactly as-is, pointed at a new collection constant.
What it does need: the collection constant itself, a typed shape for
what lives in `.value`, a stable id-derivation function, and the API
surface (routes) that didn't exist before.

## Architecture

### 1. New collection constant

`web/src/lib/canonEngine/canonStore.ts` gains:

```ts
/** Project 3's standalone-world-asset registry (issue #42) - a sibling
 * to WORLD_ELEMENTS_COLLECTION (pillar status only, issue #41).
 * Systemic Relationships (cross-references) use the existing generic
 * `depends_on` field - no separate field needed. */
export const WORLD_ENTRIES_COLLECTION = "worldEntries";
```

### 2. Entry id derivation

New file `web/src/lib/worldEngine/worldEntryId.ts`, mirroring
`characterEngine/characterId.ts`'s exact pattern (slugify + a
collision-disambiguation suffix), adapted for on-demand creation
(one entry at a time, not a batch ingestion pass like P2's cast):

```ts
export const MAX_ENTRY_ID_LENGTH = 60;

export function slugifyEntryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ENTRY_ID_LENGTH);
}

export function deriveEntryId(name: string, existingIds: Set<string>): string {
  const base = slugifyEntryName(name) || "entry"; // fallback for a name with no [a-z0-9] chars at all, mirrors pillarElementId.ts
  let id = base;
  let occurrence = 1;
  while (existingIds.has(id)) {
    occurrence++;
    const suffix = `_${occurrence}`;
    id = `${base.slice(0, MAX_ENTRY_ID_LENGTH - suffix.length)}${suffix}`;
  }
  return id;
}
```

### 3. The entry value shape and the Importance/Depth check

New file `web/src/lib/worldEngine/worldEntry.ts`:

```ts
export type EntryImportance = "Critical" | "Major" | "Supporting" | "Minor" | "Incidental";
export type EntryDepth = 1 | 2 | 3 | 4 | 5;

export interface OutstandingQuestion {
  item: string;
  notes: string;
}

export interface WorldEntryValue {
  name: string;
  category: string;
  narrativeRole: string;
  importance: EntryImportance;
  depth: EntryDepth;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions: OutstandingQuestion[];
}

export interface ImportanceDepthCheck {
  warning: boolean;
  message: string | null;
}
```

`checkImportanceDepthMismatch(importance, depth)` — none of its three
rules are invented: "Level 5 is reserved for Critical items only" is
sp03 §3's own stated rule verbatim; "a Minor element at Level 4/5" and
"a Critical element stuck at Level 1" are issue #44's own explicit AC
examples (not stated in sp03 §3 itself); "Incidental" additionally
triggers the same rule as "Minor" as this module's own extension (it
sits below Minor on sp03's Importance scale), not literally in the AC
text either.

### 4. API routes

New file `web/src/app/api/world-chat/entries/route.ts`, matching
`canon-status/route.ts`'s existing conventions exactly (`requireUser`,
`getMembership`, body-param addressing rather than dynamic segments,
`errorResponse`):

- **`POST`** — create. Body: `storyId`, `name`, `category`,
  `narrativeRole`, `importance`, `depth`, `functionalDescription`,
  `governingRules`, optional `dependsOn: string[]`. Derives a unique
  `entryId` via `deriveEntryId` against the story's existing entry ids,
  writes a new `Exploring` element, and returns the created entry plus
  any Importance/Depth warning (issue #44 — "surfaced... at the point
  of entry creation," not just logged).
- **`GET`** — list, via `?storyId=`. Returns every entry in
  `WORLD_ENTRIES_COLLECTION` for that story (the Canon Registry read
  path issue #45's future side panel will call).
- **`PATCH`** — update. Body: `storyId`, `entryId`, and any subset of
  the value fields / `status` / `dependsOn` to patch. Status changes go
  through `isValidTransition` exactly like `canon-status/route.ts`
  already does for pillars (`allowConfirmedOverride: true` — every call
  here is an explicit author/API action, not a model turn). Returns the
  updated entry plus a fresh Importance/Depth warning if the patch
  touched either field.

## Edge cases

- **Two entries with the same/similar name** (e.g. two "The Capital"):
  `deriveEntryId` disambiguates with a `_2`/`_3` suffix, mirroring issue
  #105's `assignCharIds` collision handling.
- **A PATCH that doesn't touch `importance` or `depth`**: no warning
  computed/returned — the check only runs when either field is present
  in the patch (or always, cheaply, since it's a pure function over the
  post-patch value either way — implementation detail for the plan).
- **`dependsOn` referencing an entry id that doesn't exist**: not
  validated at write time in this issue — issue #48 (Dependency Graph)
  owns building real query/validation logic over this field; this issue
  only needs the field to exist and be settable.
- **Outstanding Questions aggregation for issue #45's future "browsable
  registry"**: no separate collection/duplication — #45 aggregates by
  listing all entries and flattening their own `outstandingQuestions`
  arrays. Documented here so #45 doesn't design a redundant store.

## Out of scope

- The chat-driven discover/develop/validate flow that actually calls
  this CRUD from a conversation — issue #43.
- The side-panel UI that displays entries/registry — issue #45.
- Real dependency-graph queries/validation over `depends_on` — issue
  #48.
- Any change to `worldElements` (pillar status) — stays exactly as
  issue #41 shipped it.
- Project 4's canon ingestion (`storyArchitectureEngine/ingestCanon.ts`)
  seeing these entries — `ingestProject3` only reads
  `WORLD_ELEMENTS_COLLECTION` (pillar status) today; it has no visibility
  into `WORLD_ENTRIES_COLLECTION` at all. This is a real, currently
  undisclosed gap (found in final review) between "World Entries exist"
  and "Project 4 can see them" — worth its own follow-up issue once P4's
  ingestion needs richer P3 content than pillar status alone.
