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
 * chain. Stages 1, 3, 4, 5, and 6's field vocabularies aren't fixed in the
 * source docs yet - inventing names for them now would risk the same
 * sibling-collision bug Project 1 just had fixed, self-inflicted this
 * time. Extend this array (don't create a parallel one) when a later
 * issue (#34 compiler, or whichever issue covers Stage 1/3/5's fields)
 * defines more single-character fields. Issue #31 (relationships) turned
 * out NOT to extend this array - a relationship's key is the other
 * character's ID, which can't be a fixed enum, so it got its own
 * collection (CHARACTER_RELATIONSHIPS_COLLECTION below) and its own turn-
 * schema shape (characterTurnSchema.ts's relationship_updates) instead.
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
