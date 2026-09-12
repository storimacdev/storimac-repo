import type { CanonElement } from "@/lib/canonEngine/types";
import type { Stage4AuditFinding } from "@/lib/canonEngine/storyStore";
import type { WorldEntryValue } from "./worldEntry";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { extractTurn } from "@/lib/canonEngine/extractTurn";
import type { P3Stage4Audit } from "@/lib/canonEngine/storyStore";

/**
 * Project 3's Stage 4 System Integration Audit (issue #49) - computes
 * the rules-based half of the audit (this file) and, once a later task
 * lands, the model-driven consistency pass (same file). Mirrors the
 * *pattern* Project 1's Stage 7 Creative Audit established (canonEngine/
 * stage7Audit.ts) - compute → persist → gate next stage on explicit
 * author approval - but none of that file's code, since it's hardcoded
 * to Project 1's own fixed-pair element comparisons and has no
 * generic stage-gate P3 could plug into. See the design doc
 * (docs/superpowers/specs/2026-09-12-p3-stage4-audit-design.md) for the
 * full reasoning, including why "unresolved Dependency Review items"
 * (AC) is answered here as a live recomputation rather than a
 * historical-flag lookup.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "will", "would", "that", "this",
  "it", "its", "his", "her", "their", "they", "he", "she", "who", "what",
  "when", "where", "how", "why", "does", "do", "not", "no", "can", "must",
]);

function contentWords(value: unknown): Set<string> {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

/** Overlap of meaningful words - same technique as Stage 7's own
 * sharedWordCount, reimplemented locally rather than imported (that
 * function is private to canonEngine/stage7Audit.ts). */
function sharedWordCount(a: unknown, b: unknown): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n;
}

/**
 * Every Confirmed entry whose depends_on includes an id that isn't
 * itself Confirmed - this is the AC's "unresolved Dependency Review
 * items" line, made concrete as a live graph check (see this file's
 * header comment for why).
 */
export function checkDependencyCompleteness(confirmedEntries: CanonElement[]): Stage4AuditFinding[] {
  const confirmedIds = new Set(confirmedEntries.map((e) => e.element_id));
  const findings: Stage4AuditFinding[] = [];
  for (const entry of confirmedEntries) {
    const value = entry.value as WorldEntryValue | undefined;
    const unresolvedDeps = (entry.depends_on ?? []).filter((depId) => !confirmedIds.has(depId));
    if (unresolvedDeps.length > 0) {
      findings.push({
        id: `dependency-${entry.element_id}`,
        category: "dependency",
        status: "flag",
        detail: `"${value?.name ?? entry.element_id}" depends on ${unresolvedDeps.length} entr${
          unresolvedDeps.length > 1 ? "ies" : "y"
        } that aren't Confirmed yet: ${unresolvedDeps.join(", ")}.`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "dependency-complete",
      category: "dependency",
      status: "pass",
      detail: "Every Confirmed entry's dependencies are themselves Confirmed - no unresolved Dependency Review items.",
    });
  }
  return findings;
}

/**
 * Pairwise shared-word overlap between same-category Confirmed entries'
 * functionalDescription - bounded to same-category pairs (realistic
 * per-story entry counts are in the tens, not thousands, so this stays
 * cheap). Threshold is deliberately higher than Stage 7's own overlap>=1
 * (which compares exactly two fixed, expected-to-be-linked elements) -
 * this scans arbitrary pairs across a potentially large entry set, so a
 * much stronger signal is needed to avoid false-positive flooding.
 */
const REDUNDANCY_OVERLAP_THRESHOLD = 4;

export function checkRedundancy(confirmedEntries: CanonElement[]): Stage4AuditFinding[] {
  const findings: Stage4AuditFinding[] = [];
  const byCategory = new Map<string, CanonElement[]>();
  for (const entry of confirmedEntries) {
    const value = entry.value as WorldEntryValue | undefined;
    const category = value?.category ?? "(uncategorized)";
    const list = byCategory.get(category) ?? [];
    list.push(entry);
    byCategory.set(category, list);
  }
  for (const [category, entries] of byCategory) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i].value as WorldEntryValue | undefined;
        const b = entries[j].value as WorldEntryValue | undefined;
        const overlap = sharedWordCount(a?.functionalDescription, b?.functionalDescription);
        if (overlap >= REDUNDANCY_OVERLAP_THRESHOLD) {
          findings.push({
            id: `redundancy-${entries[i].element_id}-${entries[j].element_id}`,
            category: "redundancy",
            status: "flag",
            detail: `"${a?.name ?? entries[i].element_id}" and "${b?.name ?? entries[j].element_id}" (both ${category}) share ${overlap} concepts in their descriptions - consider whether they should be merged or more clearly differentiated.`,
          });
        }
      }
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "redundancy-none",
      category: "redundancy",
      status: "pass",
      detail: "No significant overlap found between same-category Confirmed entries.",
    });
  }
  return findings;
}

