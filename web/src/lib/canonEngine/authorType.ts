import type { AuthorType, AuthorTypeAssessment } from "./storyStore";
import type { DepthMode } from "./types";

/**
 * Author-type classifier — GitHub issue #8, PRD §3/§5.2. A pure heuristic
 * (no extra model call — PRD allows "lightweight classifier prompt or
 * heuristic" and a heuristic keeps per-turn latency/cost at zero).
 *
 * Types: A — Explorer, B — Discoverer, C — Architect, D — Reviser.
 * Never surfaced verbatim to the author (enforced at the call site: the
 * result is stored on the Story and used for depth defaults only).
 */

// "Explicit uncertainty language" — PRD §5.2's own examples plus close kin.
const UNCERTAINTY_PATTERNS: RegExp[] = [
  /\bI don'?t know\b/i,
  /\bnot sure( yet)?\b/i,
  /\bmaybe\b/i,
  /\bno idea\b/i,
  /\bhaven'?t (decided|figured|thought)\b/i,
  /\bsomething like\b/i,
  /\bkind of\b/i,
  /\bI guess\b/i,
];

// Signals that a completed draft or outline exists / is being pasted (→ D).
const DRAFT_PATTERNS: RegExp[] = [
  /\b(my|the|a) (completed?|finished|full|existing) (draft|manuscript|screenplay|script|novel|outline)\b/i,
  /\bI('ve| have) (already )?(written|finished|completed|drafted)\b/i,
  /\bhere('s| is) (my|the) (draft|outline|manuscript|treatment|synopsis)\b/i,
  /\bfirst draft\b/i,
  /\brewrite\b/i,
  /\brevis(e|ing|ion)\b/i,
  /\bfeedback on (my|the|this)\b/i,
  /\bCHAPTER (ONE|1|I)\b/i,
  /\bFADE IN\b/i,
  /\bINT\.|\bEXT\./,
];

// Structural-plan vocabulary suggesting the author arrives with architecture (→ C).
const ARCHITECT_PATTERNS: RegExp[] = [
  /\bthree[- ]act\b/i,
  /\bact (one|two|three|1|2|3)\b/i,
  /\bmidpoint\b/i,
  /\binciting incident\b/i,
  /\bturning point\b/i,
  /\bclimax\b/i,
  /\bbeat sheet\b/i,
  /\bplot(ted)? out\b/i,
  /\bstructure(d)? (it|the story)\b/i,
  /\bchapter breakdown\b/i,
  /\bsave the cat\b/i,
  /\bhero'?s journey\b/i,
];

// A named protagonist: a capitalized name introduced as a character.
const NAMED_PROTAGONIST_PATTERNS: RegExp[] = [
  /\b(?:named?|called)\s+[A-Z][a-z]+/,
  /\b[A-Z][a-z]+\s+(?:is|was)\s+(?:a|an|the)\s+\w+/,
  /\bprotagonist,?\s+[A-Z][a-z]+/,
  /\b(?:my|the)\s+(?:hero|heroine|protagonist|main character|lead)\b/i,
];

// A concrete premise: setting/conflict specifics rather than pure abstraction.
const CONCRETE_PREMISE_PATTERNS: RegExp[] = [
  /\bset in\b/i,
  /\bworld where\b/i,
  /\bwho (must|has to|needs to|discovers|finds|loses)\b/i,
  /\bafter (his|her|their|the)\b/i,
  /\bwhen (a|an|the|his|her|their)\b/i,
];

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
}

export interface ClassificationInput {
  /** The author's message being assessed (usually the latest). */
  message: string;
  /** How many author messages exist so far, counting this one. */
  authorMessageCount: number;
}

/**
 * Classifies one author message. Scores each type from independent signals,
 * then normalizes the winner's share into a 0-1 confidence. Short vague
 * openers default toward A (Explorer) — the PRD's own "vague, one-line
 * idea" signal — so a bare logline never reads as an Architect.
 */
export function classifyAuthorType(input: ClassificationInput): AuthorTypeAssessment {
  const text = input.message;
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  const uncertainty = countMatches(text, UNCERTAINTY_PATTERNS);
  const draft = countMatches(text, DRAFT_PATTERNS);
  const architect = countMatches(text, ARCHITECT_PATTERNS);
  const namedProtagonist = countMatches(text, NAMED_PROTAGONIST_PATTERNS) > 0;
  const concretePremise = countMatches(text, CONCRETE_PREMISE_PATTERNS) > 0;

  const scores: Record<AuthorType, number> = { A: 0, B: 0, C: 0, D: 0 };

  // D — Reviser: a referenced/pasted completed draft dominates everything.
  scores.D += draft * 3;
  if (draft > 0 && words > 400) scores.D += 3; // long paste alongside draft language

  // C — Architect: structural vocabulary + length = arrives with a plan.
  scores.C += architect * 2;
  if (architect >= 2 && words > 150) scores.C += 2;
  if (architect > 0 && namedProtagonist && concretePremise) scores.C += 1;

  // B — Discoverer: premise + protagonist but no structural plan.
  if (namedProtagonist) scores.B += 2;
  if (concretePremise) scores.B += 2;
  if (namedProtagonist && concretePremise && architect === 0) scores.B += 2;

  // A — Explorer: uncertainty language and/or a short vague opener.
  scores.A += uncertainty * 2;
  if (words < 25 && !namedProtagonist && draft === 0 && architect === 0) scores.A += 3;
  if (words < 60 && uncertainty > 0) scores.A += 2;

  let best: AuthorType = "A";
  for (const t of ["D", "C", "B", "A"] as AuthorType[]) {
    if (scores[t] > scores[best]) best = t;
  }

  const total = scores.A + scores.B + scores.C + scores.D;
  // No signal at all → weak default to Explorer; else winner's share, floored
  // so an unambiguous single signal still reads as moderately confident.
  const confidence = total === 0 ? 0.3 : Math.min(0.95, Math.max(0.4, scores[best] / total));

  return {
    type: best,
    confidence: Math.round(confidence * 100) / 100,
    ts: new Date().toISOString(),
  };
}

const REASSESS_FIRST_N_EXCHANGES = 3;
/** "Volunteers a large amount of new material unprompted" — word threshold. */
const LARGE_MATERIAL_WORDS = 200;

/** PRD §5.2: re-assess after each of the first ~3 exchanges, and any time a later message dumps a large amount of new material. */
export function shouldReassess(input: ClassificationInput): boolean {
  if (input.authorMessageCount <= REASSESS_FIRST_N_EXCHANGES) return true;
  const words = input.message.trim().split(/\s+/).filter(Boolean).length;
  return words >= LARGE_MATERIAL_WORDS;
}

/**
 * Per-type depth-default adjustment (PRD §3 table). Applied on top of
 * stageFsm.getDefaultDepthMode's stage/element defaults; an explicit author
 * request for more/less depth always overrides both (that lives in the
 * conversation itself — the system prompt honors it — so nothing here locks).
 */
export function adjustDepthForAuthorType(base: DepthMode, type: AuthorType): DepthMode {
  switch (type) {
    case "A":
      // Explorer: "more Confirm/Refine depth, less Develop depth."
      return base === "Develop" ? "Refine" : base;
    case "D":
      // Reviser: analyze rather than generate — deep dives become audits, so
      // cap generation-heavy Develop at Refine here too.
      return base === "Develop" ? "Refine" : base;
    case "B":
    case "C":
    default:
      // Discoverer keeps structural Develop focus; Architect's consistency
      // auditing is a conversational posture, not a depth change.
      return base;
  }
}
