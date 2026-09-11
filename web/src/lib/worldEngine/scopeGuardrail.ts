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
 * Final whole-branch review finding C1: the original version also
 * counted past-tense narrative sentences (walked/turned/reached/etc) as
 * a blocking signal. That signal false-positived on ordinary World
 * Bible history/systems summaries (exactly the kind of legitimate
 * content that uses past-tense action verbs without being a story
 * scene), silently discarding the author's real reply with no
 * recovery. It's demoted below to a non-blocking diagnostic export
 * (countNarrativeSentenceSignals) rather than removed outright, so a
 * future, better-designed signal (e.g. requiring a personal/pronoun
 * subject, which needs more than a keyword regex) has a documented
 * starting point. detectProseGeneration itself now depends only on the
 * dialogue-attribution signal, which C1 also found overly broad (an
 * un-anchored pattern matching field-label echoes like "Governing
 * Rules: ..." via its last word) - fixed via line-anchoring and a
 * field-label denylist below.
 *
 * Thresholds remain deliberately conservative and explicitly
 * provisional - expect to retune once there's real usage data, same
 * situation as issue #20's classifier.
 */

const FIELD_LABEL_DENYLIST = new Set([
  "name",
  "category",
  "role",
  "rules",
  "description",
  "importance",
  "depth",
  "status",
  "id",
]);

function isDenylistedLabel(word: string): boolean {
  return FIELD_LABEL_DENYLIST.has(word.toLowerCase());
}

// Script-style: `Name: "..."` (a colon-attributed line of dialogue).
// Anchored to line start (`^`, multiline) so a field-label echo like
// "Governing Rules: "..."" can never match via its last word "Rules:"
// appearing mid-line - only an actual line-leading `Word: "` counts.
const SCRIPT_STYLE_PATTERN = /^([A-Z][A-Za-z'-]{1,30}):\s*"/gm;

// Prose-style: `"..." said Name` (a quoted line with a speech verb and
// a capitalized name). No `i` flag - the capitalized-name requirement
// on the name group is meant literally; speech verbs are effectively
// always lowercase mid-sentence, so case-insensitivity on the whole
// pattern only weakened the "capitalized name" signal without adding
// real coverage.
const PROSE_STYLE_PATTERN =
  /"[^"\n]{8,}"\s*,?\s*(?:said|asked|replied|whispered|shouted|muttered|exclaimed)\s+([A-Z][A-Za-z'-]{1,30})\b/g;

function countAttributionMatches(reply: string): number {
  let count = 0;
  for (const match of reply.matchAll(SCRIPT_STYLE_PATTERN)) {
    if (!isDenylistedLabel(match[1])) count++;
  }
  for (const match of reply.matchAll(PROSE_STYLE_PATTERN)) {
    if (!isDenylistedLabel(match[1])) count++;
  }
  return count;
}

const NARRATIVE_SENTENCE_PATTERN =
  /[^.!?]*\b(?:walked|ran|looked|turned|grabbed|whispered|shouted|stared|smiled|frowned|nodded|sighed|stepped|reached|pulled|pushed|glanced|paused)\b[^.!?]*[.!?]/gi;

// Non-blocking diagnostic only (see the header comment / finding C1) -
// not consumed by detectProseGeneration. Exported so route.ts can log
// it for future tuning without acting on it.
export function countNarrativeSentenceSignals(reply: string): number {
  return (reply.match(NARRATIVE_SENTENCE_PATTERN) ?? []).length;
}

export function detectProseGeneration(reply: string): boolean {
  return countAttributionMatches(reply) >= 2;
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
  return `That's ${projectPhrase} territory rather than the World Bible — I've made a note of it for later, so it isn't lost. For now, let's keep building out the world.`;
}
