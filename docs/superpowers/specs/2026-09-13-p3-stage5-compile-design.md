# P3 Stage 5 Compile — Design Spec

**Status:** Approved for planning
**Date:** 2026-09-13

## Problem

GitHub issue #50 (P3 Phase 4). Stage 5 is a deterministic Compile of the World Bible into the fixed 15-section schema (issue body + `sp03-wdc-systemprompt.md` §8): Document Metadata, World Overview & Complexity Summary, High-Level World Assumptions & Canon Rules, Master World Pillars, Geography & Settings Registry, Societal Infrastructure Manual, Cultural & Lived Experience Profiles, Narrative Lore & History, System Mechanics, Significant Institutions & Artifacts, Linguistic & Communication Profile, Interconnection Map & Systems Synthesis, Outstanding World Questions, Cross-Project Reference Log, Version History. Per ARCHITECTURE.md §2, this is P3's instance of the shared `DocumentCompiler` engine slot: "deterministic template-fill from `Confirmed` state into the fixed output schema — LLM used only for prose synthesis inside sections."

This step only becomes reachable once #49's Stage 4→5 clamp lifts (`story.p3Stage4Audit.authorApproved === true`), so no new stage-gating logic is needed here — Compile is what happens *after* arrival at Stage 5, not a gate on reaching it.

Unlike Project 1's Stage 8 compiler (`foundationDoc.ts`, 100% template-fill, zero LLM calls) or Project 2's Stage 6 compiler (`characterBibleCompiler.ts`, same), several of these 15 sections are specified as narrative write-ups, not raw field dumps — "Systems Map detailing...", "Traditions, Customs, Taboos, and Daily Life mechanics...", "(Max 2 paragraphs summarizing...)". P3 has no separate field-by-field spec for these sections the way P1's PRD §10.2 or P2's CDRM §7 do (confirmed by research — neither the PRD, the prompt spec, nor any existing plan/spec file goes deeper than the one bracketed line per section already quoted in the issue body). So P3's compiler is the first of the three to genuinely need the "LLM used only for prose synthesis inside sections" half of the architecture principle, not just the "deterministic template-fill" half.

