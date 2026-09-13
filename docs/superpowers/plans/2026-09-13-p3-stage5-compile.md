# P3 Stage 5 Compile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #50 — a deterministic Stage 5 Compile that assembles Project 3's 15-section World Bible from Confirmed canon data, using one grounded LLM call for prose synthesis inside sections and pure template-fill for everything else, with versioned persistence and a Markdown export.

**Architecture:** A new `web/src/lib/worldEngine/worldBibleCompiler.ts` module mirrors the established `foundationDoc.ts` (issue #18) / `characterBibleCompiler.ts` (issue #34) pattern: deterministic helpers for structured sections, one `extractTurn` call for narrative sections, a pure `compile*` function combining both into a typed document, a separate pure Markdown renderer, and an async orchestrator that fetches data, calls the above, and persists a new immutable version. New API routes under `/api/world-chat/document` (matching this project's existing route family) expose it; `WorldInterview.tsx` gets a "Generate World Bible" panel matching the established P1/P2 download-button UI pattern.

**Tech Stack:** Next.js API routes, Firestore (`firebase-admin`), `@anthropic-ai/sdk` via the existing `extractTurn` helper, Zod for schema validation, no new dependencies.

## Global Constraints

- Full design spec: `docs/superpowers/specs/2026-09-13-p3-stage5-compile-design.md` — every task below implements a specific Decision from that spec; consult it for the reasoning behind any of these values.
- Compile is an explicit author action via a new route, never an automatic side effect of a chat turn (Decision 1).
- Sections 2, 3, 4, 5-11, and 12 (11 fields total) come from **one consolidated** `extractTurn` call — never one call per section (Decision 2).
- The synthesis call's system prompt must instruct: every claim traces to a provided Confirmed entry or dependency edge; never invent a world fact; say plainly when nothing provided addresses a section (Decision 2's no-fabrication guardrail).
- Sections 1, 13, 14, 15 are 100% deterministic template-fill — zero LLM involvement (Decision 3).
- New Firestore subcollection `/stories/{storyId}/worldBibleVersions/{versionId}`, versioned exactly like `foundationDoc.ts`'s `/versions/{versionId}` (new doc per compile, `version = prior max + 1`, never overwritten) — **not** P2's write-once-per-character model (Decision 5).
- Markdown is the only export format built in this plan; `.docx` is explicitly out of scope, to be filed as a follow-up issue at merge time (Decision 6).
- New routes live under `/api/world-chat/document` and `/api/world-chat/document/[version]`, not the P1-shaped `/api/workspaces/.../canvases/.../document` route (Decision 8).
- The compile route is gated on `story.p3Stage4Audit?.authorApproved === true` — never on `story.currentStage`, which is not P3's source of truth for stage (issue #49 tracks P3 stage per-message, not on `Story.currentStage`).
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, regardless of which underlying model implements the task — a fixed session-wide convention, not self-attribution.
- No automated test framework exists in this repo (established convention across every prior P3 issue) — verification is `npm run lint && npm run build` from `web/`, plus `tsx` trace scripts tracing real behavior against the actual committed code.

---

