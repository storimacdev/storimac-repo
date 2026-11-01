import type { CanonElement } from "@/lib/canonEngine/types";
import type { WorldEntryValue } from "./worldEntry";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { extractTurn } from "@/lib/canonEngine/extractTurn";
import {
  getStory,
  listOutstandingQuestions,
  listCharacterBibleEntries,
  saveNextWorldBibleVersion,
  normalizeP3,
  type StoredWorldBibleVersion,
  type WorldBibleDocument,
  type StoredOutstandingQuestion,
  type CharacterBibleEntry,
  type Story,
} from "@/lib/canonEngine/storyStore";
import { listElements, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { listDocumentVersions, getDocumentVersion } from "@/lib/canonEngine/foundationDoc";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";

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

// Issue #128: the grounding block fed into runWorldBibleSynthesis had no
// cap, risking the shared Anthropic rate-limit gate's ITPM ceiling
// (anthropicGate.ts, default 200k) at large canon sizes - and unlike a
// per-turn budget problem, a compile that exceeds it can never succeed
// until the canon shrinks, so this caps rather than merely bounds growth.
// FIELD_CHAR_BUDGET mirrors character-chat/route.ts's truncateFactValue
// (issue #107); the entry/edge count caps mirror the "...and N more" note
// issue #123 suggested for its own redundancy-check block. Worst case at
// the caps below (~200 tokens/entry x 300 entries + ~15 tokens/edge x 500
// edges =~ 67.5k tokens) stays comfortably under the 200k ITPM ceiling
// alongside the rest of the prompt.
const ENTRY_FIELD_CHAR_BUDGET = 200;
const MAX_SYNTHESIS_ENTRIES = 300;
const MAX_DEPENDENCY_EDGES = 500;

function truncateEntryField(text: string): string {
  return text.length > ENTRY_FIELD_CHAR_BUDGET ? `${text.slice(0, ENTRY_FIELD_CHAR_BUDGET)}…` : text;
}

export function buildSynthesisEntryDescriptions(confirmedEntries: CanonElement[]): string {
  if (confirmedEntries.length === 0) return "(None yet.)";
  const included = confirmedEntries.slice(0, MAX_SYNTHESIS_ENTRIES);
  const lines = included.map((e) => {
    const v = e.value as WorldEntryValue | undefined;
    return `- ${v?.name ?? e.element_id} (${v?.category ?? "?"}): ${truncateEntryField(v?.functionalDescription ?? "")} Governing rules: ${truncateEntryField(v?.governingRules ?? "")}`;
  });
  const omitted = confirmedEntries.length - included.length;
  if (omitted > 0) lines.push(`...and ${omitted} more Confirmed entries not shown.`);
  return lines.join("\n");
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
  if (edges.length === 0) return "No recorded dependencies between Confirmed entries.";
  if (edges.length <= MAX_DEPENDENCY_EDGES) return edges.join("\n");
  const omitted = edges.length - MAX_DEPENDENCY_EDGES;
  return [...edges.slice(0, MAX_DEPENDENCY_EDGES), `...and ${omitted} more recorded dependencies not shown.`].join(
    "\n"
  );
}

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

/**
 * Issue #131 - `master_world_pillars` is a bare array with no `.min(1)` in
 * the base schema above, so a synthesis call that returns zero pillar
 * entries passes validation cleanly even when pillars were adopted. The
 * grounding prompt below always lists the adopted pillars (Decision 2), so
 * when `pillarCount > 0`, a zero-length result is a sign the call went
 * wrong, not a legitimate answer - adding `.min(1)` here makes
 * `extractTurn`'s retry loop re-attempt it. Deliberately NOT applied when
 * `pillarCount === 0`: an empty array is the only correct response for a
 * story with no adopted pillars yet (`p3.pillars` is `null` or `[]`, both
 * normalized to `[]` by `normalizeP3` - see storyStore.ts), and an
 * unconditional `.min(1)` would retry-loop that legitimate case to a hard
 * `TurnValidationError` on every zero-pillar compile.
 */
export function buildWorldBibleSynthesisSchema(pillarCount: number): z.ZodType<WorldBibleSynthesisResult> {
  return pillarCount > 0
    ? WorldBibleSynthesisSchema.extend({
        master_world_pillars: z.array(WorldBiblePillarSummarySchema).min(1),
      })
    : WorldBibleSynthesisSchema;
}

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
 *
 * Issue #127 - maxTokens: extractTurn.ts's header comment advises keeping
 * a tool schema's long free-text field(s) ordered last in
 * properties/required so a mid-JSON truncation drops only the free-text
 * tail; that advice can't help here, because all 11 required fields on
 * EMIT_WORLD_BIBLE_SYNTHESIS_TOOL are long-form prose - there is no
 * "short required fields first" ordering to protect, so any truncation
 * corrupts the whole payload regardless of field order. Of the issue's
 * three options (raise maxTokens / split into two calls / document the
 * limitation), raising is the one applied below: Claude Sonnet 5 supports
 * up to 128K output tokens, so 8192 had enormous headroom to spare, and
 * splitting the call would be a real change to Decision 2's "one
 * consolidated call" architecture (needing its own design pass, not a
 * silent code change) for a problem a larger budget already solves.
 * 24000 (not closer to the 128K ceiling) is chosen because this call
 * reserves its full maxTokens against the shared gate's OTPM ceiling
 * (anthropicGate.ts, default 60000 output-tokens-per-minute) for the
 * duration of the call - a much larger value would eat most or all of
 * that shared budget on one request. 24000 is already ~3x the old
 * budget and comfortable headroom over a worst-case rich-world estimate
 * (11 prose sections + a per-pillar array), while a compile remains a
 * rare, explicit, author-triggered action rather than a per-turn cost, so
 * reserving well under half the OTPM budget for its duration is
 * acceptable.
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
    schema: buildWorldBibleSynthesisSchema(pillars.length),
    maxTokens: 24000,
  });
}

