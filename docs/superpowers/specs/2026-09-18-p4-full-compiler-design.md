# P4 Full Compiler (Screenplay Architecture Document) — Design Spec

GitHub issue: #70 ("[P4] Implement full compiler matching 7-section Screenplay Architecture
Document spec"), folding in issue #115 ("[P4] Expose Working Title, Genre, and Tone through
ingestCanon's IngestedProject1Canon") as a small, tightly-coupled prerequisite.

PRD ref: P4 Prompt v3.0 §6 — the 7 sections in order: (1) Screenplay Metadata, (2) Story DNA
Blueprint, (3) Structural Act & Set Piece Overview, (4) Complete Approved Scene Register, (5)
Critical Beat Earmark Index, (6) Setup & Payoff Ledger, (7) Outstanding Decisions & Version
History.

## Problem

`compileArchitectureDocument.ts` (issue #60) already builds a 7-section skeleton, but by its own
explicit design is a placeholder-riddled, non-persisted, markdown-only function — its own header
comment names issue #70 as the owner of everything it defers: exact Working Title/Genre/Tone,
version/date/status/author, the Critical Beat Earmark Index, and Version History. This issue
completes it, following Project 3's already-shipped World Bible compiler (issues #50/#51) as
closely as possible — same versioning pattern, same typed-JSON-plus-rendered-markdown split, same
docx/pdf export shape.

## Design

### 1. Deterministic, not LLM-synthesized — inherited from issue #60, not re-derived here

Unlike the World Bible compiler (which uses one LLM call for prose synthesis inside several
sections), P4's compiler stays fully deterministic — issue #60's own AC already established this
("only `Confirmed` state-ledger content is assembled," no fabrication), and nothing in issue #70's
AC asks for prose synthesis. Every section is either a direct data pass-through, a straightforward
aggregation, or an honest disclosed placeholder for data that doesn't exist yet.

### 2. New typed JSON document + persisted version, mirroring `WorldBibleDocument` exactly

```ts
export interface ScreenplayArchitectureDocument {
  schema_version: string;
  "1_screenplay_metadata": {
    story_id: string;
    screenplay_architecture_version: string; // "v{n}" of THIS document, self-referential
    working_title: string;
    date: string;
    status: "Compiled";
    author: string; // see §5 below - no per-user authorship exists anywhere in this app yet
    diagnosed_complexity: string; // always "N/A" - removed in Framework v3.0
    projected_scene_count: number;
    estimated_runtime: string; // see §5 - no runtime-estimation model exists
  };
  "2_story_dna_blueprint": {
    summary_of_core_promise: string;
    genre: string;
    tone: string;
    theme: string;
    core_dramatic_question: string;
  };
  "3_structural_act_set_piece_overview": {
    act_id: string;
    act_name: string;
    step_numbers: number[];
    anchoring_set_pieces: string[];
  }[];
  "4_complete_approved_scene_register": {
    unit_id: string;
    type: string;
    scene_number: number;
    slugline: string;
    critical_beat_tag: string | null;
    paragraph: string;
    causal_tag: string;
  }[];
  "5_critical_beat_earmark_index": {
    tag: string;
    scene_number: number | null;
    unit_id: string | null;
    slugline: string | null;
  }[];
  "6_setup_payoff_ledger": string; // stays a disclosed placeholder - see §6
  "7_outstanding_decisions_version_history": {
    outstanding: { unit_id: string; status: string }[];
    version_history: { version: string; date: string; summary_of_changes: string }[];
  };
}

export interface StoredScreenplayArchitectureVersion {
  version: number;
  date: string;
  summary_of_changes: string;
  json: ScreenplayArchitectureDocument;
  markdown: string;
  unitsSnapshot: Record<string, { status: string; content: unknown }>;
  confirmed: boolean;
  confirmedAt: string | null;
}
```

Stored in a new `p4ArchitectureVersions` Firestore subcollection, doc-per-version keyed by
`String(version)` — the exact shape of `worldBibleVersionsCollection`. `confirmed`/`confirmedAt`
exist for schema parity with `StoredWorldBibleVersion` but are never set to `true` by anything in
this issue (see §7 — no confirm flow is being built here, matching issue #70's own AC, which
never mentions one).

### 3. Orchestration mirrors `generateWorldBibleDocument` exactly

A new function (new file, `screenplayArchitectureCompiler.ts`, mirroring `worldBibleCompiler.ts`'s
separation of "fetch/version/diff/persist" from "pure section-building"):

```ts
export async function generateScreenplayArchitectureDocument(storyId: string): Promise<StoredScreenplayArchitectureVersion>
```

Fetches the story, canon, and `p4Units`, plus the prior version (`getLatestScreenplayArchitectureVersion`);
computes `version = (prior?.version ?? 0) + 1`; builds a `unitsSnapshot` (every unit's
`{status, content}`, not just `Confirmed` ones — matching `elementsSnapshot`'s own "every entry,
not just Confirmed" precedent); computes `summary_of_changes` via a `diffSummary` function
byte-for-byte identical in shape to `worldBibleCompiler.ts`'s own (added/changed/removed,
comparing `JSON.stringify`d content and status per unit); builds `json` via
`compileScreenplayArchitectureDocumentJson` (pure function, §4 below) and `markdown` via
`renderScreenplayArchitectureMarkdown(json)` (pure function, walks the JSON's own sections in
order — same split World Bible's `compileWorldBibleDocument`/`renderWorldBibleMarkdown` already
use); persists via `saveScreenplayArchitectureVersion`.

### 4. Section-by-section compile logic

- **§1 Metadata**: `story_id` (given), `screenplay_architecture_version` = `` `v${version}` ``
  (self-referential, like `WorldBibleDocument`'s own `world_bible_version`), `working_title` from
  `canon.p1.workingTitle` (new, issue #115), `date` = compile date, `status` = `"Compiled"`
  (constant), `diagnosed_complexity` = `"N/A"` (constant — Framework v3.0 removed this concept;
  carries forward the *reasoning* the current placeholder already states, just as a real field
  value now instead of prose), `projected_scene_count` = `getConfirmedUnits(units).length`,
  `estimated_runtime` = a disclosed placeholder string (no pages-per-minute or similar
  runtime-estimation model exists anywhere in this codebase — inventing one would be fabrication,
  not a documented rule; out of scope for this issue).
- **§2 Story DNA Blueprint**: `summary_of_core_promise`/`theme`/`core_dramatic_question` — already
  available via `canon.p1`, unchanged from the current compiler's own extraction. `genre`/`tone`
  — new, from `canon.p1.genreTone.genre`/`.tone` (issue #115).
- **§3 Structural Act & Set Piece Overview**: same `STRUCTURAL_ACTS`/`STRUCTURAL_STEPS` walk the
  current compiler already does, restructured as an array of objects instead of a markdown string
  (Section 3 has no format spec beyond "breakdown," so a structured array is a strict superset of
  what the current bullet-list already conveys).
- **§4 Complete Approved Scene Register**: for each `Confirmed` unit (in ledger order — no other
  ordering concept exists), parse its `content` via a new `parseSceneRegisterEntry` function
  (§4a below) into `{slugline, criticalBeatTag, paragraph}`; `scene_number` is the entry's 1-based
  position in this same array (the only numbering concept that exists — there's no separate
  "scene number" field tracked anywhere).
- **§5 Critical Beat Earmark Index**: for each of the 10 canonical tags (from
  `CRITICAL_BEAT_LOOKUP`), find the Confirmed unit(s) whose content carries it (reusing the exact
  multi-tag-aware scanning issue #91's `checkEarmark` already established — a local global clone
  of `CRITICAL_BEAT_TAG_PATTERN`, never the shared non-global export) and record its
  `scene_number`/`unit_id`/`slugline` (cross-referenced from the already-built §4 array, so the
  two sections can never disagree about which scene a tag lives in). A tag with no match (only
  reachable if the author overrode issue #91's Earmark Check) gets `{tag, scene_number: null,
  unit_id: null, slugline: null}`.
- **§6 Setup & Payoff Ledger**: stays an honest disclosed placeholder, unchanged in spirit from
  the current compiler. Its current placeholder text incorrectly attributes this to issue #72 —
  investigated as part of this design and confirmed **#72 is about Canon Revision cascade tracing
  and a Dependency & Continuity Ledger, not scene-level Setup/Payoff tracking** — no issue
  currently owns this data model at all. Filed as a new follow-up (see §8) rather than silently
  perpetuating the wrong attribution.
- **§7 Outstanding Decisions & Version History**: `outstanding` — same non-`Confirmed`-unit list
  the current compiler already builds, restructured as an array of objects. `version_history` —
  real, from the newly-versioned storage: every prior version's `{version, date,
  summary_of_changes}` plus the current one, mirroring `generateWorldBibleDocument`'s own
  `priorHistory`/`versionHistory` construction exactly.

#### 4a. New parsing function: `parseSceneRegisterEntry`

`checkSceneRegisterFormat` (issue #66) already isolates a slugline, an optional beat tag, and a
paragraph internally via regex, but only returns a pass/fail verdict — it never exposes the parsed
pieces. A new function, added alongside it in `developmentLoop.ts` (same file, same patterns,
reused directly rather than duplicated):

```ts
export interface ParsedSceneRegisterEntry {
  slugline: string;
  criticalBeatTag: string | null;
  paragraph: string;
}

export function parseSceneRegisterEntry(content: string): ParsedSceneRegisterEntry
```

Never throws — a unit whose content is malformed (only reachable if the author overrode issue
#91's Formatting Check) degrades gracefully: `slugline` falls back to a disclosed placeholder
string when the slugline pattern doesn't match, `paragraph` falls back to the raw trimmed content.
This mirrors this codebase's own established "degrade honestly, never crash" convention (e.g.
issue #67's final-review fix to `structural_vector_options`'s schema).

### 5. Two disclosed gaps carried forward from the current compiler, not fabricated

- **Author**: no per-user authorship is tracked anywhere in this app for a Story — `storyStore.ts`'s
  own header comment already discloses that real Firebase Auth (a verified, trustworthy per-call
  identity) isn't wired in yet. Inventing an "author" value (the workspace owner? the last chat
  participant?) would be fabricating data this issue has no real source for. `author` stays a
  disclosed placeholder string, same posture as `estimated_runtime`.
- **Setup & Payoff Ledger**: see §4 above — genuinely orphaned, filed as a new follow-up.

### 6. Route wiring: extend, don't replace, the existing gate

`architecture-chat/document/route.ts` already runs issues #65's and #91's combined
409/`acknowledged` gate before compiling. This issue's only change to that route: swap the
compile call itself from the current ephemeral `compileScreenplayArchitectureDocument` to the new
persisting `generateScreenplayArchitectureDocument`, and update the success response to carry the
full stored version shape (`version`, `date`, `summary_of_changes`, `json`, `markdown`,
`confirmed`, `confirmedAt`) alongside the unchanged `thematicAnchorAudit`/`preCompilationAudit`
fields — matching `world-chat/document/route.ts`'s own response shape exactly. Both audits' gating
logic, the 409 shape, and the `acknowledged` handling are completely untouched.

### 7. Deliberately out of scope (YAGNI, not oversight)

- **A confirm/structure-lint flow** (World Bible's issue #51 equivalent) — issue #70's AC never
  mentions author-confirming a specific compiled version; `confirmed`/`confirmedAt` exist on the
  stored type for schema parity and future-proofing only, always `false`/`null` in this issue.
- **A version-browse/fetch-by-number route** (World Bible's `GET`/`[version]` routes) — issue
  #70's AC is satisfied by Section 7's own auto-incrementing history rendered *inside* each
  compile; browsing prior versions independently is a UI nicety this issue's AC doesn't ask for.
  The Firestore storage this issue builds makes adding that trivial later.
- **Partial/incremental compilation** ("just Act 1") — that's issue #71's own scope entirely,
  filed as its own issue for exactly this reason.
- **Real pagination/runtime estimation** — no such model exists in this codebase; inventing one
  would be exactly the kind of silent-rule-invention this codebase's own conventions reject.

### 8. Docx/PDF export: mirror `worldBibleDocx.ts`/`WorldBiblePdfDocument.tsx` structurally

Two new files, same imperative per-section-in-order pattern as their P3 counterparts, taking the
new typed `ScreenplayArchitectureDocument` directly:

```ts
// web/src/lib/docx/screenplayArchitectureDocx.ts
export async function generateScreenplayArchitectureDocxBlob(doc: ScreenplayArchitectureDocument): Promise<Blob>

// web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx ("use client")
export function ScreenplayArchitecturePdfDocument({ doc }: { doc: ScreenplayArchitectureDocument })
export async function generateScreenplayArchitecturePdfBlob(doc: ScreenplayArchitectureDocument): Promise<Blob>
```

### 9. UI: four download formats, matching the World Bible's own established pattern exactly

`ArchitectureInterview.tsx`'s `compiled` state changes shape from `{markdown, outstandingCount}`
to the full stored-version response; the existing "Download .md" button keeps working off
`compiled.markdown` unchanged; three new buttons are added — "Download .json" (direct
`JSON.stringify(compiled.json)`, using the already-shared `downloadText` helper, exactly like
`WorldInterview.tsx`'s own `.json` button), "Download .docx" and "Download .pdf" (dynamically
`import()` the two new generator modules on click, exactly matching `WorldInterview.tsx`'s own
`docxGenerating`/`pdfGenerating` loading-state pattern).

## Files touched

- Modify: `web/src/lib/storyArchitectureEngine/ingestCanon.ts` (issue #115: `workingTitle`,
  `genreTone` on `IngestedProject1Canon`)
- Modify: `web/src/lib/canonEngine/storyStore.ts` (new types + version-persistence functions)
- Modify: `web/src/lib/storyArchitectureEngine/developmentLoop.ts` (new
  `parseSceneRegisterEntry`)
- Rewrite: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts` (JSON builder +
  markdown renderer, all 7 sections real)
- Create: `web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.ts` (orchestrator)
- Modify: `web/src/app/api/architecture-chat/document/route.ts` (swap the compile call, update
  response shape, gates untouched)
- Create: `web/src/lib/docx/screenplayArchitectureDocx.ts`
- Create: `web/src/lib/pdf/ScreenplayArchitecturePdfDocument.tsx`
- Modify: `web/src/components/ArchitectureInterview.tsx` (four download buttons, `compiled`
  state shape)

## Testing

No test suite exists in this project. Verification is `tsc --noEmit`, `npm run lint`,
`npm run build`, plus a direct code trace: `parseSceneRegisterEntry` against well-formed and
malformed content; a full `compileScreenplayArchitectureDocumentJson` trace against a small
hand-built `units[]` covering multiple Acts, a unit with two beat tags, and one missing beat tag;
`generateScreenplayArchitectureDocument`'s version auto-increment and diff-summary logic across
two successive calls against the same story; the route's response shape; and the docx/pdf
generators' basic invocation (matching #56/#65's own standard for UI-only/generator verification
without a live model call — none of this issue's code needs one).

## Follow-up to file after merge

"[P4] No issue owns Setup & Payoff Ledger tracking" — Section 6 of the compiled document has no
underlying data model anywhere in the codebase; issue #72 (which the current placeholder
incorrectly names) is actually about Canon Revision cascade tracing, a different concern.