const Stage4ConsistencyFindingSchema = z.object({
  category: z.enum(["physical", "economic", "historical", "narrative"]),
  detail: z.string().min(1),
});

const Stage4ConsistencySchema = z.object({
  findings: z.array(Stage4ConsistencyFindingSchema),
});

const EMIT_STAGE4_CONSISTENCY_TOOL: Anthropic.Tool = {
  name: "emit_stage4_consistency_findings",
  description:
    "Report any physical, economic, historical, or narrative consistency problems you found across the Confirmed World Entries provided. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: ["physical", "economic", "historical", "narrative"],
              description: "Which kind of consistency problem this is.",
            },
            detail: {
              type: "string",
              description: "A specific, concrete description of the contradiction or inconsistency, naming the entries involved.",
            },
          },
          required: ["category", "detail"],
        },
        description: "Every consistency problem you found. Empty array if none.",
      },
    },
    required: ["findings"],
  },
};

/**
 * The one part of this audit with no rules-based precedent to lean on
 * (see this file's header comment) - a single one-shot extractTurn call,
 * not a conversational turn, reviewing all Confirmed entries together
 * for contradictions a word-overlap heuristic can't meaningfully detect.
 * Runs once per audit computation, not per chat turn.
 */
export async function runConsistencyCheck(
  anthropic: Anthropic,
  confirmedEntries: CanonElement[]
): Promise<Stage4AuditFinding[]> {
  if (confirmedEntries.length === 0) {
    return [
      {
        id: "consistency-empty",
        category: "consistency",
        status: "skipped",
        detail: "No Confirmed entries yet to check.",
      },
    ];
  }

  const entryDescriptions = confirmedEntries
    .map((e) => {
      const v = e.value as WorldEntryValue | undefined;
      return `- ${v?.name ?? e.element_id} (${v?.category ?? "?"}): ${v?.functionalDescription ?? ""} Governing rules: ${v?.governingRules ?? ""}`;
    })
    .join("\n");

  const result = await extractTurn({
    anthropic,
    model: "claude-sonnet-5",
    system:
      "You are auditing a fictional world's Confirmed canon for internal consistency. Review the entries below and report any physical, economic, historical, or narrative contradictions between them - not stylistic opinions, only genuine logical inconsistencies.",
    messages: [{ role: "user", content: `Confirmed World Entries:\n${entryDescriptions}` }],
    tool: EMIT_STAGE4_CONSISTENCY_TOOL,
    schema: Stage4ConsistencySchema,
  });

  if (result.findings.length === 0) {
    return [
      {
        id: "consistency-clean",
        category: "consistency",
        status: "pass",
        detail: "No physical, economic, historical, or narrative contradictions found across Confirmed entries.",
      },
    ];
  }

  return result.findings.map((f, i) => ({
    id: `consistency-${i}`,
    category: "consistency" as const,
    status: "flag" as const,
    detail: `[${f.category}] ${f.detail}`,
  }));
}

/** Renders the audit as the author-facing summary text (mirrors Stage
 * 7's formatAuditSummary rendering convention). */
export function formatStage4AuditSummary(audit: P3Stage4Audit): string {
  const lines: string[] = ["System Integration Audit complete. Here's what I found:", ""];
  for (const f of audit.findings) {
    const mark = f.status === "pass" ? "✅" : f.status === "flag" ? "⚠️" : "⏭️";
    lines.push(`${mark} ${f.detail}`);
  }
  lines.push(
    "",
    "Let me know if you'd like to address any flags, or give an explicit approval so we can move on to compiling your World Bible."
  );
  return lines.join("\n");
}
