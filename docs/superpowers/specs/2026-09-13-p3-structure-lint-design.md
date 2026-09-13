# P3 World Bible Structure-Lint — Design Spec

**Status:** Approved for planning
**Date:** 2026-09-13

## Problem

GitHub issue #51 (P3 Phase 4). PRD §2.3's success metric: "100% of compiled World Bible documents conform to the 15-section output schema (§7) and pass an automated structure-lint before being marked 'Confirmed.'" Issue #50 shipped the compiler (`worldBibleCompiler.ts`) and versioned storage (`StoredWorldBibleVersion` in `storyStore.ts`), but neither a structure-lint nor any "Confirmed" concept exists yet for a compiled document — confirmed by research: no `confirmed`/`locked` field anywhere on a compiled document (only `p1Locked` on `Story`, which gates further *editing*, not document *validity*, and predates any structural check), and no lint/validation function anywhere in the codebase checks a compiled document's shape.

Two things worth being precise about before designing this, both surfaced by research:

1. **TypeScript already guarantees the JSON shape at author-time.** `compileWorldBibleDocument` (issue #50) builds `WorldBibleDocument` as a typed object literal — a missing or misordered required key simply wouldn't compile. So a lint that only re-checks what TypeScript already enforced at the moment of compilation adds no real value for a *freshly compiled* document.
2. **The real gap is runtime trust, not compile-time shape.** Every document this app reads back out of Firestore goes through an unchecked type assertion (`snap.data() as StoredWorldBibleVersion`, `getWorldBibleVersion`/`getLatestWorldBibleVersion` in `storyStore.ts`) — Firestore has no schema, so nothing guarantees a document loaded later still matches the shape it was written with (a future schema change, a manual data repair, or a partially-written document from an interrupted request could all produce something TypeScript's compile-time check never sees). This is the same class of gap this session's own prior reviews already flagged for other loaded-not-computed documents (issue #49's follow-up #126, issue #50's final-review M8 finding) — issue #51 is this project's first *load-bearing* use of exactly that gap, since PRD §2.3 explicitly wants a gate the author can trust before calling a document final.

## Decisions

1. **The lint validates the actual persisted `StoredWorldBibleVersion.json` at the moment "Confirm" is requested, via a Zod schema — not a hand-rolled key-presence checker.** This project already has an established convention for "validate an untyped/loaded shape at a trust boundary" (`WorldTurnSchema`, `Stage4ConsistencySchema` in `stage4Audit.ts`) — reuse that convention rather than inventing a second validation style. A `WorldBibleDocumentSchema` (Zod) mirrors `WorldBibleDocument`'s TypeScript shape field-for-field; `lintWorldBibleDocument(doc: unknown)` runs `WorldBibleDocumentSchema.safeParse(doc)` and, on failure, translates Zod's issue list into a flat array of author-readable strings (e.g. `"5_geography_settings_registry: expected string, received undefined"` mapped to `"Missing or invalid: Geography & Settings Registry"`) rather than exposing raw Zod internals to the author.
2. **Section order is checked separately from section presence, against a single named constant.** Zod's `z.object(...)` validates that every key exists with the right type, but does not by itself assert *insertion order* (v3/v4 Zod parses/validates keys regardless of enumeration order). Since the AC explicitly requires "in the correct order," add one small explicit check: a `WORLD_BIBLE_SECTION_ORDER` array (the 15 keys, in the exact literal order already established by `WorldBibleDocument`'s own field declaration in `storyStore.ts`) that the lint compares against `Object.keys(doc).filter((k) => k !== "schema_version")`. This constant becomes the one place a future 16th section or reordering must touch — a natural refactor point, not a new source of drift, since `renderWorldBibleMarkdown` (issue #50) already lists all 15 sections in this same literal order in its own source; this issue doesn't touch that renderer, just gives the order it already follows an explicit, checkable name.
3. **"With the correct headers" is checked against the rendered Markdown, not the JSON.** The JSON's keys (`"5_geography_settings_registry"`) aren't "headers" in any author-facing sense — the actual headers (`## 5. Geography & Settings Registry`) only exist in `renderWorldBibleMarkdown`'s output. A second, small check — `lintWorldBibleMarkdown(markdown: string)` — regex-extracts every `## N. Title` line and compares the full ordered list against a hardcoded 15-entry array of expected `{n, title}` pairs (copied once from the PRD §7 list already quoted in this repo's own `worldEngine/worldBibleCompiler.ts` doc comments and `renderWorldBibleMarkdown`'s literal header strings). This catches a real, if narrow, class of bug distinct from #2 — a renderer edit that changes a header's wording or drops a line without touching the JSON schema at all.
4. **"Confirmed" is a per-version boolean on `StoredWorldBibleVersion`, not a new story-level lock field.** Unlike `p1Locked` (which gates further editing of the *entire ongoing interview*), "Confirmed" here means "this specific compiled version has been validated and the author has called it final" — a property of one immutable version, matching how versions are already the unit of immutability in this system (issue #50, Decision 5). Add `confirmed: boolean` and `confirmedAt: string | null` to `StoredWorldBibleVersion`. A version defaults to `confirmed: false` at compile time (set in issue #50's `generateWorldBibleDocument`, one line) and flips to `true` only via the new explicit confirm action below — never automatically, and never reversible in this issue's scope (no "unconfirm" action; if a later, better World Bible is needed, the author compiles a new version instead, consistent with "prior versions never overwritten").
5. **Confirming is an explicit author action via a new route, gated on the lint, mirroring the Stage 4 audit's approval pattern (issue #49) rather than inventing a new interaction shape.** `POST /api/world-chat/document/[version]/confirm` runs both lint functions against the stored version; on any failure, returns `422` with the flat error list (no mutation); on success, sets `confirmed: true`/`confirmedAt: <now>` and returns the updated version. This is a new, small storage function (`confirmWorldBibleVersion`) alongside issue #50's other `storyStore.ts` version functions — not a general-purpose "update a version" function, since versions are otherwise immutable once written (issue #50, Decision 5) and this is the one deliberate, narrow exception the PRD itself calls for.
6. **The UI shows a "Mark as Confirmed" action only for the latest compiled version, and shows lint failures inline rather than as a generic error toast.** Matches the existing World Bible compile panel's established pattern (issue #50: inline `compileError` text, not a toast). A version that's already `confirmed` shows a plain "Confirmed" label instead of the button (no unconfirm affordance, per Decision 4).

## Architecture

### New module `web/src/lib/worldEngine/worldBibleLint.ts`

```ts
import { z } from "zod";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

const WorldBiblePillarSummaryLintSchema = z.object({
  pillar: z.string(),
  summary: z.string(),
});

export const WorldBibleDocumentSchema = z.object({
  schema_version: z.string(),
  "1_document_metadata": z.object({
    story_id: z.string(),
    world_bible_version: z.string(),
    working_title: z.string(),
    date: z.string(),
    status: z.literal("Compiled"),
    related_project_1_version: z.string(),
    related_project_2_status: z.string(),
  }),
  "2_world_overview_complexity_summary": z.string(),
  "3_world_assumptions_canon_rules": z.string(),
  "4_master_world_pillars": z.array(WorldBiblePillarSummaryLintSchema),
  "5_geography_settings_registry": z.string(),
  "6_societal_infrastructure_manual": z.string(),
  "7_cultural_lived_experience_profiles": z.string(),
  "8_narrative_lore_history": z.string(),
  "9_system_mechanics": z.string(),
  "10_significant_institutions_artifacts": z.string(),
  "11_linguistic_communication_profile": z.string(),
  "12_interconnection_map_systems_synthesis": z.string(),
  "13_outstanding_world_questions": z.array(
    z.object({
      defer_to: z.string(),
      items: z.array(z.object({ item: z.string(), notes: z.string() })),
    })
  ),
  "14_cross_project_reference_log": z.object({
    project_1: z.object({ working_title: z.string(), version: z.string() }).nullable(),
    project_2: z.array(
      z.object({ character_name: z.string(), story_role: z.string(), canon_status: z.string() })
    ),
  }),
  "15_version_history": z.array(
    z.object({ version: z.string(), date: z.string(), summary_of_changes: z.string() })
  ),
});

export const WORLD_BIBLE_SECTION_ORDER: (keyof WorldBibleDocument)[] = [
  "1_document_metadata", "2_world_overview_complexity_summary", "3_world_assumptions_canon_rules",
  "4_master_world_pillars", "5_geography_settings_registry", "6_societal_infrastructure_manual",
  "7_cultural_lived_experience_profiles", "8_narrative_lore_history", "9_system_mechanics",
  "10_significant_institutions_artifacts", "11_linguistic_communication_profile",
  "12_interconnection_map_systems_synthesis", "13_outstanding_world_questions",
  "14_cross_project_reference_log", "15_version_history",
];

export const WORLD_BIBLE_MARKDOWN_HEADERS: { n: number; title: string }[] = [
  { n: 1, title: "Document Metadata" },
  { n: 2, title: "World Overview & Complexity Summary" },
  { n: 3, title: "High-Level World Assumptions & Canon Rules" },
  { n: 4, title: "Master World Pillars" },
  { n: 5, title: "Geography & Settings Registry" },
  { n: 6, title: "Societal Infrastructure Manual" },
  { n: 7, title: "Cultural & Lived Experience Profiles" },
  { n: 8, title: "Narrative Lore & History" },
  { n: 9, title: "System Mechanics" },
  { n: 10, title: "Significant Institutions & Artifacts" },
  { n: 11, title: "Linguistic & Communication Profile" },
  { n: 12, title: "Interconnection Map & Systems Synthesis" },
  { n: 13, title: "Outstanding World Questions" },
  { n: 14, title: "Cross-Project Reference Log" },
  { n: 15, title: "Version History" },
];

export function lintWorldBibleDocument(doc: unknown): { valid: boolean; errors: string[] } { /* ... */ }
export function lintWorldBibleMarkdown(markdown: string): { valid: boolean; errors: string[] } { /* ... */ }
```

`lintWorldBibleDocument`: runs `WorldBibleDocumentSchema.safeParse(doc)`; on failure, maps each Zod issue's `path`/`message` to an author-readable string keyed off `WORLD_BIBLE_MARKDOWN_HEADERS` (so a Zod path of `["5_geography_settings_registry"]` becomes `"Geography & Settings Registry: missing or invalid."`, not a raw Zod message). On success, additionally checks `Object.keys(parsed.data).filter((k) => k !== "schema_version")` against `WORLD_BIBLE_SECTION_ORDER` for exact order match, appending an order-specific error if they diverge.

`lintWorldBibleMarkdown`: regex-matches every `^## (\d+)\. (.+)$` line in the given Markdown, compares the extracted `{n, title}` sequence against `WORLD_BIBLE_MARKDOWN_HEADERS` for exact match (count, order, and text) — missing/extra/reordered/misworded headers each produce one specific error string.

Both return `{ valid: true, errors: [] }` on a clean document — callers check `valid`, not `errors.length` directly, for readability at call sites.

### `web/src/lib/canonEngine/storyStore.ts` (extended)

```ts
export interface StoredWorldBibleVersion {
  // ...existing fields (issue #50)...
  confirmed: boolean;
  confirmedAt: string | null;
}

export async function confirmWorldBibleVersion(storyId: string, version: number): Promise<StoredWorldBibleVersion> {
  // reads the version, throws if not found, sets confirmed/confirmedAt, persists, returns the updated record
}
```

`generateWorldBibleDocument` (issue #50, `worldBibleCompiler.ts`) gets one added line: the `StoredWorldBibleVersion` object literal it builds includes `confirmed: false, confirmedAt: null`.

### `web/src/app/api/world-chat/document/[version]/confirm/route.ts` (new)

`POST`, following the same `requireUser`/`getStory`/`getMembership` pattern as every other route in this family. Loads the target version (404 if absent), runs `lintWorldBibleDocument(stored.json)` then `lintWorldBibleMarkdown(stored.markdown)`, and on any failure returns `422` with `{ errors: [...both lints' errors] }` and does not mutate anything. On success, calls `confirmWorldBibleVersion` and returns the updated version.

### `web/src/components/WorldInterview.tsx` (extended)

The existing World Bible compile panel (issue #50) gains: a "Mark as Confirmed" button (only shown when `worldBibleDoc` exists and isn't already confirmed), a handler that POSTs to the confirm route and either shows a "Confirmed" label on success or renders the returned `errors` list inline (matching the existing `compileError` inline-text convention) on a 422.

## Error Handling

- A lint failure is not a server error — it's an expected, author-facing outcome (`422`, not `500`), matching how this route family already treats `409` (Stage 4 gate) as a normal, non-exceptional response.
- Because the compiler (issue #50) already guarantees TypeScript-level shape correctness for any document it produces going forward, a real-world lint failure is expected to be rare — its value is as a safety net against future schema drift or corrupted/legacy data, not as a routinely-tripped gate. Verification for this issue should include at least one deliberately-malformed constructed document to confirm the lint actually catches something, not just that it passes clean documents.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus:
- `lintWorldBibleDocument` against a real, freshly-compiled `WorldBibleDocument` (from a constructed or actual compile) → `valid: true`.
- `lintWorldBibleDocument` against the same document with one required key deleted, one section's type wrong (e.g. a string where an array is expected), and the section order shuffled → each produces a distinct, correctly-worded error.
- `lintWorldBibleMarkdown` against real Markdown from `renderWorldBibleMarkdown` → `valid: true`; against the same Markdown with one header line's wording changed and one header line deleted → both errors reported.
- The confirm route: a lint failure on a constructed bad document → `422`, no mutation (confirm a second time still fails identically); a clean document → `200`, `confirmed: true`/`confirmedAt` set, and a second confirm attempt on an already-confirmed version either succeeds idempotently or is rejected — pick one explicitly in the plan (recommend: idempotent success, simplest, no new state to guard against).
