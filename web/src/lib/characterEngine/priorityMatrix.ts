import type { CastMember, IngestedFoundation } from "@/lib/characterEngine/ingestFoundation";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";

/**
 * Project 2 Priority Matrix classifier (issue #25, scoped 2026-07-30 - see
 * docs/superpowers/specs/2026-07-30-p2-priority-matrix-design.md). Pure
 * function over #24's IngestedFoundation - no I/O, no UI wiring.
 *
 * Scope note (see ingestFoundation.ts's own header): this directory
 * (characterEngine/) holds Project-2-specific glue only. This file is not
 * the place for canon state tracking or conflict resolution - those belong
 * in the shared Canon Engine per ARCHITECTURE.md §2/§7.
 */

export type PriorityTier = "Critical" | "Major" | "Supporting" | "Minor";

export interface PriorityMatrixEntry {
  character: string;
  tier: PriorityTier;
  justification: string;
}

// The P2 system prompt's four Major roles (project-docs/storimac-prompts/
// P2-Prompt2...md) - deliberately wider than the issue AC's literal three
// (deuteragonist/mentor/love-interest), since the system prompt is what
// actually governs the live interview.
const MAJOR_ROLES = ["love interest", "mentor", "primary ally", "secondary antagonist"];

// The P2 system prompt's Critical roles - "protagonist" and "antagonist" as
// substrings of story_role. "secondary antagonist" is deliberately excluded
// here (see matchesCriticalRole below) since that specific phrase must stay
// in MAJOR_ROLES above.
const CRITICAL_ROLE_KEYWORDS = ["protagonist", "antagonist"];

// Supporting requires *some* real substance in primary_function or
// description, not mere non-emptiness - Project 1's model almost always
// writes something into primary_function, so a bare "> 0" check makes Minor
// nearly unreachable. 15 chars distinguishes real content (e.g. "delivers
// messages", 18 chars) from a placeholder-ish one-or-two-word stub (e.g.
// "helper", 6 chars) without being so high it demands prose.
const SUPPORTING_CONTENT_MIN_LENGTH = 15;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Returns true if story_role matches a Critical role ("protagonist" or "antagonist"), excluding "secondary antagonist" (a Major role). */
function matchesCriticalRole(storyRole: string): string | null {
  const lower = storyRole.toLowerCase();
  if (lower.includes("secondary antagonist")) return null;
  return CRITICAL_ROLE_KEYWORDS.find((role) => lower.includes(role)) ?? null;
}

// Excluded from the first-name fallback below - a name like "The Harbor
// Clerk" would otherwise contribute a "first name" of "The", which false-
// matches almost any prose beat and incorrectly inflates a Minor character
// to Critical via spurious spine-appearance counts.
const NAME_MATCH_STOPWORDS = new Set(["the", "a", "an", "mr", "mrs", "ms", "dr"]);

/** Builds a Unicode-aware "word"-boundary pattern - `\b` in JS regex is ASCII-only (`\w`) and never
 * forms a boundary next to CJK, Cyrillic, Arabic, or other non-Latin characters, so a plain `\b...\b`
 * pattern silently fails to match non-Latin names even against exact substring hits. */
function boundaryPattern(token: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, "iu");
}

/** Case-insensitive, word-boundary match of a character's full name or first name inside free text. */
function nameAppearsIn(name: string, text: string): boolean {
  const fullNamePattern = boundaryPattern(name);
  if (fullNamePattern.test(text)) return true;

  const firstName = name.split(/\s+/)[0];
  if (firstName && firstName !== name && !NAME_MATCH_STOPWORDS.has(firstName.toLowerCase())) {
    const firstNamePattern = boundaryPattern(firstName);
    if (firstNamePattern.test(text)) return true;
  }
  return false;
}

function countSpineAppearances(name: string, spine: FoundationDocument["11_story_spine"]): number {
  const beats = [
    spine.opening_image ?? "",
    spine.inciting_incident ?? "",
    spine.first_turning_point ?? "",
    spine.midpoint ?? "",
    spine.second_turning_point ?? "",
    spine.climax ?? "",
    spine.closing_image ?? "",
  ];
  return beats.filter((beat) => nameAppearsIn(name, beat)).length;
}

/** Returns the matched Major role string, or null if story_role matches none of them. */
function matchesMajorRole(storyRole: string): string | null {
  const lower = storyRole.toLowerCase();
  return MAJOR_ROLES.find((role) => lower.includes(role)) ?? null;
}

function classifyMember(member: CastMember, foundation: IngestedFoundation): PriorityMatrixEntry {
  const { name, story_role, primary_function, description } = member;
  const { dramaticEngine, storySpine } = foundation;
  // dramaticEngine is an unguarded passthrough of unvalidated Firestore data
  // upstream (ingestFoundation.ts's IngestedFoundation type claims it's
  // non-null, but that's not enforced at runtime) - guard here so this
  // function stays genuinely total.
  const de: Partial<FoundationDocument["8_dramatic_engine"]> = dramaticEngine ?? {};

  const criticalRole = matchesCriticalRole(story_role);
  if (criticalRole) {
    return { character: name, tier: "Critical", justification: `story_role '${story_role.trim()}' is a Critical role` };
  }
  if (nameAppearsIn(name, de.protagonist ?? "")) {
    return { character: name, tier: "Critical", justification: "Named in dramatic_engine.protagonist" };
  }
  if (nameAppearsIn(name, de.antagonistic_force ?? "")) {
    return { character: name, tier: "Critical", justification: "Named in dramatic_engine.antagonistic_force" };
  }
  const spineCount = countSpineAppearances(name, storySpine);
  if (spineCount >= 3) {
    return { character: name, tier: "Critical", justification: `Appears in ${spineCount} of 7 Story Spine beats` };
  }

  const matchedRole = matchesMajorRole(story_role);
  if (matchedRole) {
    return { character: name, tier: "Major", justification: `story_role '${story_role.trim()}' matches a Major role` };
  }
  if (spineCount >= 1) {
    return { character: name, tier: "Major", justification: `Appears in ${spineCount} of 7 Story Spine beats` };
  }

  if (primary_function.trim().length > SUPPORTING_CONTENT_MIN_LENGTH || description.trim().length > SUPPORTING_CONTENT_MIN_LENGTH) {
    return { character: name, tier: "Supporting", justification: "No Story Spine presence; functional role only" };
  }

  return {
    character: name,
    tier: "Minor",
    justification: "No Story Spine presence, recognized role, or functional description",
  };
}

/** Classifies every cast member into a priority tier, one entry per member of `foundation.cast`, same order. */
export function computePriorityMatrix(foundation: IngestedFoundation): PriorityMatrixEntry[] {
  return foundation.cast.map((member) => classifyMember(member, foundation));
}
