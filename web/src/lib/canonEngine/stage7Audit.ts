import type { CanonElement } from "./types";

/**
 * Stage 7 — Creative Audit & Pitfall Check — GitHub issue #17, PRD §5.8.
 * System-run validation, not a free-form question stage. The app runs these
 * checks programmatically when the Project enters Stage 7 and shows the
 * author a pass/flag summary; Stage 8 stays locked until the author responds
 * (enforced in /api/chat's stage-advance path via Story.stage7Audit).
 *
 * The Common Mistakes cross-check (third PRD bullet) needs the diagnosed
 * format's Common Mistakes list from the 101 Story Formats retrieval index —
 * that's M3 (issues #14-#16), whose source document isn't available yet.
 * `commonMistakes` is accepted as an injectable input here so M3 can plug in
 * without touching this module; until then it's empty and the summary says
 * the check was skipped, never that it passed.
 */

export interface AuditCheck {
  id: string;
  name: string;
  status: "pass" | "flag" | "skipped";
  detail: string;
}

export interface Stage7AuditResult {
  checks: AuditCheck[];
  /** Common-Mistake yes/no/unsure prompts for the author (never verdicts). */
  commonMistakePrompts: string[];
  generatedAt: string;
  /** Set once the author replies to the summary; gates Stage 8 entry. */
  authorResponded: boolean;
}

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

/** Overlap of meaningful words — the "explicit link" heuristic. */
function sharedWordCount(a: unknown, b: unknown): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  let n = 0;
  for (const w of wa) if (wb.has(w)) n++;
  return n;
}

export function runStage7Audit(
  elements: CanonElement[],
  commonMistakes: string[] = []
): Stage7AuditResult {
  const byId = new Map(elements.map((e) => [e.element_id, e]));
  const confirmed = (id: string) => {
    const e = byId.get(id);
    return e && e.status === "Confirmed" ? e : null;
  };

  const checks: AuditCheck[] = [];

  // Check 1 — Climax answers the Core Dramatic Question (PRD §5.8 bullet 1).
  const climax = confirmed("climax");
  const cdq = confirmed("core_dramatic_question");
  if (!climax || !cdq) {
    checks.push({
      id: "climax_answers_cdq",
      name: "Climax answers the Core Dramatic Question",
      status: "flag",
      detail: !climax
        ? "The Climax is not Confirmed yet, so the link cannot be verified."
        : "The Core Dramatic Question is not Confirmed yet, so the link cannot be verified.",
    });
  } else {
    const overlap = sharedWordCount(climax.value, cdq.value);
    checks.push({
      id: "climax_answers_cdq",
      name: "Climax answers the Core Dramatic Question",
      status: overlap >= 1 ? "pass" : "flag",
      detail:
        overlap >= 1
          ? `Explicit link found (${overlap} shared concept${overlap > 1 ? "s" : ""} between Climax and Core Dramatic Question).`
          : "No explicit link found between the Climax and the Core Dramatic Question — they share no key concepts. Worth confirming the climax actually resolves the question.",
    });
  }

  // Check 2 — Transformation Arc aligns with the Theme Statement (bullet 2).
  const arc = confirmed("transformation_arc");
  const theme = confirmed("theme_statement");
  if (!arc || !theme) {
    checks.push({
      id: "arc_aligns_theme",
      name: "Transformation Arc aligns with the Theme Statement",
      status: "flag",
      detail: !arc
        ? "The Transformation Arc is not Confirmed yet, so alignment cannot be verified."
        : "The Theme Statement is not Confirmed yet, so alignment cannot be verified.",
    });
  } else {
    const overlap = sharedWordCount(arc.value, theme.value);
    checks.push({
      id: "arc_aligns_theme",
      name: "Transformation Arc aligns with the Theme Statement",
      status: overlap >= 1 ? "pass" : "flag",
      detail:
        overlap >= 1
          ? `Alignment found (${overlap} shared concept${overlap > 1 ? "s" : ""} between the Arc and the Theme Statement).`
          : "The Transformation Arc and the Theme Statement share no key concepts — the character's change may not be expressing the theme.",
    });
  }

  // Check 3 — Common Mistakes cross-check (bullet 3). M3-dependent; when the
  // list is empty the check reports skipped, never a silent pass.
  if (commonMistakes.length === 0) {
    checks.push({
      id: "common_mistakes",
      name: "Common Mistakes cross-check (diagnosed format)",
      status: "skipped",
      detail:
        "The 101 Story Formats reference library isn't loaded yet, so the diagnosed format's Common Mistakes list is unavailable. This check will run once the format library is installed.",
    });
  } else {
    checks.push({
      id: "common_mistakes",
      name: "Common Mistakes cross-check (diagnosed format)",
      status: "pass",
      detail: `${commonMistakes.length} known pitfall${commonMistakes.length > 1 ? "s" : ""} for this format surfaced below as questions for you — the system never asserts a verdict on these.`,
    });
  }

  return {
    checks,
    commonMistakePrompts: commonMistakes.map(
      (m) => `Does your story avoid this known pitfall — ${m}? (yes / no / unsure)`
    ),
    generatedAt: new Date().toISOString(),
    authorResponded: false,
  };
}

/** Renders the audit as the author-facing summary message (PRD: "short pass/fail-per-check summary"). */
export function formatAuditSummary(audit: Stage7AuditResult): string {
  const lines: string[] = [
    "Creative Audit complete. Here's what I checked:",
    "",
  ];
  for (const c of audit.checks) {
    const mark = c.status === "pass" ? "✅" : c.status === "flag" ? "⚠️" : "⏭️";
    lines.push(`${mark} **${c.name}** — ${c.detail}`);
  }
  if (audit.commonMistakePrompts.length) {
    lines.push("", "A few pitfalls known for your format — your call on each:");
    for (const p of audit.commonMistakePrompts) lines.push(`- ${p}`);
  }
  lines.push(
    "",
    "Reply with your thoughts on any flags (or just confirm you're happy to proceed) and we'll move on to generating your Story Foundation Document."
  );
  return lines.join("\n");
}