/**
 * Section 13 (Outstanding World Questions) - merges persisted outstanding
 * questions with every currently-Parked World Entry, deduped by item text.
 * Same "Parked never appears anywhere else, but never silently dropped
 * either" posture foundationDoc.ts's own section 12 already established.
 */
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

/** Section 14 (Cross-Project Reference Log) - pure template-fill from P1's compiled document and P2's signed-off characters, no fabrication. */
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

/**
 * Combines the LLM-synthesized prose sections (Task 2's runWorldBibleSynthesis
 * output) with the deterministic template-fill sections into one complete
 * WorldBibleDocument. Pure - no I/O, matching compileFoundationDocument's and
 * compileCharacterBibleEntry's established shape.
 */
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

function mdValue(v: string): string {
  if (!v || !v.trim()) return "_—_";
  // Escape any line that would otherwise render as its own Markdown ATX
  // heading (e.g. synthesized prose that happens to contain text like
  // "## 7. Foo" verbatim) - issue #51's structure-lint scans exactly
  // this pattern to verify the document's real section headers, so an
  // accidental heading-looking line inside prose content must never be
  // indistinguishable from a genuine one.
  return v.replace(/^(#{1,6})(\s)/gm, "\\$1$2");
}

/** Pure Markdown renderer for a compiled WorldBibleDocument - same mdValue/table/list conventions foundationDoc.ts's renderMarkdown already established (reimplemented locally, not imported - foundationDoc.ts's mdValue/mdList are module-private). */
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
      ? doc["4_master_world_pillars"].map((p) => `### ${mdValue(p.pillar)}\n${mdValue(p.summary)}`).join("\n\n")
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
              g.items.map((q) => `- ${mdValue(q.item)}${q.notes ? ` — ${mdValue(q.notes)}` : ""}`).join("\n")
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
      ? refLog.project_2.map((c) => `- ${mdValue(c.character_name)} — ${c.story_role} (${c.canon_status})`).join("\n")
      : "_Not yet available._",
    "",
    `## 15. Version History`,
    `| Version | Date | Summary of Changes |`,
    `| --- | --- | --- |`,
    ...doc["15_version_history"].map((v) => `| ${v.version} | ${v.date} | ${mdValue(v.summary_of_changes)} |`),
    "",
  ];

  return lines.join("\n");
}

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

/**
 * Generates the next World Bible version for a Story: fetches Confirmed
 * canon and cross-project data, runs the one prose-synthesis call, compiles
 * and renders the document, and persists it as a new immutable version
 * (prior versions are never overwritten - Decision 5). Mirrors
 * generateFoundationDocument's exact orchestration shape (issue #18/#19),
 * including its issue #129 fix: the slow, external work (the Anthropic
 * synthesis call and the cross-project/canon reads below) all happens
 * before the version number is ever read, and the version read + compute
 * + write happens atomically in saveNextWorldBibleVersion - two concurrent
 * compiles for the same story can no longer both read the same prior
 * version and silently clobber one another's write.
 */
export async function generateWorldBibleDocument(storyId: string): Promise<StoredWorldBibleVersion> {
  const story = await getStory(storyId);
  if (!story) throw new Error(`Story "${storyId}" not found.`);

  const [worldEntries, outstanding, p1Versions, p2Characters] = await Promise.all([
    listElements(storyId, WORLD_ENTRIES_COLLECTION),
    listOutstandingQuestions(storyId),
    listDocumentVersions(storyId),
    listCharacterBibleEntries(storyId),
  ]);

  const p1Doc = p1Versions.length > 0 ? await getDocumentVersion(storyId, p1Versions[p1Versions.length - 1].version) : null;

  const confirmedEntries = worldEntries.filter((e) => e.status === "Confirmed");
  const pillars = normalizeP3(story.p3).pillars ?? [];

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const synthesis = await runWorldBibleSynthesis(anthropic, confirmedEntries, pillars);

  const snapshot: WorldEntriesSnapshot = {};
  for (const e of worldEntries) snapshot[e.element_id] = { status: e.status, value: e.value };
  const date = new Date().toISOString().slice(0, 10);

  return saveNextWorldBibleVersion(storyId, (prior, priorHistory) => {
    const version = (prior?.version ?? 0) + 1;
    const summary = diffSummary(prior?.elementsSnapshot ?? null, snapshot);
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

    return {
      version,
      date,
      summary_of_changes: summary,
      json,
      markdown,
      elementsSnapshot: snapshot,
      confirmed: false,
      confirmedAt: null,
    };
  });
}
