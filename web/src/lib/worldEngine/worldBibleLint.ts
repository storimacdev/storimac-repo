import { z } from "zod";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

/**
 * Structure-lint for a compiled World Bible document (issue #51, PRD §2.3's
 * success metric: "100% of compiled World Bible documents conform to the
 * 15-section output schema ... and pass an automated structure-lint before
 * being marked Confirmed"). TypeScript already guarantees a FRESHLY
 * compiled document's shape at author-time (worldBibleCompiler.ts's
 * compileWorldBibleDocument builds a typed object literal) - this lint's
 * real job is validating a document loaded back out of Firestore, where
 * `snap.data() as StoredWorldBibleVersion` is a compile-time assertion
 * with zero runtime guarantee. See the design doc
 * (docs/superpowers/specs/2026-09-13-p3-structure-lint-design.md) for the
 * full reasoning, including why order/headers are checked separately from
 * the Zod schema itself.
 */

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
  "1_document_metadata",
  "2_world_overview_complexity_summary",
  "3_world_assumptions_canon_rules",
  "4_master_world_pillars",
  "5_geography_settings_registry",
  "6_societal_infrastructure_manual",
  "7_cultural_lived_experience_profiles",
  "8_narrative_lore_history",
  "9_system_mechanics",
  "10_significant_institutions_artifacts",
  "11_linguistic_communication_profile",
  "12_interconnection_map_systems_synthesis",
  "13_outstanding_world_questions",
  "14_cross_project_reference_log",
  "15_version_history",
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

/** `WORLD_BIBLE_SECTION_ORDER` and `WORLD_BIBLE_MARKDOWN_HEADERS` are
 * index-aligned (both list all 15 sections in the same order) - this
 * looks up a JSON key's human-readable "N. Title" label for error
 * messages, e.g. "5_geography_settings_registry" -> "5. Geography &
 * Settings Registry". */
function sectionLabel(key: string): string {
  const idx = WORLD_BIBLE_SECTION_ORDER.indexOf(key as (typeof WORLD_BIBLE_SECTION_ORDER)[number]);
  if (idx === -1) return key;
  const header = WORLD_BIBLE_MARKDOWN_HEADERS[idx];
  return `${header.n}. ${header.title}`;
}

export function lintWorldBibleDocument(doc: unknown): { valid: boolean; errors: string[] } {
  const parsed = WorldBibleDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const key = typeof issue.path[0] === "string" ? issue.path[0] : "document";
      return `${sectionLabel(key)}: ${issue.message}`;
    });
    return { valid: false, errors };
  }

  // Firestore maps have no guaranteed key order - the backend's own
  // comparator treats it as insignificant, and a document loaded back
  // via snap.data() cannot be trusted to preserve JS insertion order,
  // even though an in-memory object literal (what every unit trace in
  // this codebase constructs) always does. So this checks SECTION
  // MEMBERSHIP, not key order. The AC's "in the correct order"
  // requirement is enforced instead by lintWorldBibleMarkdown, against
  // the rendered Markdown's real header sequence - a plain string,
  // immune to this problem.
  const actualKeys = Object.keys(doc as Record<string, unknown>).filter((k) => k !== "schema_version");
  const expectedKeySet = new Set<string>(WORLD_BIBLE_SECTION_ORDER);
  const unexpected = actualKeys.filter((k) => !expectedKeySet.has(k));
  if (unexpected.length > 0) {
    return { valid: false, errors: [`Unexpected section key(s) found: ${unexpected.join(", ")}.`] };
  }

  return { valid: true, errors: [] };
}

export function lintWorldBibleMarkdown(markdown: unknown): { valid: boolean; errors: string[] } {
  if (typeof markdown !== "string") {
    return { valid: false, errors: ["The rendered Markdown is missing or invalid."] };
  }
  const headerLines = markdown
    .split("\n")
    .map((line) => line.match(/^## (\d+)\. (.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ n: Number(m[1]), title: m[2].trim() }));

  const errors: string[] = [];
  if (headerLines.length !== WORLD_BIBLE_MARKDOWN_HEADERS.length) {
    errors.push(
      `Expected ${WORLD_BIBLE_MARKDOWN_HEADERS.length} numbered section headers, found ${headerLines.length}.`
    );
  }

  const checkCount = Math.min(headerLines.length, WORLD_BIBLE_MARKDOWN_HEADERS.length);
  for (let i = 0; i < checkCount; i++) {
    const expected = WORLD_BIBLE_MARKDOWN_HEADERS[i];
    const actual = headerLines[i];
    if (actual.n !== expected.n || actual.title !== expected.title) {
      errors.push(
        `Section ${i + 1}: expected "## ${expected.n}. ${expected.title}", found "## ${actual.n}. ${actual.title}".`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
