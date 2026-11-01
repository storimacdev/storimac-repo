import { describe, it, expect } from "vitest";
import {
  createSceneRecord,
  findScene,
  upsertScene,
  canOpenAssignmentGate,
  setAssignmentSummary,
  signOffAssignment,
  setDraftText,
  setPendingMatrixUpdate,
  confirmScene,
  parkScene,
  getConfirmedScenes,
  determineActiveSceneNumber,
} from "./sceneLedger";

describe("createSceneRecord", () => {
  it("starts Exploring in the assignment_gate phase, with no sign-off", () => {
    const scene = createSceneRecord(1);
    expect(scene.status).toBe("Exploring");
    expect(scene.phase).toBe("assignment_gate");
    expect(scene.signedOff).toBe(false);
    expect(scene.assignmentSummary).toBeNull();
  });
});

describe("findScene / upsertScene", () => {
  it("finds by sceneNumber and upserts by replacing an existing match", () => {
    const scenes = [createSceneRecord(1), createSceneRecord(2)];
    expect(findScene(scenes, 2)?.sceneNumber).toBe(2);
    const updated = upsertScene(scenes, { ...scenes[1], status: "Working" });
    expect(updated).toHaveLength(2);
    expect(findScene(updated, 2)?.status).toBe("Working");
  });

  it("appends when no existing scene matches", () => {
    const updated = upsertScene([createSceneRecord(1)], createSceneRecord(2));
    expect(updated).toHaveLength(2);
  });
});

describe("canOpenAssignmentGate", () => {
  it("allows opening scene 1 with no prior scenes", () => {
    expect(canOpenAssignmentGate([], 1).ok).toBe(true);
  });

  it("blocks starting a new scene while another is still open (not Confirmed/Parked)", () => {
    const scenes = [createSceneRecord(1)];
    const result = canOpenAssignmentGate(scenes, 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Scene 1");
  });

  it("allows starting a new scene once the prior one is Confirmed", () => {
    const confirmed = confirmScene(setDraftText(createSceneRecord(1), "INT. HOUSE - DAY"), "INT. HOUSE - DAY");
    expect(canOpenAssignmentGate([confirmed], 2).ok).toBe(true);
  });

  it("allows starting a new scene once the prior one is Parked", () => {
    const parked = parkScene(createSceneRecord(1));
    expect(canOpenAssignmentGate([parked], 2).ok).toBe(true);
  });

  it("re-opening the same scene number that is already open is not blocked by itself", () => {
    const scenes = [createSceneRecord(1)];
    expect(canOpenAssignmentGate(scenes, 1).ok).toBe(true);
  });
});

describe("setAssignmentSummary / signOffAssignment", () => {
  it("throws if sign-off is attempted with no summary proposed", () => {
    expect(() => signOffAssignment(createSceneRecord(1))).toThrow();
  });

  it("signs off and advances phase to drafting once a summary exists", () => {
    const withSummary = setAssignmentSummary(createSceneRecord(1), "a | b | c | d | e");
    const signed = signOffAssignment(withSummary);
    expect(signed.signedOff).toBe(true);
    expect(signed.phase).toBe("drafting");
  });
});

describe("setPendingMatrixUpdate", () => {
  it("starts null on a fresh scene", () => {
    expect(createSceneRecord(1).pendingMatrixUpdate).toBeNull();
  });

  it("stores the update independently of draftText", () => {
    const scene = setPendingMatrixUpdate(createSceneRecord(1), {
      knowledgeGained: [{ characterId: "c1", characterName: "Alex", fact: "a secret", state: "knows" }],
    });
    expect(scene.pendingMatrixUpdate?.knowledgeGained).toHaveLength(1);
    expect(scene.draftText).toBeNull();
  });

  it("can be cleared back to null", () => {
    const withUpdate = setPendingMatrixUpdate(createSceneRecord(1), { knowledgeGained: [] });
    const cleared = setPendingMatrixUpdate(withUpdate, null);
    expect(cleared.pendingMatrixUpdate).toBeNull();
  });
});

describe("confirmScene", () => {
  it("freezes draftText as confirmedText and sets status Confirmed", () => {
    const scene = setDraftText(createSceneRecord(1), "INT. HOUSE - DAY\n\nAction.");
    const confirmed = confirmScene(scene, "INT. HOUSE - DAY\n\nAction.");
    expect(confirmed.status).toBe("Confirmed");
    expect(confirmed.confirmedText).toBe("INT. HOUSE - DAY\n\nAction.");
  });

  it("throws when re-confirming an already-Confirmed scene with different text", () => {
    const confirmed = confirmScene(createSceneRecord(1), "Original text");
    expect(() => confirmScene(confirmed, "Changed text")).toThrow();
  });

  it("allows an idempotent re-confirm with identical text", () => {
    const confirmed = confirmScene(createSceneRecord(1), "Same text");
    expect(() => confirmScene(confirmed, "Same text")).not.toThrow();
  });
});

describe("determineActiveSceneNumber", () => {
  it("starts at scene 1 with no scenes yet", () => {
    expect(determineActiveSceneNumber([], null)).toBe(1);
  });

  it("honors an explicit requested scene number", () => {
    expect(determineActiveSceneNumber([createSceneRecord(1)], 5)).toBe(5);
  });

  it("resumes the still-open scene when one exists", () => {
    const scenes = [confirmScene(createSceneRecord(1), "one"), createSceneRecord(2)];
    expect(determineActiveSceneNumber(scenes, null)).toBe(2);
  });

  it("advances past the highest resolved scene once all are Confirmed/Parked", () => {
    const scenes = [confirmScene(createSceneRecord(1), "one"), parkScene(createSceneRecord(2))];
    expect(determineActiveSceneNumber(scenes, null)).toBe(3);
  });

  it("works with just {sceneNumber, status} (issue #100 - shared with the resume UI, which only has that subset)", () => {
    const minimal: { sceneNumber: number; status: "Exploring" | "Working" | "Confirmed" | "Parked" }[] = [
      { sceneNumber: 1, status: "Confirmed" },
      { sceneNumber: 2, status: "Working" },
    ];
    expect(determineActiveSceneNumber(minimal, null)).toBe(2);
  });
});

describe("getConfirmedScenes", () => {
  it("returns only Confirmed scenes, sorted by scene number", () => {
    const scenes = [
      confirmScene(createSceneRecord(3), "three"),
      createSceneRecord(2),
      confirmScene(createSceneRecord(1), "one"),
    ];
    const confirmed = getConfirmedScenes(scenes);
    expect(confirmed.map((s) => s.sceneNumber)).toEqual([1, 3]);
  });
});
