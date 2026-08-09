import type { CanonElement } from "@/lib/canonEngine/types";
import type { CharacterBibleEntry, StoredOutstandingQuestion } from "@/lib/canonEngine/storyStore";

/**
 * Project 2 Stage 6 sign-off compiler — GitHub issue #34, design:
 * docs/superpowers/specs/2026-08-09-p2-character-bible-compiler-design.md.
 * Pure, I/O-free (mirrors foundationDoc.ts's compileFoundationDocument /
 * characterFsm.ts's/causalChain.ts's split from their own I/O-bound
 * callers). Only Confirmed elements contribute a value - matches AC2
 * ("only Confirmed facts appear in the compiled entry") exactly, the
 * same posture foundationDoc.ts's confirmedValue helper already takes
 * for Project 1's Stage 8 document.
 *
 * Callers pass the FULL story-wide facts/relationships/outstanding-
 * questions lists (not pre-filtered) - this module does its own
 * charId-prefix filtering, keeping "only this character's data" as a
 * single, testable invariant rather than trusting every call site to
 * have filtered correctly upstream.
 */

type ElementMap = Map<string, CanonElement>;

function byField(elements: CanonElement[], charId: string): ElementMap {
  const map: ElementMap = new Map();
  const prefix = `${charId}.`;
  for (const e of elements) {
    if (e.element_id.startsWith(prefix)) {
      map.set(e.element_id.slice(prefix.length), e);
    }
  }
  return map;
}

function confirmedStr(byId: ElementMap, field: string): string {
  const e = byId.get(field);
  if (!e || e.status !== "Confirmed") return "";
  if (typeof e.value === "string") return e.value;
  if (e.value === null || e.value === undefined) return "";
  return JSON.stringify(e.value);
}

export interface CompileCharacterBibleEntryParams {
  charId: string;
  characterName: string;
  /** Maps every known charId in this story to its display name (e.g. from
   * p2State.characterProgress), used to resolve ensemble_interconnection_registry's
   * "with" field to a readable name instead of a raw charId slug. Falls
   * back to the charId itself for any id not present in this map. */
  characterNames: Record<string, string>;
  storyRole: string;
  tier: string;
  depthLabel: string;
  /** This story's full characterFacts elements (all characters) - filtered internally to charId. */
  facts: CanonElement[];
  /** This story's full characterRelationships elements (all characters) - filtered internally to charId. */
  relationships: CanonElement[];
  /** This story's full outstanding-questions list (all sources) - filtered internally to charId. */
  outstandingQuestions: StoredOutstandingQuestion[];
  signedOffAt: string;
}

export function compileCharacterBibleEntry(params: CompileCharacterBibleEntryParams): CharacterBibleEntry {
  const {
    charId,
    characterName,
    characterNames,
    storyRole,
    tier,
    depthLabel,
    facts,
    relationships,
    outstandingQuestions,
    signedOffAt,
  } = params;

  const factsById = byField(facts, charId);
  const relationshipPrefix = `${charId}.`;

  const ensemble = relationships
    .filter((e) => e.status === "Confirmed" && e.element_id.startsWith(relationshipPrefix))
    .map((e) => {
      const v = (e.value ?? {}) as { dynamic?: string; trust_trajectory?: string; power_dynamic?: string };
      const otherCharId = e.element_id.slice(relationshipPrefix.length);
      return {
        with: characterNames[otherCharId] ?? otherCharId,
        dynamic: v.dynamic ?? "",
        trust_trajectory: v.trust_trajectory ?? "",
        power_dynamic: v.power_dynamic ?? "",
      };
    });

  return {
    charId,
    metadata: {
      character_name: characterName,
      age: confirmedStr(factsById, "age"),
      occupation: confirmedStr(factsById, "occupation"),
      story_role: storyRole,
      narrative_importance: tier,
      development_depth: depthLabel,
      arc_type: confirmedStr(factsById, "arc_type"),
      canon_status: "Signed Off",
    },
    story_function: {
      narrative_purpose: confirmedStr(factsById, "narrative_purpose"),
      protagonist_relationship: confirmedStr(factsById, "protagonist_relationship"),
      conflict_contribution: confirmedStr(factsById, "conflict_contribution"),
      thematic_thesis: confirmedStr(factsById, "thematic_thesis"),
    },
    psychological_engine: {
      want: confirmedStr(factsById, "want"),
      personality_how: confirmedStr(factsById, "personality_how"),
      need: confirmedStr(factsById, "need"),
      values: confirmedStr(factsById, "values"),
      life_experience: confirmedStr(factsById, "life_experience"),
      core_wound: confirmedStr(factsById, "core_wound"),
      false_belief: confirmedStr(factsById, "false_belief"),
      core_flaw: confirmedStr(factsById, "core_flaw"),
      dominant_fear: confirmedStr(factsById, "dominant_fear"),
      defense_mechanisms: confirmedStr(factsById, "defense_mechanisms"),
      behavioral_trajectory: confirmedStr(factsById, "behavioral_trajectory"),
    },
    behavior_voice_profile: {
      physical_description: confirmedStr(factsById, "physical_description"),
      habits: confirmedStr(factsById, "habits"),
      voice_signature: confirmedStr(factsById, "voice_signature"),
      behavior_under_stress: confirmedStr(factsById, "behavior_under_stress"),
    },
    ensemble_interconnection_registry: ensemble,
    milestone_arc_timeline: {
      initial_worldview: confirmedStr(factsById, "initial_worldview"),
      inciting_disruption: confirmedStr(factsById, "inciting_disruption"),
      failed_resistance: confirmedStr(factsById, "failed_resistance"),
      midpoint_realization: confirmedStr(factsById, "midpoint_realization"),
      crisis_choice: confirmedStr(factsById, "crisis_choice"),
      action_proven_transformation: confirmedStr(factsById, "action_proven_transformation"),
      new_identity: confirmedStr(factsById, "new_identity"),
    },
    continuity_canon_rules: confirmedStr(factsById, "continuity_notes"),
    outstanding_questions: outstandingQuestions
      .filter((q) => q.charId === charId)
      .map((q) => ({ item: q.item, defer_to: q.defer_to, notes: q.notes })),
    signed_off_at: signedOffAt,
  };
}
