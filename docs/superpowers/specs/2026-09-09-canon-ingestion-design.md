# Canon Ingestion Module (Issue #55) — Design

## Problem

Project 4 (Story Architecture Engine) needs a single, structured, indexed
view of everything Projects 1-3 have already produced before any
Structure work (issue #58 and onward) can reason over it. PRD §7.1
(FR-1.1 through FR-1.5) and issue #55's acceptance criteria define this
as the Canon Ingestion Module — the first piece of P4 to build.

## Decision: ingest all three projects directly from Firestore, not `.docx`

Issue #55's own AC already corrects the PRD's original "Project 1/2/3
`.docx` files" framing for Project 1: P1 never commits to a `.docx`
export (only `.md`/`.json`/`.pdf`), so P1 is ingested via its versioned
`story-foundation-v{n}.json` export (`foundationDoc.ts`'s
`listDocumentVersions`/`getDocumentVersion`, pinned to `SCHEMA_VERSION`).

The issue's AC as currently written still says Projects 2 and 3 are
ingested via `.docx`, "as their PRDs specify." Investigation found this
is no longer accurate for either, so this design makes a second
correction to the same AC, in the same spirit as the issue's own P1
correction:

- **Project 2's `.docx` export is itself compiled FROM Firestore.**
  `characterBibleEntries` (issue #34) already holds one fully-structured
  `CharacterBibleEntry` record per signed-off character — `want`/`need`/
  `core_flaw`/`core_wound`/`milestone_arc_timeline` and everything else
  Ingestion needs, already typed. Re-parsing the generated `.docx` back
  into structured data would be strictly redundant work with more failure
  surface (table-parsing fragility) than reading the source structure
  Firestore already holds.
- **Project 3 (World Bible) has no `.docx` export at all.** Nothing in
  the codebase generates one — confirmed by search, not assumption. The
  AC's premise that one exists to ingest doesn't hold, so that path isn't
  just suboptimal, it's unimplementable as written.

**Decision (confirmed):** ingest all three projects directly from
Firestore via each project's existing typed accessor — never via `.docx`
parsing. When this ships, issue #55's AC text should be updated to match
(same treatment as the P1 correction already recorded there).

## Architecture

New module: `web/src/lib/storyArchitectureEngine/ingestCanon.ts`

### Types

```ts
export interface CanonGap {
  project: "P1" | "P2" | "P3";
  field: string;
  reason: string;
}

export interface IngestedProject1Canon {
  storyDna: FoundationDocument["2_story_dna"];
  format: FoundationDocument["3_story_format"];
  premise: string;
  logline: string;
  thematicBlueprint: FoundationDocument["7_thematic_blueprint"];
  dramaticEngine: FoundationDocument["8_dramatic_engine"];
  storySpine: FoundationDocument["11_story_spine"];
  principalCharacters: unknown[];
  version: number;
}

export interface IngestedCharacterCanon {
  charId: string;
  name: string;
  want: string;
  need: string;
  coreFlaw: string;
  coreWound: string;
  arcTimeline: CharacterBibleEntry["milestone_arc_timeline"];
}

export interface IngestedProject2Canon {
  characters: IngestedCharacterCanon[];
}

export interface IngestedPillarCanon {
  name: string;
  elementId: string;
  status: CanonStatus;
  value: unknown;
}

export interface IngestedProject3Canon {
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  pillars: IngestedPillarCanon[];
}

export interface IngestedCanon {
  storyId: string;
  p1: IngestedProject1Canon | null;
  p2: IngestedProject2Canon;
  p3: IngestedProject3Canon;
  gaps: CanonGap[];
  structuralOverview: string;
}
```

### `ingestProject1(storyId, story)`

Reads `listDocumentVersions(storyId)`, takes the highest `version`, then
`getDocumentVersion(storyId, thatVersion)` for the full `FoundationDocument`
JSON. Fields are extracted by the document's own stable field-name keys
(`"2_story_dna"`, `"3_story_format"`, `"4_premise"`, `"5_logline"`,
`"7_thematic_blueprint"`, `"8_dramatic_engine"`, `"9_principal_characters"`,
`"11_story_spine"`) — satisfying the AC's "keyed by name, never a
hardcoded section number": these are the compiled document's own literal
field names, not a numeric array index.

If no versions exist yet: returns `p1: null` and one gap — `{ project:
"P1", field: "document", reason: "Story Foundation Document has not been
generated yet." }`. FR-1.2's minimum field list (Story DNA, Format(s),
Premise, Logline, Thematic Blueprint, Dramatic Engine, Story Spine) maps
directly onto the fields above — no additional per-field gap-checking
needed within P1, since a generated, locked document already guarantees
every §10.2 field is present (only Confirmed canon compiles per
`compileFoundationDocument`'s own rule).

**Revision note (final review, fix round 1):** this section originally
said `story.p1Locked` falsy should ALSO produce `p1: null`, the same as
no version existing. The final whole-branch review found this was wrong
two ways: `p1Locked` is optional/nullable and by convention treated the
same as `false` for a legacy Story written before the field existed —
returning `p1: null` for such a story would falsely report a real,
already-generated document as "not yet generated." Worse, `ingestCanon`
passes `p1?.principalCharacters ?? []` into `ingestProject2`, so a null
`p1` silently erases every Project 2 gap too, which FR-1.5 forbids. The
shipped behavior instead keeps `p1` populated whenever a version exists,
and adds a separate gap (`field: "p1Locked"`) when the document is
unlocked — surfacing the "this canon may be stale" signal without
discarding real canon or suppressing downstream gap detection.

### `ingestProject2(storyId, story, principalCharacters)`

Reads `listCharacterBibleEntries(storyId)` — one entry per signed-off
character (issue #34: written exactly once, at sign-off). Extracts
`want`/`need`/`core_flaw`/`core_wound` from each entry's
`psychological_engine`, and `milestone_arc_timeline` as-is.

Gap detection reuses P2's own status vocabulary rather than inventing a
new one: for each name in P1's `principalCharacters`, look up its status
in `story.p2?.characterProgress` (matched the same case-insensitive-name
way `characterBibleGate.ts`'s `checkCharacterBibleComplete` already
does, so Ingestion's gap list agrees with P2's own completion gate). A
principal character with no `characterProgress` entry at all is "never
started"; one whose entry exists but isn't `signed_off` reports that
entry's own `status` (`in_progress`/`deferred`) as the gap reason.

### `ingestProject3(storyId, story)`

Reads `listElements(storyId, WORLD_ELEMENTS_COLLECTION)` and
`normalizeP3(story.p3)`.

- `worldComplexityLevel: null` → gap: `{ project: "P3", field:
  "worldComplexityLevel", reason: "World Complexity Level has not been
  set yet." }`.
- `pillars: null` (not yet adopted — distinct from `pillars: []`, a
  deliberate empty list per `normalizeP3`'s own documented convention) →
  gap: `{ project: "P3", field: "pillars", reason: "World Bible pillar
  list has not been adopted yet." }`.
- For each adopted pillar name, look up its `CanonElement` via
  `pillarElementId(name)`. Only `status === "Confirmed"` pillars count as
  ingested canon (rules/institutions); anything else reports a gap with
  that element's own `status` as the reason, or "not started" if no
  element exists yet (a pillar's element is created lazily, on first
  status-set, per the existing P3 canon-registry design) — never
  invented.

### `computeStructuralOverview(canon)` — the new FR-1.4 piece

The one genuinely new synthesis logic in this module — nothing in P1,
P2, or P3 already produces a cross-project summary. Deterministic string
templating (no LLM call) from fields already extracted above: logline,
primary format name, protagonist, count and names of signed-off
characters, count of Confirmed pillars. Explicitly does not reproduce
full verbatim source text (e.g. the complete Story Spine or a full arc
timeline) — FR-1.4's own constraint — it names *what exists*, not its
full content. Degrades to a short "Project 1 is not yet complete" line
when `p1` is `null`, rather than throwing on missing fields.

### `ingestCanon(storyId)` — orchestrator

Each `ingestProjectN` function returns a `{ canon, gaps }` pair — its own
slice of `IngestedCanon` (`IngestedProject1Canon | null`,
`IngestedProject2Canon`, or `IngestedProject3Canon`) alongside that
project's own `CanonGap[]`. The orchestrator fetches `story` once,
calls all three, concatenates their gap lists, and derives
`structuralOverview` from the three assembled canon slices:

```ts
export async function ingestCanon(storyId: string): Promise<IngestedCanon> {
  const story = await getStory(storyId);
  const { canon: p1, gaps: p1Gaps } = await ingestProject1(storyId, story);
  const { canon: p2, gaps: p2Gaps } = await ingestProject2(storyId, story, p1?.principalCharacters ?? []);
  const { canon: p3, gaps: p3Gaps } = await ingestProject3(storyId, story);
  const gaps = [...p1Gaps, ...p2Gaps, ...p3Gaps];
  const structuralOverview = computeStructuralOverview({ p1, p2, p3 });
  return { storyId, p1, p2, p3, gaps, structuralOverview };
}
```

## Immutability (FR-1.3)

Enforced by omission, not a runtime lock: `ingestCanon.ts` exports only
read functions and never imports any of P1/P2/P3's own write functions
(`applyStateDelta`, `appendCharacterBibleEntry`, `setP2State`, etc.) —
those stay private to their own projects' routes. A future Canon
Revision mechanism (issue #72, out of scope here) is the only sanctioned
path that would ever change already-ingested canon; until #72 exists,
ingested canon is de facto immutable for the whole of P4.

## Edge cases

- **No Story Foundation Document generated yet** (no versions exist):
  `p1: null`, one gap, `structuralOverview` degrades gracefully rather
  than crashing on missing fields.
- **A version exists but `story.p1Locked` is falsy** (author unlocked
  Project 1 to keep revising, or a legacy Story predates the field):
  `p1` stays populated (this is real, readable canon) and a separate
  gap (`field: "p1Locked"`) is added noting the canon may be stale —
  see the Revision note above.
- **Zero signed-off characters**: `p2.characters: []`, one gap per
  principal character named in P1.
- **`p3.pillars` deliberately cleared to `[]`** (distinct from `null` per
  `normalizeP3`'s documented convention): this is a complete, valid
  state — zero pillars adopted on purpose — not a gap.
- **A pillar whose element no longer exists** (renamed pillar orphaning
  its old element, per `pillarElementId.ts`'s own documented behavior):
  reports as "not started," identical to a pillar that was never
  touched — this is P3's own pre-existing behavior; Ingestion doesn't
  special-case it further.

## Out of scope

- Story Complexity Level diagnosis (FR-2.x) — a later P4 issue, not part
  of ingestion.
- The onboarding message construction/UI itself (issue #57, Onboarding
  Gate) — this module only produces the `structuralOverview` string
  FR-1.4 requires; #57 decides how and when it's shown to the author.
- Canon Revision (issues #63-#72) — ingestion treats canon as read-only
  for this module's own lifetime; revision flows are separate, later
  issues.
- Any LLM call — this module is pure Firestore reads plus deterministic
  extraction/templating.
