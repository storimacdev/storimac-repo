/**
 * Canonical fact-field vocabulary for Project 2's Character Bible
 * interview - GitHub issue #29. Mirrors elementRegistry.ts's shape and
 * purpose: a closed vocabulary that steers the model's tool schema
 * (characterTurnSchema.ts) away from inventing field names, the same
 * lesson Project 1 learned the hard way from a freeform element_id field
 * (see docs/superpowers/specs/2026-08-04-stage-drift-catchup-design.md).
 *
 * Deliberately scoped to only what's explicitly named in the PRD/CDRM and
 * issue #28 today: the corrected Triad+Need, and the causal psychology
 * chain (Stage 2). Issue #34 (Stage 6 sign-off compiler) extended this
 * array with Stage 1/3/5/6 fields, derived directly from CDRM §7's exact
 * per-section descriptions and §5's seven named Milestone Arc Timeline
 * beats - not guessed. Issue #31 (relationships) did NOT extend this
 * array - a relationship's key is the other character's ID, which can't
 * be a fixed enum, so it got its own collection
 * (CHARACTER_RELATIONSHIPS_COLLECTION below) and its own turn-schema
 * shape (characterTurnSchema.ts's relationship_updates) instead.
 */

export const CHARACTER_FIELD_IDS: string[] = [
  // Corrected Triad + Need (issue #28's corrected AC, PRD §5.3)
  "want",
  "personality_how",
  "need",
  "values",
  // Causal psychology chain (PRD §5.3, CDRM §3): Life Experience ->
  // Core Wound -> False Belief -> Core Flaw -> Dominant Fear ->
  // Defense Mechanisms -> Behavioral Trajectory
  "life_experience",
  "core_wound",
  "false_belief",
  "core_flaw",
  "dominant_fear",
  "defense_mechanisms",
  "behavioral_trajectory",
  // Stage 1 - Story Function & Integration Map + basic identity (issue
  // #34, CDRM §7 section 2's exact description)
  "age",
  "occupation",
  "narrative_purpose",
  "protagonist_relationship",
  "conflict_contribution",
  "thematic_thesis",
  // Stage 3 - Behavior & Audible Voice Profile (issue #34, CDRM §7
  // section 4's exact description)
  "physical_description",
  "habits",
  "voice_signature",
  "behavior_under_stress",
  // Stage 5 - Milestone Arc Timeline + Arc Type (issue #34, CDRM §5's
  // three named arc types and seven named milestone beats)
  "arc_type",
  "initial_worldview",
  "inciting_disruption",
  "failed_resistance",
  "midpoint_realization",
  "crisis_choice",
  "action_proven_transformation",
  "new_identity",
  // Stage 6 - Continuity & Canon Rules, captured as part of sign-off
  // itself (issue #34, CDRM §7 section 7)
  "continuity_notes",
];

export function isKnownFieldId(id: string): boolean {
  return CHARACTER_FIELD_IDS.includes(id);
}

/** Project 2's relationship-graph collection name (issue #31) - a second
 * P2 collection alongside CHARACTER_FACTS_COLLECTION, keyed by composite
 * IDs {charId}.{otherCharId} rather than {charId}.{field}, since a
 * relationship's "field name" would have to be the other character's ID -
 * which can't be a fixed enum like CHARACTER_FIELD_IDS since the cast is
 * dynamic per story. */
export const CHARACTER_RELATIONSHIPS_COLLECTION = "characterRelationships";
