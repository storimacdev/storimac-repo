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
 *
 * `allEntries` (issue #125) - every World Entry regardless of status,
 * the same list `route.ts` already fetches for the "World Entries So
 * Far" grounding block - is used only to resolve display names and to
 * tell apart two distinct situations `depends_on` can describe:
 *   - the id names a real entry that just isn't Confirmed yet (a
 *     genuine, resolvable Dependency Review item), vs.
 *   - the id doesn't match any entry at all, which `depends_on` being
 *     unvalidated model-authored free text (unlike the nearby
 *     pillar-dependency write, which is checked against
 *     `knownPillarSet`) means is likely a hallucinated or stale
 *     reference rather than a real dependency.
 * Reporting both identically, as raw ids, is what the issue flagged:
 * the author can't tell "fix by confirming X" apart from "this
 * reference may not even point at anything real."
 */
export function checkDependencyCompleteness(
  confirmedEntries: CanonElement[],
  allEntries: CanonElement[]
): Stage4AuditFinding[] {
  const confirmedIds = new Set(confirmedEntries.map((e) => e.element_id));
  const nameById = new Map<string, string>();
  for (const entry of allEntries) {
    const value = entry.value as WorldEntryValue | undefined;
    nameById.set(entry.element_id, value?.name ?? entry.element_id);
  }

  const findings: Stage4AuditFinding[] = [];
  for (const entry of confirmedEntries) {
    const value = entry.value as WorldEntryValue | undefined;
    const deps = entry.depends_on ?? [];
    const unconfirmed = deps.filter((depId) => nameById.has(depId) && !confirmedIds.has(depId));
    const unknown = deps.filter((depId) => !nameById.has(depId));

    if (unconfirmed.length > 0) {
      const names = unconfirmed.map((depId) => nameById.get(depId) ?? depId);
      findings.push({
        id: `dependency-${entry.element_id}`,
        category: "dependency",
        status: "flag",
        detail: `"${value?.name ?? entry.element_id}" depends on ${unconfirmed.length} entr${
          unconfirmed.length > 1 ? "ies" : "y"
        } that aren't Confirmed yet: ${names.join(", ")}.`,
      });
    }
    if (unknown.length > 0) {
      findings.push({
        id: `dependency-unknown-${entry.element_id}`,
        category: "dependency",
        status: "flag",
        detail: `"${value?.name ?? entry.element_id}" depends on ${unknown.length} id${
          unknown.length > 1 ? "s" : ""
        } that don't match any existing World Entry - this may be a hallucinated or stale dependency reference worth double-checking: ${unknown.join(", ")}.`,
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

/**
 * Caps how many individual redundancy findings this check ever returns
 * (issue #123). The scan itself stays O(n^2) in same-category pairs
 * (realistic per-story entry counts keep that cheap enough - see the
 * comment above), but its *output* doesn't: without a cap, a dense
 * same-category entry set (e.g. 50 entries sharing vocabulary) produces
 * up to 1225 findings, all of which get re-injected into the system
 * prompt's grounding block every turn until approval AND persisted on
 * the Story document against Firestore's 1 MiB limit - unlike every
 * other grounding block in `world-chat/route.ts`, which is linear and
 * bounded by construction. Findings are ranked by overlap strength
 * (strongest signal first) before truncating, so a cap never silently
 * drops the most meaningful overlaps in favor of weaker ones that
 * happened to be found earlier in iteration order.
 */
const MAX_REDUNDANCY_FINDINGS = 20;

export function checkRedundancy(confirmedEntries: CanonElement[]): Stage4AuditFinding[] {
  const scored: { finding: Stage4AuditFinding; overlap: number }[] = [];
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
          scored.push({
            overlap,
            finding: {
              id: `redundancy-${entries[i].element_id}-${entries[j].element_id}`,
              category: "redundancy",
              status: "flag",
              detail: `"${a?.name ?? entries[i].element_id}" and "${b?.name ?? entries[j].element_id}" (both ${category}) share ${overlap} concepts in their descriptions - consider whether they should be merged or more clearly differentiated.`,
            },
          });
        }
      }
    }
  }

  if (scored.length === 0) {
    return [
      {
        id: "redundancy-none",
        category: "redundancy",
        status: "pass",
        detail: "No significant overlap found between same-category Confirmed entries.",
      },
    ];
  }

  scored.sort((a, b) => b.overlap - a.overlap);
  const kept = scored.slice(0, MAX_REDUNDANCY_FINDINGS).map((s) => s.finding);
  const omitted = scored.length - kept.length;
  if (omitted > 0) {
    kept.push({
      id: "redundancy-more",
      category: "redundancy",
      status: "flag",
      detail: `...and ${omitted} more overlapping pair${
        omitted > 1 ? "s" : ""
      } not shown above (showing the ${MAX_REDUNDANCY_FINDINGS} strongest overlaps).`,
    });
  }
  return kept;
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

/**
 * Renders the audit as the author-facing summary text (mirrors Stage
 * 7's formatAuditSummary rendering convention).
 *
 * `mode: "full"` (default) renders every finding - pass, flag, and
 * skipped alike - and is what the UI's author-facing card needs to show
 * the complete picture. `mode: "flagsOnly"` renders only flag-status
 * findings (issue #123): used for the system prompt's grounding block,
 * which gets re-injected on every turn until the author approves, so
 * routinely restating pass lines the model doesn't need to act on only
 * dilutes that budget without adding anything actionable.
 *
 * Defensively tolerates a non-array `findings` (issue #126) - no writer
 * in this codebase produces that today (`setP3Stage4Audit` is the only
 * one), but a future migration or a manual Firestore repair could leave
 * a legacy/malformed shape behind, and this is reached from the
 * grounding-block call site in `world-chat/route.ts` with no local
 * try/catch around it.
 */
export function formatStage4AuditSummary(audit: P3Stage4Audit, mode: "full" | "flagsOnly" = "full"): string {
  const allFindings = Array.isArray(audit.findings) ? audit.findings : [];
  const toRender = mode === "flagsOnly" ? allFindings.filter((f) => f.status === "flag") : allFindings;
  const lines: string[] = ["System Integration Audit complete. Here's what I found:", ""];
  if (toRender.length === 0) {
    lines.push("✅ No outstanding flags - every check passed or had nothing to check yet.");
  } else {
    for (const f of toRender) {
      const mark = f.status === "pass" ? "✅" : f.status === "flag" ? "⚠️" : "⏭️";
      lines.push(`${mark} ${f.detail}`);
    }
  }
  lines.push(
    "",
    "Let me know if you'd like to address any flags, or give an explicit approval so we can move on to compiling your World Bible."
  );
  return lines.join("\n");
}
