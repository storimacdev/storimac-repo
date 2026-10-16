import { describe, it, expect } from "vitest";
import { buildWorldBibleSynthesisSchema } from "./worldBibleCompiler";

/**
 * Coverage for issue #131's structure-lint gap fix: `master_world_pillars`
 * previously had no `.min(1)` anywhere, so a synthesis call that returned
 * zero pillar entries passed validation cleanly even when pillars had been
 * adopted. `buildWorldBibleSynthesisSchema(pillarCount)` (used by
 * `runWorldBibleSynthesis`) adds that floor only when `pillarCount > 0` -
 * when nothing has been adopted yet, an empty array is the only correct
 * response and must stay valid, or every zero-pillar story's compile would
 * retry-loop itself into a hard failure.
 */

/** A minimal payload satisfying every OTHER required field in
 * WorldBibleSynthesisSchema, so each test below only varies
 * `master_world_pillars`. */
function basePayload(pillars: { pillar: string; summary: string }[]) {
  return {
    world_overview_complexity_summary: "summary",
    world_assumptions_canon_rules: "rules",
    master_world_pillars: pillars,
    geography_settings_registry: "geo",
    societal_infrastructure_manual: "societal",
    cultural_lived_experience_profiles: "cultural",
    narrative_lore_history: "lore",
    system_mechanics: "mechanics",
    significant_institutions_artifacts: "institutions",
    linguistic_communication_profile: "linguistic",
    interconnection_map_systems_synthesis: "interconnection",
  };
}

describe("buildWorldBibleSynthesisSchema", () => {
  it("rejects a zero-length master_world_pillars array when pillars have been adopted", () => {
    const schema = buildWorldBibleSynthesisSchema(3);
    const result = schema.safeParse(basePayload([]));
    expect(result.success).toBe(false);
  });

  it("accepts a non-empty master_world_pillars array when pillars have been adopted", () => {
    const schema = buildWorldBibleSynthesisSchema(2);
    const result = schema.safeParse(
      basePayload([
        { pillar: "Pillar One", summary: "Summary one." },
        { pillar: "Pillar Two", summary: "Summary two." },
      ])
    );
    expect(result.success).toBe(true);
  });

  it("accepts a zero-length master_world_pillars array when no pillars have been adopted", () => {
    const schema = buildWorldBibleSynthesisSchema(0);
    const result = schema.safeParse(basePayload([]));
    expect(result.success).toBe(true);
  });
});
