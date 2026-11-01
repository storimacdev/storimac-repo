import { describe, it, expect } from "vitest";
import {
  evaluateProject4Gaps,
  buildIngestedProject4Canon,
  computeAcknowledgment,
} from "./ingestCanon";
import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";

function baseDoc(overrides: Partial<ScreenplayArchitectureDocument> = {}): ScreenplayArchitectureDocument {
  return {
    schema_version: "1.0",
    "1_screenplay_metadata": {
      story_id: "story-1",
      screenplay_architecture_version: "v1",
      working_title: "Test Story",
      date: "2026-10-16",
      status: "Compiled",
      scope: null,
      author: "(not tracked)",
      diagnosed_complexity: "N/A",
      projected_scene_count: 0,
      estimated_runtime: "(not tracked)",
    },
    "2_story_dna_blueprint": {
      summary_of_core_promise: "Promise",
      genre: "Drama",
      tone: "Tense",
      theme: "Theme",
      core_dramatic_question: "Question?",
    },
    "3_structural_act_set_piece_overview": [],
    "4_complete_approved_scene_register": [],
    "5_critical_beat_earmark_index": [
      { tag: "THE FRAME", scene_number: 1, unit_id: "u1", slugline: "INT. HOUSE - DAY" },
      { tag: "THE SPARK", scene_number: null, unit_id: null, slugline: null },
    ],
    "6_setup_payoff_ledger": [],
    "7_outstanding_decisions_version_history": { outstanding: [], version_history: [] },
    ...overrides,
  };
}

describe("evaluateProject4Gaps", () => {
  it("flags an empty Scene Register", () => {
    const gaps = evaluateProject4Gaps(baseDoc());
    expect(gaps.some((g) => g.field === "scene_register")).toBe(true);
  });

  it("flags unearmarked Critical Beats by name", () => {
    const gaps = evaluateProject4Gaps(baseDoc());
    const beatGap = gaps.find((g) => g.field === "critical_beat_earmark_index");
    expect(beatGap).toBeDefined();
    expect(beatGap?.reason).toContain("THE SPARK");
    expect(beatGap?.reason).not.toContain("THE FRAME");
  });

  it("reports no gaps when the register is populated and every beat is earmarked", () => {
    const doc = baseDoc({
      "4_complete_approved_scene_register": [
        { unit_id: "u1", type: "Scene", scene_number: 1, slugline: "INT. HOUSE - DAY", critical_beat_tag: "THE FRAME", paragraph: "p.", causal_tag: "Therefore" },
      ],
      "5_critical_beat_earmark_index": [
        { tag: "THE FRAME", scene_number: 1, unit_id: "u1", slugline: "INT. HOUSE - DAY" },
      ],
    });
    expect(evaluateProject4Gaps(doc)).toEqual([]);
  });
});

describe("buildIngestedProject4Canon", () => {
  it("copies the compiled document's fields verbatim, never fabricating", () => {
    const doc = baseDoc();
    const canon = buildIngestedProject4Canon(doc, 3);
    expect(canon.version).toBe(3);
    expect(canon.storyDnaBlueprint).toBe(doc["2_story_dna_blueprint"]);
    expect(canon.sceneRegister).toBe(doc["4_complete_approved_scene_register"]);
    expect(canon.criticalBeatEarmarkIndex).toBe(doc["5_critical_beat_earmark_index"]);
  });
});

describe("computeAcknowledgment", () => {
  it("names every gap rather than silently absorbing it", () => {
    const ack = computeAcknowledgment({
      p1: null,
      p4: null,
      gaps: [
        { project: "P1", field: "document", reason: "missing" },
        { project: "P4", field: "document", reason: "missing" },
      ],
    });
    expect(ack).toContain("P1 document");
    expect(ack).toContain("P4 document");
    expect(ack).toContain("2 gaps");
  });

  it("reports scene and beat counts when Project 4 canon is present", () => {
    const doc = baseDoc({
      "4_complete_approved_scene_register": [
        { unit_id: "u1", type: "Scene", scene_number: 1, slugline: "INT. HOUSE - DAY", critical_beat_tag: "THE FRAME", paragraph: "p.", causal_tag: "Therefore" },
      ],
    });
    const p4 = buildIngestedProject4Canon(doc, 2);
    const ack = computeAcknowledgment({ p1: null, p4, gaps: [] });
    expect(ack).toContain("1 scene");
    expect(ack).toContain("1 of 2 Critical Beats");
    expect(ack).not.toContain("gap");
  });

  it("never reproduces full canon text verbatim, only counts/excerpts", () => {
    const ack = computeAcknowledgment({ p1: null, p4: null, gaps: [] });
    expect(ack.length).toBeLessThan(600);
  });
});
