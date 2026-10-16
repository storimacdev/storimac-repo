import { describe, it, expect } from "vitest";
import {
  findSceneRegisterEntry,
  buildAssignmentGateGroundingMessage,
  validateAssignmentSummaryFormat,
  checkAssignmentGateReadiness,
} from "./assignmentGate";
import type { IngestedProject4Canon } from "./ingestCanon";

function p4Canon(overrides: Partial<IngestedProject4Canon> = {}): IngestedProject4Canon {
  return {
    version: 1,
    storyDnaBlueprint: {
      summary_of_core_promise: "",
      genre: "",
      tone: "",
      theme: "",
      core_dramatic_question: "",
    },
    actOverview: [],
    sceneRegister: [
      {
        unit_id: "u1",
        type: "Scene",
        scene_number: 1,
        slugline: "INT. KITCHEN - NIGHT",
        critical_beat_tag: "THE FRAME",
        paragraph: "Alex paces, avoiding Jordan's gaze. The kettle screams. Alex turns it off before answering.",
        causal_tag: "Therefore",
      },
    ],
    criticalBeatEarmarkIndex: [],
    ...overrides,
  };
}

describe("findSceneRegisterEntry", () => {
  it("finds an entry by scene number", () => {
    expect(findSceneRegisterEntry(p4Canon(), 1)?.slugline).toBe("INT. KITCHEN - NIGHT");
  });

  it("returns null for a missing scene number", () => {
    expect(findSceneRegisterEntry(p4Canon(), 99)).toBeNull();
  });

  it("returns null when no P4 canon exists", () => {
    expect(findSceneRegisterEntry(null, 1)).toBeNull();
  });
});

describe("buildAssignmentGateGroundingMessage", () => {
  it("includes the slugline, critical beat, and paragraph, and the required format", () => {
    const entry = p4Canon().sceneRegister[0];
    const message = buildAssignmentGateGroundingMessage(entry);
    expect(message).toContain("INT. KITCHEN - NIGHT");
    expect(message).toContain("THE FRAME");
    expect(message).toContain("kettle screams");
    expect(message).toContain("five pipe-delimited segments");
  });
});

describe("validateAssignmentSummaryFormat", () => {
  const valid =
    "INT. KITCHEN - NIGHT | Alex, Jordan | Alex wants to confess vs. Jordan's suspicion | Alex blurts the truth | Relief curdles into dread";

  it("accepts a well-formed five-segment summary with an INT./EXT. heading", () => {
    expect(validateAssignmentSummaryFormat(valid).ok).toBe(true);
  });

  it("rejects a summary missing segments", () => {
    const result = validateAssignmentSummaryFormat("INT. KITCHEN - NIGHT | Alex, Jordan | objective");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("5 pipe-delimited segments");
  });

  it("rejects a summary with an empty segment", () => {
    const result = validateAssignmentSummaryFormat("INT. KITCHEN - NIGHT |  | objective | turn | shift");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Segment 2");
  });

  it("rejects a heading segment missing INT./EXT.", () => {
    const result = validateAssignmentSummaryFormat("KITCHEN AT NIGHT | Alex | objective | turn | shift");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("INT.");
  });

  it("rejects an empty string", () => {
    expect(validateAssignmentSummaryFormat("").ok).toBe(false);
  });
});

describe("checkAssignmentGateReadiness", () => {
  it("is not ready when no P4 canon exists", () => {
    const result = checkAssignmentGateReadiness(null, 1);
    expect(result.ready).toBe(false);
    expect(result.reason).toContain("has not been compiled yet");
  });

  it("is not ready when the scene number isn't in the Scene Register", () => {
    const result = checkAssignmentGateReadiness(p4Canon(), 5);
    expect(result.ready).toBe(false);
    expect(result.entry).toBeNull();
  });

  it("is ready and returns the entry when the scene exists", () => {
    const result = checkAssignmentGateReadiness(p4Canon(), 1);
    expect(result.ready).toBe(true);
    expect(result.entry?.scene_number).toBe(1);
  });
});