The other real gap: World Entries carry a free-text `category: string` (`WorldEntryValue.category`) that authors/the model set per entry, matching whatever pillar name was active at creation time (e.g. "Geography/Sectors", "Government & Grid Bureaucracy") — there is no fixed taxonomy anywhere in the data model matching the schema's own fixed section names (Geography, Societal Infrastructure, Cultural, Narrative Lore, System Mechanics, Institutions & Artifacts, Linguistic). Pillars are themselves freely author-named and don't correspond 1:1 with these 7 fixed content lenses either (a story's pillars might be "Technology, Government, Economy, Culture, Geography, Underworld, History" — seven pillars that don't line up cleanly with the schema's seven *different* fixed section names). Some deterministic-vs-LLM decision has to resolve this mismatch; see Decision 2 below.

## Decisions

1. **Compile is an explicit author action, not an automatic side effect of the model reporting Stage 5.** Matches the established P1 precedent exactly: `foundationDoc.ts`'s `generateFoundationDocument` is invoked by a dedicated `POST .../document` route triggered by a UI button ("Generate document"), not by the chat turn itself. A multi-field LLM synthesis call (Decision 3) is too slow/expensive to run as a side effect of ordinary turn latency, and re-compiling on demand (to pull in newly-Confirmed entries after the first compile) needs a deliberate trigger anyway.

2. **Sections 5-11 (the seven fixed content lenses) are populated by one grounded LLM synthesis pass over *all* Confirmed World Entries, not by deterministically re-bucketing each entry's free-text `category` into one of the seven fixed names.** A keyword-matching classifier (e.g. "geograph"/"location" → §5, "govern"/"econom"/"legal"/"military" → §6, etc.) was considered and rejected: it's brittle against real author-chosen category strings which won't reliably contain the right keywords, it silently drops or misfiles entries whose category matches nothing, and — more importantly — every one of these seven sections is specified as connected narrative prose ("Systems Map detailing...", not "list of entries"), which is exactly what the architecture principle's "LLM used only for prose synthesis inside sections" licenses. Instead: the full set of Confirmed World Entries (name, category, functionalDescription, governingRules — everything `runConsistencyCheck` already grounds with, issue #49) is provided verbatim to one `extractTurn` call, and the model is instructed, per section, to synthesize prose *strictly from the provided entries* — never inventing world facts not present in the grounding data — and to say plainly ("No Confirmed entries currently address this section") wherever nothing provided fits a section's theme. This keeps the document's *structure* deterministic (15 sections, always present, always in order) while delegating the *classification-by-theme* work to the one place in this pipeline actually suited to it — the same posture #49's consistency check already established for "no rules-based precedent to lean on."
   - **No-fabrication guardrail:** the synthesis prompt's system message states explicitly that every claim must trace to a provided entry's `functionalDescription`/`governingRules`/`name`, mirroring `runConsistencyCheck`'s "not stylistic opinions, only genuine [findings]" framing. This is a prompting control, not a structural one (unlike P1/P2's compilers, which enforce no-fabrication structurally by only ever reading `Confirmed`-status field values) — an accepted, disclosed limitation for this feature, consistent with `runConsistencyCheck` already accepting the same limitation for its own one prose-adjacent judgment call.
   - Sections 2 (World Overview), 3 (Canon Rules), 4 (Master World Pillars — one paragraph per pillar), 5-11, and 12 (Interconnection Map) are ALL produced by this **one consolidated call** (not one call per section) — bundled into a single tool-use request emitting one string field per section, so a compile costs one Anthropic call total regardless of section count. Precedent: #49's `runConsistencyCheck` already established "one call reviewing everything together" over "one call per check" for exactly this kind of cost/latency reason.
   - Section 4's per-pillar paragraphs are the one part of this call with a **dynamic** field count (one paragraph per `story.p3.pillars` entry, and pillar count varies per story) — modeled as an array of `{ pillar: string; summary: string }` objects in the tool schema (`items` with `pillar` constrained by description to echo one of the provided pillar names verbatim), rather than N independently-named string fields.
   - Section 12 (Interconnection Map) is grounded additionally in the real `depends_on` edges already recorded on Confirmed entries (fetched via the existing `listElements`/`entry.depends_on` mechanism `checkDependencyCompleteness` already reads) — not just entries' prose — so "Economy depends on Politics" claims trace to actual recorded dependency edges, not invented systems-thinking.

3. **Sections 1 (Metadata), 13 (Outstanding World Questions), 14 (Cross-Project Reference Log), and 15 (Version History) are 100% deterministic template-fill, zero LLM involvement** — identical posture to every field in `foundationDoc.ts`/`characterBibleCompiler.ts`:
   - **§1 Document Metadata**: `story.id`, the new version number (Decision 5), `story.title`, current ISO date, a literal `status: "Compiled"`, and the two cross-project version pointers (Decision 4).
   - **§13 Outstanding World Questions**: every `StoredOutstandingQuestion` for this story (`listOutstandingQuestions`, issue #32's existing infra — already generic and story-scoped, no new persistence needed), grouped by `defer_to` (`"Project 2"|"Project 3"|"Project 4"|"Project 5"|null`) — "categorized registry" per the schema's own description is satisfied by this grouping, not a new `category` field.
   - **§14 Cross-Project Reference Log**: see Decision 4.
   - **§15 Version History**: every prior `StoredDocumentVersion` for this story's World Bible (Decision 5) rendered as `{ version, date, summary_of_changes }` rows — same shape and `diffSummary()` mechanism as `foundationDoc.ts`.

4. **Cross-Project Reference Log (§14) reads specific already-compiled P1/P2 output, not raw in-progress state.** No infrastructure for this exists today (confirmed by research: `ingestFoundation.ts` is a read-time grounding helper for the *live chat prompt*, not a persisted reference artifact). Resolution: at compile time, fetch the latest `FoundationDocument` version (`getDocumentVersion`/`listDocumentVersions`-equivalent read against `/stories/{storyId}/versions/{versionId}`, same collection P1 already writes) and the full `listCharacterBibleEntries(storyId)` list (P2, issue #34/#35's existing read function), and render a small deterministic set of pointers: P1's `working_title`/`version`/`genre_tone` (or whatever few fields are cheap and meaningful to name — exact field list finalized at plan time against `FoundationDocument`'s real shape) and, per signed-off character, `character_name`/`story_role`/`canon_status` from `CharacterBibleEntry.metadata`. If P1 has never generated a document (`versions` collection empty) or no characters are signed off yet, the section renders an honest "Not yet available" placeholder for that half — never fabricated content, matching the "no fabrication" posture used everywhere else in this pipeline.
   - §1 Metadata's "Related Project 1 & 2 Versions" fields reuse this same fetch: P1's version number (or `null`/"Not yet generated"), and P2's own concept of "version" — which doesn't exist (P2's compiler is write-once-per-character, no version counter, per research) — rendered instead as a count: "N characters signed off" or "Not yet available" if zero.

5. **World Bible compiles get their own `versions` subcollection, following `foundationDoc.ts`'s exact versioning mechanics (new doc per compile, never overwritten, version = prior max + 1) — not P2's write-once model.** P2's Stage 6 compiler is write-once-per-character because CDRM §7 explicitly forbids overwriting a signed-off character's entry. Issue #50 has no such constraint — "Compile locks a version number and timestamp" (AC) reads exactly like P1's existing pattern (a new immutable, timestamped snapshot every time), and re-compiling to pull in newly-Confirmed entries since the last compile is an expected, ordinary action here (Stage 5 has no analogous "sign-off, then permanent" semantics the way each P2 character does). New Firestore subcollection: `/stories/{storyId}/worldBibleVersions/{versionId}`, sibling to P1's `/stories/{storyId}/versions/{versionId}` (kept separate rather than shared, since the two document shapes are unrelated and sharing one collection would require a discriminator field neither existing reader expects).

6. **Markdown is the only export format built in this issue; `.docx` is explicitly out of scope, matching the issue's own AC ("Exports to Markdown at minimum").** ARCHITECTURE.md §4 already settled `.docx` generation on the `docx` npm package for P3, and `characterBibleDocx.ts` is a directly reusable pattern (client-side, on-demand, lazy-imported) — but building it now would roughly double this issue's scope for a requirement the AC marks as a floor, not a target. Filed as an explicit follow-up issue at merge time (matching the established `#49`→`#123-126` precedent for scoped-out work), not silently dropped.

7. **The compiled World Bible is persisted as one JSON document per version (mirroring `FoundationDocument`) plus a separately-rendered Markdown string, using the same "compiler produces typed JSON → separate pure function renders Markdown from that JSON" split already established by both `foundationDoc.ts`/its renderer and `characterBibleCompiler.ts`/`characterBibleMarkdown.ts`.** No new architectural pattern introduced here.

8. **New API routes live under `/api/world-chat/`, matching this project's existing route family** (`canon-status`, `entries`, `pillars`, `wcl`) rather than reusing the generic P1-shaped `/api/workspaces/[workspaceId]/canvases/[canvasId]/document` route, which is hardwired to `FoundationDocument`/`p1Locked`/`currentStage < 8` and not meaningfully generic today. New routes:
   - `POST /api/world-chat/document` — compiles and persists the next World Bible version. Gated: 403/409 (exact code decided at plan time, matching whatever convention the P1 route already uses for its analogous gate) unless `story.p3Stage4Audit?.authorApproved === true`.
   - `GET /api/world-chat/document` — lists versions (`version`, `date`, `summary_of_changes` only, no full content) for the version-history UI.
   - `GET /api/world-chat/document/[version]` — full `{ version, date, summary_of_changes, markdown, json }` for one version, so prior versions stay downloadable (matches P1's explicit AC for the same behavior).

9. **UI reuses the exact P1/P2 download-button pattern** (`web/src/lib/download.ts`'s `downloadText`/`downloadBlob`, the "Generate document" → then "Download .md" / "Download .json" button pair once a version exists) inside `WorldInterview.tsx`'s existing right-side panel, gated on `stage4Audit?.authorApproved` (already tracked client-side per issue #49) rather than a raw stage-number check, since that's the real precondition.

## Architecture

### `web/src/lib/canonEngine/storyStore.ts` (extended)

New types, mirroring `FoundationDocument`/`StoredDocumentVersion`'s shape:

```ts
export interface WorldBibleDocument {
  schema_version: string; // "1.0"
  "1_document_metadata": {
    story_id: string;
    world_bible_version: number;
    working_title: string;
    date: string;
    status: "Compiled";
    related_project_1_version: string; // number as string, or "Not yet generated"
    related_project_2_status: string;  // "N characters signed off" or "Not yet available"
  };
  "2_world_overview_complexity_summary": string;
  "3_world_assumptions_canon_rules": string;
  "4_master_world_pillars": { pillar: string; summary: string }[];
  "5_geography_settings_registry": string;
  "6_societal_infrastructure_manual": string;
  "7_cultural_lived_experience_profiles": string;
  "8_narrative_lore_history": string;
  "9_system_mechanics": string;
  "10_significant_institutions_artifacts": string;
  "11_linguistic_communication_profile": string;
  "12_interconnection_map_systems_synthesis": string;
  "13_outstanding_world_questions": { defer_to: string; items: { item: string; notes: string }[] }[];
  "14_cross_project_reference_log": {
    project_1: { working_title: string; version: string } | null;
    project_2: { character_name: string; story_role: string; canon_status: string }[];
  };
  "15_version_history": { version: number; date: string; summary_of_changes: string }[];
}
```

New collection + functions, mirroring `versionsCollection`/`generateFoundationDocument`'s naming exactly:

```ts
export interface StoredWorldBibleVersion {
  version: number;
  date: string;
  summary_of_changes: string;
  json: WorldBibleDocument;
  markdown: string;
  elementsSnapshot: Record<string, { status: CanonStatus; value: unknown }>;
}
function worldBibleVersionsCollection(storyId: string): CollectionReference;
export async function listWorldBibleVersions(storyId: string): Promise<Pick<StoredWorldBibleVersion, "version"|"date"|"summary_of_changes">[]>;
export async function getWorldBibleVersion(storyId: string, version: number): Promise<StoredWorldBibleVersion | null>;
```

(The actual generate/persist orchestrator function lives in the new compiler module below, not here — `storyStore.ts` stays the storage layer, matching how `foundationDoc.ts`'s own `generateFoundationDocument` lives in the compiler file, not `storyStore.ts`, despite writing to a `storyStore`-adjacent collection. Exact collection-access helper placement finalized at plan time to match whichever of the two precedents' file organization is cleaner to extend.)

### New module `web/src/lib/worldEngine/worldBibleCompiler.ts`

- `checkDependencyCompleteness`-style deterministic helpers for §1, §13, §14, §15 (pure functions, no I/O), following `foundationDoc.ts`'s `confirmedValue`/`str`/`arr` helper pattern.
- `buildSynthesisPrompt(confirmedEntries, pillars, dependencyEdges): { system: string; entryDescriptions: string }` — assembles the grounding text for the one consolidated LLM call, reusing `runConsistencyCheck`'s entry-description format (`stage4Audit.ts`) rather than inventing a second one.
- A new Zod schema + `Anthropic.Tool` pair (`WorldBibleSynthesisSchema`/`EMIT_WORLD_BIBLE_SYNTHESIS_TOOL`) with one field per LLM-synthesized section (§2, §3, §4 array, §5-11, §12) — 11 fields total.
- `runWorldBibleSynthesis(anthropic, confirmedEntries, pillars): Promise<WorldBibleSynthesisResult>` — the one `extractTurn` call, mirroring `runConsistencyCheck`'s signature/error-propagation shape exactly (throws on failure; the caller, not this function, decides how to degrade — unlike #49's audit, a failed synthesis during an explicit author-triggered Compile action should surface as a visible error toast, not a silently-degraded flag finding, since there's no "next turn will retry" mechanism here the way there was for the audit's per-turn compute).
- `compileWorldBibleDocument(params): WorldBibleDocument` — pure, combines the deterministic sections with a pre-fetched `WorldBibleSynthesisResult`, mirroring `compileFoundationDocument`'s signature shape (story/elements/outstanding/version/versionHistory in, typed document out).
- `renderWorldBibleMarkdown(doc: WorldBibleDocument): string` — separate pure function, same `mdValue()`-style convention as the two existing Markdown renderers.
- `generateWorldBibleDocument(storyId): Promise<StoredWorldBibleVersion>` — the async orchestrator: reads latest prior version, computes next version number, fetches Confirmed World Entries + outstanding questions + P1's latest `FoundationDocument` version + P2's `listCharacterBibleEntries`, runs the synthesis call, calls `compileWorldBibleDocument`, renders Markdown, computes `diffSummary()` (reused from `foundationDoc.ts` if exported, else a local copy matching its exact algorithm), persists via `worldBibleVersionsCollection`, returns the stored version.

### `web/src/app/api/world-chat/document/route.ts` (new) and `web/src/app/api/world-chat/document/[version]/route.ts` (new)

Thin routes per Decision 8, following the P1 route files' structure (auth/membership check, story fetch, gate check, call the orchestrator, `NextResponse.json`).

### `web/src/components/WorldInterview.tsx` (extended)

Per Decision 9: a "Generate World Bible" button appears once `stage4Audit?.authorApproved === true`; once a version exists, "Download .md" / "Download .json" buttons appear alongside a version-history list (reusing `listDocumentVersions`-equivalent read), matching `ChatInterview.tsx`'s existing right-panel document card layout and `downloadText` calls.

## Error Handling

- A synthesis-call failure (network, rate limit, malformed model output) during an explicit `POST /api/world-chat/document` surfaces as a normal API error response (matching how every other explicit author-triggered action in this route family already fails loudly rather than silently degrading) — no new "flag finding" degradation pattern is introduced; that pattern exists in #49 specifically because the audit computes silently as a side effect of an ordinary chat turn, which Compile is not.
- Missing P1/P2 cross-project data (Decision 4) is not an error — it's an expected, honestly-labeled placeholder state for any story compiling its World Bible before Project 1/2 work exists or completes.
- Re-compiling before any Confirmed World Entries exist is allowed (not blocked) — the synthesis call and deterministic sections both degrade to "No Confirmed entries yet" placeholder text throughout, matching the "total over whatever's actually been captured" posture `characterBibleCompiler.ts`'s own testing section already established as this codebase's standard for compilers.

## Testing

No automated test framework exists in this repo (established convention, again confirmed for P3 across every #49 task). Verification is `npm run lint && npm run build`, plus:
- A `tsx` trace of `compileWorldBibleDocument` with a constructed `WorldBibleSynthesisResult` and a small set of Confirmed/non-Confirmed entries, confirming non-Confirmed entries never leak into any deterministic section and every deterministic section renders total (no thrown errors) over an empty entries/outstanding-questions/pillars input.
- A live (if an API key is available in the implementing sandbox) or carefully-reasoned-through (if not, disclosed per this repo's established convention) exercise of `runWorldBibleSynthesis` against a handful of constructed Confirmed entries spanning at least two different pillar names and one real `depends_on` edge, checked for: prose sections don't invent facts absent from the provided entries, §4's per-pillar array covers every provided pillar name exactly once, and a pillar with zero Confirmed entries gets an honest placeholder paragraph rather than fabricated content.
- A version-history trace: compiling twice for the same story produces two distinct, both-retrievable versions (`version` 1 then 2), matching `foundationDoc.ts`'s own established re-compile behavior.
- Cross-Project Reference Log rendering traced against three states: no P1 document yet + no P2 characters signed off (both placeholders); a P1 document present + zero P2 characters; both present (full rendering) — confirming no state throws and no state fabricates.
