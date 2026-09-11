/**
 * Scope-boundary guardrail for the World Bible (issue #46). Two
 * independent detection layers feed one enforcement point (wired in
 * world-chat/route.ts): Layer 1 is the model self-reporting via
 * WorldTurnSchema's deferred_items field (mirrors issue #32's P2
 * mechanism); Layer 2, this module's detectProseGeneration, is a
 * rules-based safety net scoped ONLY to Project 5 (prose/dialogue
 * generation) - deliberately not extended to Project 2/Project 4, since
 * character and plot content overlap too heavily with legitimate World
 * Bible content (sp03 4 expects character mentions; the World Bible's
 * own "History" pillar legitimately covers timelines) for a keyword
 * rule to be high-precision there. See the design doc
 * (docs/superpowers/specs/2026-09-11-p3-scope-guardrail-design.md) for
 * the full reasoning.
 *
 * detectProseGeneration's thresholds are deliberately conservative
 * (tuned toward under-triggering, not over-blocking) and explicitly
 * provisional - expect to retune once there's real usage data, same
 * situation as issue #20's classifier.
 */

const DIALOGUE_ATTRIBUTION_PATTERNS: RegExp[] = [
  // Script-style: `Name: "..."` (a colon-attributed line of dialogue)
  /\b[A-Z][A-Za-z'-]{1,30}:\s*"/g,
  // Prose-style: `"..." said Name` (a quoted line with a speech verb and a capitalized name)
  /"[^"\n]{8,}"\s*,?\s*(said|asked|replied|whispered|shouted|muttered|exclaimed)\s+[A-Z][A-Za-z'-]{1,30}\b/gi,
];

const NARRATIVE_SENTENCE_PATTERN =
  /[^.!?]*\b(?:walked|ran|looked|turned|grabbed|whispered|shouted|stared|smiled|frowned|nodded|sighed|stepped|reached|pulled|pushed|glanced|paused)\b[^.!?]*[.!?]/gi;

export function detectProseGeneration(reply: string): boolean {
  const attributionMatches = DIALOGUE_ATTRIBUTION_PATTERNS.reduce((count, pattern) => {
    const matches = reply.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
  if (attributionMatches >= 2) return true;

  const narrativeSentences = reply.match(NARRATIVE_SENTENCE_PATTERN) ?? [];
  if (narrativeSentences.length >= 4) return true;

  return false;
}

const PROJECT_LABELS: Record<"Project 2" | "Project 4" | "Project 5", string> = {
  "Project 2": "the Character Bible",
  "Project 4": "Story Architecture",
  "Project 5": "Draft Writing",
};

export function buildScopeRedirectNote(items: { defer_to_project: "Project 2" | "Project 4" | "Project 5" }[]): string {
  const uniqueProjects = Array.from(new Set(items.map((i) => i.defer_to_project)));
  const projectPhrase =
    uniqueProjects.length > 0 ? uniqueProjects.map((p) => PROJECT_LABELS[p]).join(" and ") : "a different stage of the process";
  return `That's ${projectPhrase} territory rather than the World Bible — I've logged it so it isn't lost, and we can pick it back up when you get there. For now, let's keep building out the world.`;
}
