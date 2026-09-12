import type { CanonElement } from "@/lib/canonEngine/types";
import type { Stage4AuditFinding } from "@/lib/canonEngine/storyStore";
import type { WorldEntryValue } from "./worldEntry";

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
