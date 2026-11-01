import { describe, it, expect } from "vitest";
import { lintWorldBibleDocument } from "./worldBibleLint";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

/**
 * Coverage for issue #134: `WorldBibleDocument["1_document_metadata"].status`
 * widened from the frozen literal "Compiled" to "Compiled" | "Confirmed" so
 * `confirmWorldBibleVersion` can persist the real post-confirm status. The
 * structure-lint schema (this file) must accept both values - a document
 * already marked Confirmed must still pass re-linting.
 */
function buildDoc(status: "Compiled" | "Confirmed"): WorldBibleDocument {
  return {
    schema_version: "1.0",
    "1_document_metadata": {
      story_id: "story-1",
      world_bible_version: "v1",
      working_title: "Test World",
      date: "2026-01-01",
      status,
      related_project_1_version: "v1",
      related_project_2_status: "Not yet available",
    },
    "2_world_overview_complexity_summary": "summary",
    "3_world_assumptions_canon_rules": "rules",
    "4_master_world_pillars": [{ pillar: "Pillar", summary: "Summary" }],
    "5_geography_settings_registry": "geo",
    "6_societal_infrastructure_manual": "societal",
    "7_cultural_lived_experience_profiles": "cultural",
    "8_narrative_lore_history": "lore",
    "9_system_mechanics": "mechanics",
    "10_significant_institutions_artifacts": "institutions",
    "11_linguistic_communication_profile": "linguistic",
    "12_interconnection_map_systems_synthesis": "interconnection",
    "13_outstanding_world_questions": [],
    "14_cross_project_reference_log": { project_1: null, project_2: [] },
    "15_version_history": [{ version: "v1", date: "2026-01-01", summary_of_changes: "Initial generation." }],
  };
}

describe("lintWorldBibleDocument - issue #134 status widening", () => {
  it("accepts a document whose status is still 'Compiled'", () => {
    expect(lintWorldBibleDocument(buildDoc("Compiled")).valid).toBe(true);
  });

  it("accepts a document whose status has been updated to 'Confirmed'", () => {
    expect(lintWorldBibleDocument(buildDoc("Confirmed")).valid).toBe(true);
  });

  it("rejects a document with any other status value", () => {
    const doc = buildDoc("Compiled");
    const invalid = { ...doc, "1_document_metadata": { ...doc["1_document_metadata"], status: "Draft" } };
    expect(lintWorldBibleDocument(invalid).valid).toBe(false);
  });
});