### Task 1: World Bible version storage in `storyStore.ts`

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Consumes: nothing new — uses the file's existing `getDb`/`storiesCollection` pattern.
- Produces: `WorldBibleDocument` (the compiled document's exact shape), `StoredWorldBibleVersion`, `listWorldBibleVersions(storyId): Promise<Pick<StoredWorldBibleVersion, "version"|"date"|"summary_of_changes">[]>`, `getWorldBibleVersion(storyId, version): Promise<StoredWorldBibleVersion | null>`, `saveWorldBibleVersion(storyId, stored: StoredWorldBibleVersion): Promise<void>`, `getLatestWorldBibleVersion(storyId): Promise<StoredWorldBibleVersion | null>`. Task 3 builds `WorldBibleDocument` values; Task 4 calls all four functions.

- [ ] **Step 1: Add the `WorldBibleDocument` type**

Add near the end of `web/src/lib/canonEngine/storyStore.ts` (after the `CharacterBibleEntry`-related code, before the author-type-assessment section — anywhere in the file's bottom half is fine, this is additive):

```ts
/**
 * Project 3's Stage 5 Compile output (issue #50) - the 15-section World
 * Bible schema (sp03-wdc-systemprompt.md §8). Sections 2/3/4/5-11/12 are
 * LLM-synthesized prose grounded in Confirmed World Entries (see
 * worldEngine/worldBibleCompiler.ts's runWorldBibleSynthesis); sections
 * 1/13/14/15 are pure template-fill, same posture as FoundationDocument's
 * (foundationDoc.ts, issue #18) "no fabrication" guarantee for those parts.
 * Numbered keys mirror FoundationDocument's own convention.
 */
export interface WorldBibleDocument {
  schema_version: string;
  "1_document_metadata": {
    story_id: string;
    world_bible_version: string; // "v{n}", matches FoundationDocument's own version string format
    working_title: string;
    date: string;
    status: "Compiled";
    related_project_1_version: string;
    related_project_2_status: string;
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
  "15_version_history": { version: string; date: string; summary_of_changes: string }[];
}
```

- [ ] **Step 2: Add the versioned-storage type and collection helper**

Add immediately after the type from Step 1:

```ts
export interface StoredWorldBibleVersion {
  version: number;
  date: string;
  summary_of_changes: string;
  json: WorldBibleDocument;
  markdown: string;
  /** Confirmed World Entries snapshot at generation time (element_id -> status/value), used to diff the next version - same shape/purpose as FoundationDocument's own elementsSnapshot. */
  elementsSnapshot: Record<string, { status: string; value: unknown }>;
}

function worldBibleVersionsCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("worldBibleVersions");
}
```

- [ ] **Step 3: Add the read/write functions**

Add immediately after Step 2's code:

```ts
export async function listWorldBibleVersions(
  storyId: string
): Promise<Pick<StoredWorldBibleVersion, "version" | "date" | "summary_of_changes">[]> {
  const snap = await worldBibleVersionsCollection(storyId).orderBy("version", "asc").get();
  return snap.docs.map((d) => {
    const v = d.data() as StoredWorldBibleVersion;
    return { version: v.version, date: v.date, summary_of_changes: v.summary_of_changes };
  });
}

export async function getWorldBibleVersion(
  storyId: string,
  version: number
): Promise<StoredWorldBibleVersion | null> {
  const snap = await worldBibleVersionsCollection(storyId).doc(String(version)).get();
  return snap.exists ? (snap.data() as StoredWorldBibleVersion) : null;
}

export async function getLatestWorldBibleVersion(storyId: string): Promise<StoredWorldBibleVersion | null> {
  const snap = await worldBibleVersionsCollection(storyId).orderBy("version", "desc").limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as StoredWorldBibleVersion);
}

/** Persists a new World Bible version. Never overwrites a prior version - `stored.version` must already be `(latest?.version ?? 0) + 1`, computed by the caller (worldEngine/worldBibleCompiler.ts's generateWorldBibleDocument), same division of responsibility as FoundationDocument's own generateFoundationDocument/versionsCollection split. */
export async function saveWorldBibleVersion(storyId: string, stored: StoredWorldBibleVersion): Promise<void> {
  await worldBibleVersionsCollection(storyId).doc(String(stored.version)).set(stored);
}
```

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean. This task adds pure types/storage functions with no callers yet, so a clean build is the full verification (no behavior to trace).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: add WorldBibleDocument type and versioned storage (issue #50)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 2: LLM prose-synthesis module

**Files:**
- Create: `web/src/lib/worldEngine/worldBibleCompiler.ts`

**Interfaces:**
- Consumes: `CanonElement` (`@/lib/canonEngine/types`), `WorldEntryValue` (`./worldEntry`), `extractTurn`/`ExtractTurnParams`-shape (`@/lib/canonEngine/extractTurn`), `Anthropic` SDK type, `z` from `"zod"`.
- Produces: `WorldBibleSynthesisResult` (Zod-inferred type), `runWorldBibleSynthesis(anthropic, confirmedEntries, pillars): Promise<WorldBibleSynthesisResult>`. Task 3 consumes `WorldBibleSynthesisResult` and calls this function's result (not the function itself — Task 4's orchestrator calls `runWorldBibleSynthesis` and hands the result to Task 3's `compileWorldBibleDocument`).

This is the file's first content — Task 3 and Task 4 both add to this same file, in later tasks, since it's the single home for P3's Stage 5 compiler (mirrors `stage4Audit.ts` holding all of that issue's rules-based + model-driven checks in one file).

- [ ] **Step 1: Create the file with imports and the header comment**

Create `web/src/lib/worldEngine/worldBibleCompiler.ts`:

```ts
import type { CanonElement } from "@/lib/canonEngine/types";
import type { WorldEntryValue } from "./worldEntry";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { extractTurn } from "@/lib/canonEngine/extractTurn";

/**
 * Project 3's Stage 5 Compile (issue #50) - the shared Canon Engine's
 * DocumentCompiler slot (ARCHITECTURE.md §2) for the 15-section World
 * Bible schema (sp03-wdc-systemprompt.md §8). Unlike foundationDoc.ts
 * (issue #18) and characterBibleCompiler.ts (issue #34), several of these
 * 15 sections are specified as connected narrative prose, not raw field
 * dumps, and there is no fixed taxonomy anywhere in the data model
 * mapping free-text World Entry categories onto the schema's seven fixed
 * content-lens sections (Geography, Societal Infrastructure, Cultural,
 * Narrative Lore, System Mechanics, Institutions & Artifacts, Linguistic).
 * Design decision (see docs/superpowers/specs/2026-09-13-p3-stage5-compile-design.md,
 * Decision 2): one consolidated grounded LLM call synthesizes all 11
 * prose-bearing fields from the full Confirmed-entry corpus, rather than
 * deterministically re-bucketing each entry's category - the model's
 * synthesis IS the classification-by-theme step here, guarded by an
 * explicit no-fabrication instruction (a prompting control, not a
 * structural one, an accepted and disclosed limitation for this feature).
 */
```

- [ ] **Step 2: Add the entry/dependency description builders**

Add after the header comment. `entryDescriptions` reuses the exact one-line-per-entry grounding format `stage4Audit.ts`'s `runConsistencyCheck` already established, so the two modules never drift on how a Confirmed entry gets described to the model:

```ts
export function buildSynthesisEntryDescriptions(confirmedEntries: CanonElement[]): string {
  if (confirmedEntries.length === 0) return "(None yet.)";
  return confirmedEntries
    .map((e) => {
      const v = e.value as WorldEntryValue | undefined;
      return `- ${v?.name ?? e.element_id} (${v?.category ?? "?"}): ${v?.functionalDescription ?? ""} Governing rules: ${v?.governingRules ?? ""}`;
    })
    .join("\n");
}

/** Real recorded depends_on edges between Confirmed entries, rendered as
 * plain sentences - grounds section 12's systems-thinking synthesis in
 * actual dependency data rather than invented relationships. */
export function buildDependencyEdgeDescriptions(confirmedEntries: CanonElement[]): string {
  const byId = new Map(confirmedEntries.map((e) => [e.element_id, e]));
  const edges: string[] = [];
  for (const e of confirmedEntries) {
    const v = e.value as WorldEntryValue | undefined;
    for (const depId of e.depends_on ?? []) {
      const dep = byId.get(depId);
      const depValue = dep?.value as WorldEntryValue | undefined;
      edges.push(`"${v?.name ?? e.element_id}" depends on "${depValue?.name ?? depId}".`);
    }
  }
  return edges.length ? edges.join("\n") : "No recorded dependencies between Confirmed entries.";
}
```

- [ ] **Step 3: Add the Zod schema and matching Anthropic tool**

Add after Step 2's functions. Follow `stage4Audit.ts`'s established convention of keeping the Zod schema and the `Anthropic.Tool` JSON schema in exact identical field order and naming — every field exists in both:

```ts
const WorldBiblePillarSummarySchema = z.object({
  pillar: z.string().min(1),
  summary: z.string().min(1),
});

export const WorldBibleSynthesisSchema = z.object({
  world_overview_complexity_summary: z.string().min(1),
  world_assumptions_canon_rules: z.string().min(1),
  master_world_pillars: z.array(WorldBiblePillarSummarySchema),
  geography_settings_registry: z.string().min(1),
  societal_infrastructure_manual: z.string().min(1),
  cultural_lived_experience_profiles: z.string().min(1),
  narrative_lore_history: z.string().min(1),
  system_mechanics: z.string().min(1),
  significant_institutions_artifacts: z.string().min(1),
  linguistic_communication_profile: z.string().min(1),
  interconnection_map_systems_synthesis: z.string().min(1),
});

export type WorldBibleSynthesisResult = z.infer<typeof WorldBibleSynthesisSchema>;

const EMIT_WORLD_BIBLE_SYNTHESIS_TOOL: Anthropic.Tool = {
  name: "emit_world_bible_synthesis",
  description:
    "Emit the prose-synthesized sections of a World Bible compile, strictly grounded in the Confirmed World Entries and recorded dependencies provided. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      world_overview_complexity_summary: {
        type: "string",
        description:
          "Max 2 paragraphs summarizing the world's scope, setting type, atmosphere, complexity level, and core pillars - grounded only in the provided entries and pillar list.",
      },
      world_assumptions_canon_rules: {
        type: "string",
        description:
          "Immutable baseline principles - core technological constraints, immutable laws of magic/physics, foundational social assumptions - synthesized and deduplicated from the provided entries' governing rules. Say plainly if no Confirmed entries establish any such rules yet.",
      },
      master_world_pillars: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pillar: { type: "string", description: "Echoes one of the Adopted Pillars listed above, verbatim." },
            summary: {
              type: "string",
              description:
                "A summarized definition of this pillar's core framework, grounded only in the Confirmed entries under it. If this pillar has no Confirmed entries yet, write an honest one-sentence placeholder rather than inventing content.",
            },
          },
          required: ["pillar", "summary"],
        },
        description: "Exactly one entry per pillar listed in the Adopted Pillars section above, in the same order.",
      },
      geography_settings_registry: {
        type: "string",
        description:
          "Principal kingdoms/cities/bases and significant locations - atmosphere, story function, connected characters - grounded only in the provided entries. Say plainly if none apply.",
      },
      societal_infrastructure_manual: {
        type: "string",
        description:
          "Systems map covering government/laws, political/social hierarchies, economic/trade engines, and military frameworks - grounded only in the provided entries. Say plainly if none apply.",
      },
      cultural_lived_experience_profiles: {
        type: "string",
        description:
          "Traditions, customs, taboos, and daily-life mechanics that dictate character choices - grounded only in the provided entries. Say plainly if none apply.",
      },
      narrative_lore_history: {
        type: "string",
        description:
          "Only historical events carrying active cultural memory, inherited trauma, or ongoing political conflict affecting the present plot - grounded only in the provided entries. Say plainly if none apply.",
      },
      system_mechanics: {
        type: "string",
        description:
          "Comprehensive rules, capabilities, costs, hard constraints, and social impact of any technology and/or magic systems - grounded only in the provided entries. Say plainly if none apply.",
      },
      significant_institutions_artifacts: {
        type: "string",
        description:
          "Active organizations (leadership, conflicts, goals) and critical objects/relics (history, ownership, plot function) - grounded only in the provided entries. Say plainly if none apply.",
      },
      linguistic_communication_profile: {
        type: "string",
        description:
          "Naming conventions, communication barriers, or dialects - grounded only in the provided entries. Say plainly if none apply.",
      },
      interconnection_map_systems_synthesis: {
        type: "string",
        description:
          "A systems-thinking breakdown (e.g. 'Economy drives Politics which enforces Culture') grounded strictly in the Recorded Dependencies provided above - never invent a relationship not present in that list. Say plainly if no dependencies are recorded yet.",
      },
    },
    required: [
      "world_overview_complexity_summary",
      "world_assumptions_canon_rules",
      "master_world_pillars",
      "geography_settings_registry",
      "societal_infrastructure_manual",
      "cultural_lived_experience_profiles",
      "narrative_lore_history",
      "system_mechanics",
      "significant_institutions_artifacts",
      "linguistic_communication_profile",
      "interconnection_map_systems_synthesis",
    ],
  },
};
```

- [ ] **Step 4: Add `runWorldBibleSynthesis`**

Add after Step 3's tool definition:

```ts
/**
 * The one consolidated LLM call behind Stage 5 Compile - one call
 * regardless of section count (Decision 2), same cost/latency reasoning
 * #49's runConsistencyCheck already established for its own one-call-not-
 * one-per-check design. Throws on failure (TurnValidationError or a
 * network/rate-limit error from extractTurn) - unlike #49's audit, this
 * runs as an explicit author-triggered action with no "next turn retries
 * it" mechanism, so the caller (worldEngine/worldBibleCompiler.ts's
 * generateWorldBibleDocument, Task 4) lets it propagate as a visible
 * compile failure rather than degrading to a placeholder finding.
 */
export async function runWorldBibleSynthesis(
  anthropic: Anthropic,
  confirmedEntries: CanonElement[],
  pillars: string[]
): Promise<WorldBibleSynthesisResult> {
  const entryDescriptions = buildSynthesisEntryDescriptions(confirmedEntries);
  const dependencyEdges = buildDependencyEdgeDescriptions(confirmedEntries);
  const pillarList = pillars.length > 0 ? pillars.map((p) => `- ${p}`).join("\n") : "(No pillars adopted yet.)";

  return extractTurn({
    anthropic,
    model: "claude-sonnet-5",
    system:
      "You are compiling a fictional world's Confirmed canon into a structured World Bible. Every claim you write MUST trace directly to the Confirmed World Entries and Recorded Dependencies provided below - never invent a world fact, name, or relationship that isn't present in them. Where nothing provided addresses a section's theme, say so plainly (e.g. \"No Confirmed entries currently address this section.\") rather than inventing content to fill it.",
    messages: [
      {
        role: "user",
        content: `Adopted Pillars:\n${pillarList}\n\nConfirmed World Entries:\n${entryDescriptions}\n\nRecorded Dependencies:\n${dependencyEdges}`,
      },
    ],
    tool: EMIT_WORLD_BIBLE_SYNTHESIS_TOOL,
    schema: WorldBibleSynthesisSchema,
    maxTokens: 8192,
  });
}
```

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace `buildSynthesisEntryDescriptions` and `buildDependencyEdgeDescriptions` with a `tsx` script (no API key needed, both are pure):
1. Empty `confirmedEntries` array → `buildSynthesisEntryDescriptions` returns `"(None yet.)"`; `buildDependencyEdgeDescriptions` returns `"No recorded dependencies between Confirmed entries."`.
2. Two constructed `CanonElement`s (`element_id: "e1"`, `value: { name: "The Ember Shrine", category: "Geography", functionalDescription: "...", governingRules: "..." }` and `element_id: "e2"`, `value: { name: "Ashfire Weave", category: "Magic" }`, with `e2.depends_on = ["e1"]`) → confirm `buildSynthesisEntryDescriptions` produces one line per entry in the established `- Name (Category): Description Governing rules: ...` format, and `buildDependencyEdgeDescriptions` produces exactly `"Ashfire Weave" depends on "The Ember Shrine".`.

For `runWorldBibleSynthesis` itself: if a real `ANTHROPIC_API_KEY` is available in the implementing sandbox, run it once with 3-4 constructed Confirmed entries across at least two different pillar names (include one real `depends_on` edge) and confirm the returned `master_world_pillars` array has exactly one entry per pillar name provided, and that the prose sections don't reference any name/fact absent from the input. If no API key is available, trace the function by reading it carefully instead and say so clearly in the report — do not fabricate a model-call test (same disclosed-limitation convention `stage4Audit.ts`'s own Task 3 already established).

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/worldEngine/worldBibleCompiler.ts
git commit -m "feat: add LLM prose-synthesis module for World Bible compile (issue #50)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 3: Deterministic sections, document combiner, and Markdown renderer

**Files:**
- Modify: `web/src/lib/worldEngine/worldBibleCompiler.ts`

**Interfaces:**
- Consumes: `WorldBibleSynthesisResult` (Task 2), `WorldBibleDocument`/`StoredOutstandingQuestion`/`CharacterBibleEntry`/`Story` (`@/lib/canonEngine/storyStore`), `FoundationDocument` (`@/lib/canonEngine/foundationDoc`).
- Produces: `compileWorldBibleDocument(params): WorldBibleDocument`, `renderWorldBibleMarkdown(doc: WorldBibleDocument): string`. Task 4's orchestrator calls both.

- [ ] **Step 1: Add the imports this task needs**

Add to the top of `web/src/lib/worldEngine/worldBibleCompiler.ts`, alongside the existing imports from Task 2:

```ts
import type {
  WorldBibleDocument,
  StoredOutstandingQuestion,
  CharacterBibleEntry,
  Story,
} from "@/lib/canonEngine/storyStore";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";
```

- [ ] **Step 2: Add the deterministic section-13 (Outstanding World Questions) helper**

Add near the bottom of the file, after `runWorldBibleSynthesis`. Merges persisted outstanding questions with every currently-Parked World Entry, deduped by item text — same "Parked never appears anywhere else, but never silently dropped either" posture `foundationDoc.ts`'s own section 12 already established:

```ts
function compileOutstandingWorldQuestions(
  worldEntries: CanonElement[],
  outstanding: StoredOutstandingQuestion[]
): WorldBibleDocument["13_outstanding_world_questions"] {
  const parkedNow = worldEntries
    .filter((e) => e.status === "Parked")
    .map((e) => {
      const v = e.value as WorldEntryValue | undefined;
      return {
        item: `${v?.name ?? e.element_id}: ${v?.functionalDescription || "(no description recorded)"}`,
        notes: "Parked during the World Bible interview; unresolved at compile time.",
        defer_to: "Unassigned" as string,
      };
    });
  const persisted = outstanding.map((q) => ({
    item: q.item,
    notes: q.notes,
    defer_to: q.defer_to ?? "Unassigned",
  }));

  const seen = new Set<string>();
  const merged = [...persisted, ...parkedNow].filter((q) => {
    if (seen.has(q.item)) return false;
    seen.add(q.item);
    return true;
  });

  const groups = new Map<string, { item: string; notes: string }[]>();
  for (const q of merged) {
    const list = groups.get(q.defer_to) ?? [];
    list.push({ item: q.item, notes: q.notes });
    groups.set(q.defer_to, list);
  }
  return Array.from(groups.entries()).map(([defer_to, items]) => ({ defer_to, items }));
}
```

- [ ] **Step 3: Add the deterministic section-14 (Cross-Project Reference Log) helper**

Add immediately after Step 2's function:

```ts
function compileCrossProjectReferenceLog(
  p1Doc: FoundationDocument | null,
  p2Characters: CharacterBibleEntry[]
): WorldBibleDocument["14_cross_project_reference_log"] {
  return {
    project_1: p1Doc
      ? { working_title: p1Doc["1_story_metadata"].working_title, version: p1Doc["1_story_metadata"].version }
      : null,
    project_2: p2Characters.map((c) => ({
      character_name: c.metadata.character_name,
      story_role: c.metadata.story_role,
      canon_status: c.metadata.canon_status,
    })),
  };
}
```

- [ ] **Step 4: Add `compileWorldBibleDocument`**

Add immediately after Step 3's function. Pure — no I/O, matching `compileFoundationDocument`'s and `compileCharacterBibleEntry`'s established shape:

```ts
export function compileWorldBibleDocument(params: {
  story: Story;
  worldEntries: CanonElement[];
  synthesis: WorldBibleSynthesisResult;
  outstanding: StoredOutstandingQuestion[];
  p1Doc: FoundationDocument | null;
  p2Characters: CharacterBibleEntry[];
  version: number;
  versionHistory: { version: string; date: string; summary_of_changes: string }[];
}): WorldBibleDocument {
  const {
    story, worldEntries, synthesis, outstanding, p1Doc, p2Characters, version, versionHistory,
  } = params;

  return {
    schema_version: "1.0",
    "1_document_metadata": {
      story_id: story.id,
      world_bible_version: `v${version}`,
      working_title: story.title,
      date: new Date().toISOString().slice(0, 10),
      status: "Compiled",
      related_project_1_version: p1Doc ? p1Doc["1_story_metadata"].version : "Not yet generated",
      related_project_2_status:
        p2Characters.length > 0
          ? `${p2Characters.length} character${p2Characters.length === 1 ? "" : "s"} signed off`
          : "Not yet available",
    },
    "2_world_overview_complexity_summary": synthesis.world_overview_complexity_summary,
    "3_world_assumptions_canon_rules": synthesis.world_assumptions_canon_rules,
    "4_master_world_pillars": synthesis.master_world_pillars,
    "5_geography_settings_registry": synthesis.geography_settings_registry,
    "6_societal_infrastructure_manual": synthesis.societal_infrastructure_manual,
    "7_cultural_lived_experience_profiles": synthesis.cultural_lived_experience_profiles,
    "8_narrative_lore_history": synthesis.narrative_lore_history,
    "9_system_mechanics": synthesis.system_mechanics,
    "10_significant_institutions_artifacts": synthesis.significant_institutions_artifacts,
    "11_linguistic_communication_profile": synthesis.linguistic_communication_profile,
    "12_interconnection_map_systems_synthesis": synthesis.interconnection_map_systems_synthesis,
    "13_outstanding_world_questions": compileOutstandingWorldQuestions(worldEntries, outstanding),
    "14_cross_project_reference_log": compileCrossProjectReferenceLog(p1Doc, p2Characters),
    "15_version_history": versionHistory,
  };
}
```

- [ ] **Step 5: Add `renderWorldBibleMarkdown`**

Add immediately after Step 4's function. Same `mdValue`/table/list conventions `foundationDoc.ts`'s `renderMarkdown` already established (reimplemented locally, not imported — `foundationDoc.ts`'s `mdValue`/`mdList` are module-private, same reasoning `stage4Audit.ts`'s header comment already gave for reimplementing `sharedWordCount` locally rather than importing a private helper):

```ts
function mdValue(v: string): string {
  return v && v.trim() ? v : "_—_";
}

export function renderWorldBibleMarkdown(doc: WorldBibleDocument): string {
  const m = doc["1_document_metadata"];
  const refLog = doc["14_cross_project_reference_log"];

  const lines: string[] = [
    `# World Bible — ${m.working_title}`,
    "",
    `## 1. Document Metadata`,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Story ID | ${m.story_id} |`,
    `| World Bible Version | ${m.world_bible_version} |`,
    `| Working Title | ${mdValue(m.working_title)} |`,
    `| Date | ${m.date} |`,
    `| Status | ${m.status} |`,
    `| Related Project 1 Version | ${mdValue(m.related_project_1_version)} |`,
    `| Related Project 2 Status | ${mdValue(m.related_project_2_status)} |`,
    "",
    `## 2. World Overview & Complexity Summary`,
    mdValue(doc["2_world_overview_complexity_summary"]),
    "",
    `## 3. High-Level World Assumptions & Canon Rules`,
    mdValue(doc["3_world_assumptions_canon_rules"]),
    "",
    `## 4. Master World Pillars`,
    doc["4_master_world_pillars"].length
      ? doc["4_master_world_pillars"].map((p) => `### ${p.pillar}\n${mdValue(p.summary)}`).join("\n\n")
      : "_No pillars adopted yet._",
    "",
    `## 5. Geography & Settings Registry`,
    mdValue(doc["5_geography_settings_registry"]),
    "",
    `## 6. Societal Infrastructure Manual`,
    mdValue(doc["6_societal_infrastructure_manual"]),
    "",
    `## 7. Cultural & Lived Experience Profiles`,
    mdValue(doc["7_cultural_lived_experience_profiles"]),
    "",
    `## 8. Narrative Lore & History`,
    mdValue(doc["8_narrative_lore_history"]),
    "",
    `## 9. System Mechanics`,
    mdValue(doc["9_system_mechanics"]),
    "",
    `## 10. Significant Institutions & Artifacts`,
    mdValue(doc["10_significant_institutions_artifacts"]),
    "",
    `## 11. Linguistic & Communication Profile`,
    mdValue(doc["11_linguistic_communication_profile"]),
    "",
    `## 12. Interconnection Map & Systems Synthesis`,
    mdValue(doc["12_interconnection_map_systems_synthesis"]),
    "",
    `## 13. Outstanding World Questions`,
    doc["13_outstanding_world_questions"].length
      ? doc["13_outstanding_world_questions"]
          .map(
            (g) =>
              `**${g.defer_to}:**\n` +
              g.items.map((q) => `- ${q.item}${q.notes ? ` — ${q.notes}` : ""}`).join("\n")
          )
          .join("\n\n")
      : "_None — everything resolved._",
    "",
    `## 14. Cross-Project Reference Log`,
    `**Project 1 (Story Foundation):** ${
      refLog.project_1 ? `${refLog.project_1.working_title} (${refLog.project_1.version})` : "_Not yet available._"
    }`,
    `**Project 2 (Character Bible):**`,
    refLog.project_2.length
      ? refLog.project_2.map((c) => `- ${c.character_name} — ${c.story_role} (${c.canon_status})`).join("\n")
      : "_Not yet available._",
    "",
    `## 15. Version History`,
    `| Version | Date | Summary of Changes |`,
    `| --- | --- | --- |`,
    ...doc["15_version_history"].map((v) => `| ${v.version} | ${v.date} | ${v.summary_of_changes} |`),
    "",
  ];

  return lines.join("\n");
}
```

- [ ] **Step 6: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace with a `tsx` script (pure functions, no API key needed):
1. Construct a `WorldBibleSynthesisResult`-shaped object with all 11 fields filled (including `master_world_pillars: [{ pillar: "Geography", summary: "..." }]`), a `Story`-shaped object (`id`, `title`, minimal other required fields), one Confirmed and one Parked `CanonElement` in `worldEntries`, one `StoredOutstandingQuestion`, `p1Doc: null`, `p2Characters: []`, `version: 1`, `versionHistory: []`. Call `compileWorldBibleDocument` and confirm: the Parked entry appears in `13_outstanding_world_questions` grouped under `"Unassigned"` (not lost, not duplicated with the persisted question if their `item` text happens to collide), `14_cross_project_reference_log.project_1` is `null`, `related_project_1_version` is `"Not yet generated"`, `related_project_2_status` is `"Not yet available"`.
2. Same input but `p1Doc` set to a constructed `FoundationDocument`-shaped object and `p2Characters` with 2 entries → confirm `related_project_1_version`/`related_project_2_status` and `14_cross_project_reference_log` both reflect the provided data, and `related_project_2_status` reads `"2 characters signed off"`.
3. Call `renderWorldBibleMarkdown` on both constructed documents from scenarios 1-2 and confirm it doesn't throw, all 15 numbered headers appear in order, and empty-string prose fields render as `_—_` rather than blank lines.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/worldEngine/worldBibleCompiler.ts
git commit -m "feat: add deterministic World Bible sections, document combiner, and Markdown renderer (issue #50)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 4: Async orchestrator — `generateWorldBibleDocument`

**Files:**
- Modify: `web/src/lib/worldEngine/worldBibleCompiler.ts`

**Interfaces:**
- Consumes: `runWorldBibleSynthesis` (Task 2), `compileWorldBibleDocument`/`renderWorldBibleMarkdown` (Task 3), `getStory`/`listOutstandingQuestions`/`listCharacterBibleEntries`/`getLatestWorldBibleVersion`/`listWorldBibleVersions`/`saveWorldBibleVersion`/`StoredWorldBibleVersion` (`@/lib/canonEngine/storyStore`), `listElements`/`WORLD_ENTRIES_COLLECTION` (`@/lib/canonEngine/canonStore`), `listDocumentVersions`/`getDocumentVersion` (`@/lib/canonEngine/foundationDoc`), `normalizeP3` (`@/lib/canonEngine/storyStore`).
- Produces: `generateWorldBibleDocument(storyId): Promise<StoredWorldBibleVersion>`. Task 5's route calls this directly.

- [ ] **Step 1: Add the remaining imports this task needs**

Add to the top of `web/src/lib/worldEngine/worldBibleCompiler.ts`, extending the existing `@/lib/canonEngine/storyStore` import from Task 3 and adding two new import lines:

```ts
import {
  getStory,
  listOutstandingQuestions,
  listCharacterBibleEntries,
  getLatestWorldBibleVersion,
  listWorldBibleVersions,
  saveWorldBibleVersion,
  normalizeP3,
  type StoredWorldBibleVersion,
  type WorldBibleDocument,
  type StoredOutstandingQuestion,
  type CharacterBibleEntry,
  type Story,
} from "@/lib/canonEngine/storyStore";
import { listElements, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { listDocumentVersions, getDocumentVersion } from "@/lib/canonEngine/foundationDoc";
```

(This replaces the narrower `import type { WorldBibleDocument, StoredOutstandingQuestion, CharacterBibleEntry, Story } from "@/lib/canonEngine/storyStore";` line Task 3 added — merge into the one import block above rather than leaving two separate imports from the same module. `Anthropic` itself is already imported as a value in this file from Task 2 (`import Anthropic from "@anthropic-ai/sdk";`) — reuse that same binding for the `new Anthropic(...)` instantiation below, don't add a second import line for it.)

- [ ] **Step 2: Add a local `diffSummary`, matching `foundationDoc.ts`'s algorithm exactly**

Add near the bottom of the file, after `renderWorldBibleMarkdown`. This is a deliberate local copy, not a shared import — `foundationDoc.ts`'s own `diffSummary` is module-private, and this snapshot's shape (World Entries only, not the full "elements" collection) differs enough that a shared generic version isn't worth the indirection for one small pure function:

```ts
type WorldEntriesSnapshot = Record<string, { status: string; value: unknown }>;

function diffSummary(prev: WorldEntriesSnapshot | null, current: WorldEntriesSnapshot): string {
  if (!prev) return "Initial generation.";
  const changes: string[] = [];
  for (const [id, cur] of Object.entries(current)) {
    const old = prev[id];
    if (!old) {
      changes.push(`added ${id}`);
    } else if (JSON.stringify(old.value) !== JSON.stringify(cur.value)) {
      changes.push(`changed ${id}`);
    } else if (old.status !== cur.status) {
      changes.push(`${id}: ${old.status} → ${cur.status}`);
    }
  }
  for (const id of Object.keys(prev)) {
    if (!current[id]) changes.push(`removed ${id}`);
  }
  return changes.length ? changes.join("; ") : "No canon changes since previous version.";
}
```

- [ ] **Step 3: Add `generateWorldBibleDocument`**

Add immediately after Step 2's function:

```ts
/**
 * Generates the next World Bible version for a Story: fetches Confirmed
 * canon and cross-project data, runs the one prose-synthesis call, compiles
 * and renders the document, and persists it as a new immutable version
 * (prior versions are never overwritten - Decision 5). Mirrors
 * generateFoundationDocument's exact orchestration shape (issue #18/#19).
 */
export async function generateWorldBibleDocument(storyId: string): Promise<StoredWorldBibleVersion> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story "${storyId}" not found.`);

  const [worldEntries, outstanding, p1Versions, p2Characters, prior] = await Promise.all([
    listElements(storyId, WORLD_ENTRIES_COLLECTION),
    listOutstandingQuestions(storyId),
    listDocumentVersions(storyId),
    listCharacterBibleEntries(storyId),
    getLatestWorldBibleVersion(storyId),
  ]);

  const p1Doc = p1Versions.length > 0 ? await getDocumentVersion(storyId, p1Versions[p1Versions.length - 1].version) : null;

  const confirmedEntries = worldEntries.filter((e) => e.status === "Confirmed");
  const pillars = normalizeP3(story.p3).pillars ?? [];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const synthesis = await runWorldBibleSynthesis(anthropic, confirmedEntries, pillars);

  const version = (prior?.version ?? 0) + 1;
  const snapshot: WorldEntriesSnapshot = {};
  for (const e of worldEntries) snapshot[e.element_id] = { status: e.status, value: e.value };

  const date = new Date().toISOString().slice(0, 10);
  const summary = diffSummary(prior?.elementsSnapshot ?? null, snapshot);

  const priorHistory = prior
    ? (await listWorldBibleVersions(storyId)).map((v) => ({
        version: `v${v.version}`,
        date: v.date,
        summary_of_changes: v.summary_of_changes,
      }))
    : [];
  const versionHistory = [...priorHistory, { version: `v${version}`, date, summary_of_changes: summary }];

  const json = compileWorldBibleDocument({
    story,
    worldEntries,
    synthesis,
    outstanding,
    p1Doc: p1Doc?.json ?? null,
    p2Characters,
    version,
    versionHistory,
  });
  const markdown = renderWorldBibleMarkdown(json);

  const stored: StoredWorldBibleVersion = {
    version,
    date,
    summary_of_changes: summary,
    json,
    markdown,
    elementsSnapshot: snapshot,
  };
  await saveWorldBibleVersion(storyId, stored);
  return stored;
}
```

Note `compileWorldBibleDocument` is called with `worldEntries: worldEntries` (the full list, both Confirmed and Parked) — not `confirmedEntries` — since `compileOutstandingWorldQuestions` (Task 3, Step 2) needs to see Parked entries too; only `runWorldBibleSynthesis` (Task 2) is scoped to `confirmedEntries` alone.

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

This function does real Firestore/Anthropic I/O, so full end-to-end tracing needs a real story with data (deferred to Task 5's route-level verification, and to manual UI verification in Task 6). At this task's level, confirm by reading the code:
- Every function called (`getStory`, `listElements`, `listOutstandingQuestions`, `listDocumentVersions`, `getDocumentVersion`, `listCharacterBibleEntries`, `getLatestWorldBibleVersion`, `listWorldBibleVersions`, `saveWorldBibleVersion`, `runWorldBibleSynthesis`, `compileWorldBibleDocument`, `renderWorldBibleMarkdown`) exists with the exact signature used here (cross-check against Tasks 1-3 and the existing `foundationDoc.ts`/`storyStore.ts`/`canonStore.ts` exports).
- `p1Doc` resolution: `listDocumentVersions` returns versions ordered ascending by version (confirmed in `foundationDoc.ts`, Step 1's read of that file) — `p1Versions[p1Versions.length - 1]` is therefore the latest, not the first.
- The re-compile path: if `getLatestWorldBibleVersion` returns non-null, `version` increments correctly and `versionHistory` includes every prior version plus the new one, matching `generateFoundationDocument`'s exact same pattern.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/worldEngine/worldBibleCompiler.ts
git commit -m "feat: add generateWorldBibleDocument orchestrator (issue #50)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 5: API routes

**Files:**
- Create: `web/src/app/api/world-chat/document/route.ts`
- Create: `web/src/app/api/world-chat/document/[version]/route.ts`

**Interfaces:**
- Consumes: `generateWorldBibleDocument` (Task 4), `getWorldBibleVersion`/`listWorldBibleVersions`/`getStory` (`@/lib/canonEngine/storyStore`), `getMembership` (`@/lib/workspace/workspaceStore`), `requireUser` (`@/lib/session`), `errorResponse` (`@/lib/apiErrors`).
- Produces: `POST /api/world-chat/document` (body `{ storyId }`) → `{ version, date, summary_of_changes, markdown, json }`, `GET /api/world-chat/document?storyId=...` → `{ versions }`, `GET /api/world-chat/document/[version]?storyId=...` → `{ version, date, summary_of_changes, markdown, json }`. Task 6's UI calls all three.

- [ ] **Step 1: Create `web/src/app/api/world-chat/document/route.ts`**

Follows this project's own `storyId`-in-body/query convention (`world-chat/pillars/route.ts`), not the P1-shaped nested-path convention (`workspaces/[workspaceId]/canvases/[canvasId]/document/route.ts`) — see Global Constraints:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listWorldBibleVersions } from "@/lib/canonEngine/storyStore";
import { generateWorldBibleDocument } from "@/lib/worldEngine/worldBibleCompiler";

export const runtime = "nodejs";

/** Lists World Bible versions for a story (issue #50 - prior versions stay retrievable, same guarantee as issue #19's P1 equivalent). */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const storyId = req.nextUrl.searchParams.get("storyId");
    if (!storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    const versions = await listWorldBibleVersions(storyId);
    return NextResponse.json({ versions });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Compiles the next World Bible version (issue #50). Gated on the Stage 4 System Integration Audit's explicit approval (issue #49) - the real precondition for Stage 5, not a raw stage-number check (Project 3 tracks its own stage per-message, not on Story.currentStage). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    if (!story.p3Stage4Audit?.authorApproved) {
      return NextResponse.json(
        { error: "The World Bible compiles after you approve the Stage 4 System Integration Audit summary." },
        { status: 409 }
      );
    }

    const version = await generateWorldBibleDocument(storyId);
    return NextResponse.json(
      {
        version: version.version,
        date: version.date,
        summary_of_changes: version.summary_of_changes,
        markdown: version.markdown,
        json: version.json,
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Create `web/src/app/api/world-chat/document/[version]/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, getWorldBibleVersion } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/** Fetches one prior World Bible version in full (issue #50, same guarantee as issue #19's P1 equivalent - prior versions remain downloadable). */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/world-chat/document/[version]">
) {
  try {
    const user = await requireUser();
    const { version: versionParam } = await ctx.params;
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "Invalid version number." }, { status: 400 });
    }
    const storyId = req.nextUrl.searchParams.get("storyId");
    if (!storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    const stored = await getWorldBibleVersion(storyId, version);
    if (!stored) {
      return NextResponse.json({ error: `World Bible version ${version} not found.` }, { status: 404 });
    }
    return NextResponse.json({
      version: stored.version,
      date: stored.date,
      summary_of_changes: stored.summary_of_changes,
      markdown: stored.markdown,
      json: stored.json,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 3: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean (this confirms the `RouteContext<"/api/world-chat/document/[version]">` typed-route-context usage matches this Next.js version's convention exactly, the same pattern already proven by `workspaces/[workspaceId]/canvases/[canvasId]/document/[version]/route.ts`).

Manually trace, by reading the code:
1. A `POST` with a `storyId` whose story has `p3Stage4Audit: null` (or `authorApproved: false`) → the 409 branch fires before `generateWorldBibleDocument` is ever called.
2. A `GET .../document` with no `storyId` query param → the 400 branch fires.
3. A `GET .../document/[version]` with a non-numeric `version` segment (e.g. `"abc"`) → `Number("abc")` is `NaN`, `Number.isInteger(NaN)` is `false`, so the 400 branch fires before any Firestore read.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/world-chat/document/route.ts web/src/app/api/world-chat/document/[version]/route.ts
git commit -m "feat: add World Bible compile API routes (issue #50)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 6: UI wiring in `WorldInterview.tsx`

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: the three routes from Task 5, `downloadText` (`@/lib/download`, already imported/used identically by `ChatInterview.tsx`/`CharacterInterview.tsx`), the existing `stage4Audit` state (issue #49) as the gating condition.

The current file has (per issue #49's own work in this file): `stage4Audit` state, an `approveStage4Audit` handler, and a `StageAuditCard` render block inserted right after the `cascadeReview` block in the chat pane's message list. This task adds a sibling block immediately after that `StageAuditCard` block.

- [ ] **Step 1: Add imports and state**

Add `downloadText` to the existing imports (find wherever `useState`/other hooks are imported near the top of the file) — if `web/src/lib/download` isn't already imported in this file, add:

```ts
import { downloadText } from "@/lib/download";
```

Add state near the existing `stage4Audit` declaration:

```ts
  const [worldBibleDoc, setWorldBibleDoc] = useState<{
    version: number;
    date: string;
    summary_of_changes: string;
    markdown: string;
    json: unknown;
  } | null>(null);
  const [worldBibleVersions, setWorldBibleVersions] = useState<{ version: number; date: string; summary_of_changes: string }[]>([]);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState<string | null>(null);
```

- [ ] **Step 2: Hydrate the version list on resume**

In the resume effect (the same `useEffect` Task 5 of issue #49 already extended with `setStage4Audit(...)`), add a fetch for existing World Bible versions right after the existing canvas-load fetch resolves — unconditional on `stage4Audit`, since listing versions is cheap and independent of its hydration timing. The enclosing effect already returns early unless both `workspaceId` and `canvasId` are set (issue #38's original guard), so `canvasId` is guaranteed non-null at this point — no extra guard needed. Add this block immediately after the existing `setStage4Audit(...)` line added by issue #49:

```ts
        try {
          const versionsRes = await fetch(`/api/world-chat/document?storyId=${canvasId}`);
          const versionsData = await versionsRes.json();
          if (versionsRes.ok && Array.isArray(versionsData.versions)) {
            setWorldBibleVersions(versionsData.versions);
          }
        } catch {
          // Non-fatal - the compile panel simply shows no prior versions.
        }
```

- [ ] **Step 3: Add the compile handler**

Add near the existing `approveStage4Audit` function:

```ts
  async function generateWorldBible() {
    if (!canvasId || compiling) return;
    setCompiling(true);
    setCompileError(null);
    try {
      const res = await fetch(`/api/world-chat/document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompileError(data.error ?? "Compile failed.");
        return;
      }
      setWorldBibleDoc(data);
      const versionsRes = await fetch(`/api/world-chat/document?storyId=${canvasId}`);
      const versionsData = await versionsRes.json();
      if (versionsRes.ok && Array.isArray(versionsData.versions)) {
        setWorldBibleVersions(versionsData.versions);
      }
    } catch {
      setCompileError("Couldn't reach the server.");
    } finally {
      setCompiling(false);
    }
  }
```

- [ ] **Step 4: Render the compile panel**

Find the `StageAuditCard` render block issue #49 added (`{stage4Audit && !stage4Audit.authorApproved && (<StageAuditCard .../>)}`). Immediately after it, before the `{error && ...}` block, insert a sibling block gated on approval instead of non-approval:

```tsx
                {stage4Audit?.authorApproved && (
                  <div
                    data-testid="world-bible-compile-card"
                    className="mt-3 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-neutral-900/40 px-4 py-3 text-sm text-neutral-100"
                  >
                    <p className="mb-2 font-semibold text-emerald-200">Stage 5 — World Bible Compile</p>
                    {!worldBibleDoc && (
                      <>
                        <p className="mb-3 text-xs text-neutral-300">
                          Your Confirmed World Entries are ready to compile into the 15-section World Bible.
                        </p>
                        <button
                          onClick={generateWorldBible}
                          disabled={compiling}
                          className="rounded-lg border border-emerald-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {compiling ? "Compiling…" : "Generate World Bible"}
                        </button>
                      </>
                    )}
                    {worldBibleDoc && (
                      <>
                        <p className="mb-3 text-xs text-neutral-300">
                          v{worldBibleDoc.version} · {worldBibleDoc.date} — {worldBibleDoc.summary_of_changes}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() =>
                              downloadText(`world-bible-v${worldBibleDoc.version}.md`, worldBibleDoc.markdown, "text/markdown")
                            }
                            className="rounded-lg border border-emerald-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/40"
                          >
                            Download .md
                          </button>
                          <button
                            onClick={() =>
                              downloadText(
                                `world-bible-v${worldBibleDoc.version}.json`,
                                JSON.stringify(worldBibleDoc.json, null, 2),
                                "application/json"
                              )
                            }
                            className="rounded-lg border border-emerald-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/40"
                          >
                            Download .json
                          </button>
                          <button
                            onClick={generateWorldBible}
                            disabled={compiling}
                            className="rounded-lg border border-emerald-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {compiling ? "Recompiling…" : "Recompile"}
                          </button>
                        </div>
                      </>
                    )}
                    {worldBibleVersions.length > 1 && (
                      <p className="mt-2 text-[11px] text-neutral-500">
                        {worldBibleVersions.length} versions compiled so far.
                      </p>
                    )}
                    {compileError && <p className="mt-2 text-xs text-red-400">{compileError}</p>}
                  </div>
                )}
```

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

For browser verification, follow the same network-mock approach issues #45/#47/#48/#49 used (no Firestore emulator/test credentials in this sandbox): mock `/api/world-chat/document` GET to return `{ versions: [] }` and POST to return a constructed `{ version: 1, date: "...", summary_of_changes: "Initial generation.", markdown: "# World Bible — ...", json: {...} }`, drive the real component with `stage4Audit: { authorApproved: true, ... }`, and confirm: (a) the "Generate World Bible" button appears and is absent when `stage4Audit?.authorApproved` is false or `stage4Audit` is null; (b) clicking it calls the POST route and then shows the version/date/summary plus the two download buttons; (c) the download buttons call `downloadText` with the exact filenames `world-bible-v{n}.md`/`world-bible-v{n}.json` and the correct MIME types. Clearly disclose what you could not verify end-to-end (no real authenticated session/Firestore) rather than fabricating a full test, matching the disclosed-limitation convention issue #49's Task 6 already established for this exact same file.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: add World Bible compile UI to the World Bible interview (issue #50)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
