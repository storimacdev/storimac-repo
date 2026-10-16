import { describe, it, expect } from "vitest";
import {
  resolveAuthorityPrecedence,
  createEmptyContinuityMatrix,
  checkKnowledgeConsistency,
  checkPhysicalConsistency,
  checkLoopClosuresPlanted,
  checkContinuityBeforeDraft,
  applyContinuityMatrixUpdate,
  listOpenLoops,
  type ContinuityMatrix,
} from "./continuityMatrix";

describe("resolveAuthorityPrecedence", () => {
  it("picks Author Directives over everything else", () => {
    expect(
      resolveAuthorityPrecedence(["Project 1 Foundation", "Author Directives", "Project 3 World"])
    ).toBe("Author Directives");
  });

  it("picks Approved Screenplay Pages over Project canon", () => {
    expect(resolveAuthorityPrecedence(["Project 2 Characters", "Approved Screenplay Pages"])).toBe(
      "Approved Screenplay Pages"
    );
  });

  it("ranks Project 1 above Project 2 above Project 3", () => {
    expect(resolveAuthorityPrecedence(["Project 3 World", "Project 1 Foundation"])).toBe(
      "Project 1 Foundation"
    );
    expect(resolveAuthorityPrecedence(["Project 3 World", "Project 2 Characters"])).toBe(
      "Project 2 Characters"
    );
  });

  it("throws on an empty list", () => {
    expect(() => resolveAuthorityPrecedence([])).toThrow();
  });
});

describe("checkKnowledgeConsistency", () => {
  it("flags a character acting on a fact they never learned on screen", () => {
    const matrix = createEmptyContinuityMatrix();
    const result = checkKnowledgeConsistency(matrix, [{ characterId: "char-1", fact: "the affair" }], 5);
    expect(result.ok).toBe(false);
    expect(result.violations[0].kind).toBe("unearned_knowledge");
  });

  it("passes when the character learned the fact in an earlier Confirmed scene", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [
        { characterId: "char-1", characterName: "Alex", fact: "the affair", state: "knows", sinceSceneNumber: 3 },
      ],
      physicalTracking: [],
      openLoops: [],
    };
    const result = checkKnowledgeConsistency(matrix, [{ characterId: "char-1", fact: "the affair" }], 5);
    expect(result.ok).toBe(true);
  });

  it("does not count merely suspecting or lying about a fact as knowing it", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [
        { characterId: "char-1", characterName: "Alex", fact: "the affair", state: "suspects", sinceSceneNumber: 3 },
      ],
      physicalTracking: [],
      openLoops: [],
    };
    const result = checkKnowledgeConsistency(matrix, [{ characterId: "char-1", fact: "the affair" }], 5);
    expect(result.ok).toBe(false);
  });

  it("rejects knowledge gained in the same or a later scene than the one requiring it", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [
        { characterId: "char-1", characterName: "Alex", fact: "the affair", state: "knows", sinceSceneNumber: 5 },
      ],
      physicalTracking: [],
      openLoops: [],
    };
    const result = checkKnowledgeConsistency(matrix, [{ characterId: "char-1", fact: "the affair" }], 5);
    expect(result.ok).toBe(false);
  });
});

describe("checkPhysicalConsistency", () => {
  it("flags a scene that ignores the latest tracked physical state", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [],
      physicalTracking: [{ subject: "Alex", kind: "injury", detail: "broken arm, in a cast", sinceSceneNumber: 10 }],
      openLoops: [],
    };
    const result = checkPhysicalConsistency(matrix, [
      { subject: "Alex", kind: "injury", expectedDetail: "uninjured" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("uses the most recent entry when several exist for the same subject/kind", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [],
      physicalTracking: [
        { subject: "Alex", kind: "injury", detail: "broken arm, in a cast", sinceSceneNumber: 10 },
        { subject: "Alex", kind: "injury", detail: "cast removed, still sore", sinceSceneNumber: 20 },
      ],
      openLoops: [],
    };
    const result = checkPhysicalConsistency(matrix, [
      { subject: "Alex", kind: "injury", expectedDetail: "cast removed, still sore" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("passes when no tracking entry exists yet for the subject", () => {
    const matrix = createEmptyContinuityMatrix();
    const result = checkPhysicalConsistency(matrix, [
      { subject: "Alex", kind: "injury", expectedDetail: "uninjured" },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("checkLoopClosuresPlanted", () => {
  it("rejects closing a loop that was never planted", () => {
    const matrix = createEmptyContinuityMatrix();
    const result = checkLoopClosuresPlanted(matrix, ["loop-1"]);
    expect(result.ok).toBe(false);
    expect(result.violations[0].kind).toBe("open_loop_never_planted");
  });

  it("accepts closing a loop that exists in the matrix, open or already closed", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [],
      physicalTracking: [],
      openLoops: [
        {
          id: "loop-1",
          description: "The gun on the mantelpiece",
          kind: "setup",
          plantedSceneNumber: 2,
          payoffSceneNumber: null,
          status: "open",
          closedSceneNumber: null,
        },
      ],
    };
    expect(checkLoopClosuresPlanted(matrix, ["loop-1"]).ok).toBe(true);
  });
});

describe("checkContinuityBeforeDraft", () => {
  it("merges violations from all three checks", () => {
    const matrix = createEmptyContinuityMatrix();
    const result = checkContinuityBeforeDraft(matrix, 5, {
      requiredKnowledge: [{ characterId: "char-1", fact: "the affair" }],
      loopIdsToClose: ["loop-1"],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it("passes cleanly with no requirements", () => {
    const matrix = createEmptyContinuityMatrix();
    expect(checkContinuityBeforeDraft(matrix, 1, {}).ok).toBe(true);
  });
});

describe("applyContinuityMatrixUpdate", () => {
  it("appends knowledge and physical-tracking entries stamped with the scene number", () => {
    const matrix = createEmptyContinuityMatrix();
    const updated = applyContinuityMatrixUpdate(matrix, {
      sceneNumber: 4,
      knowledgeGained: [{ characterId: "char-1", characterName: "Alex", fact: "the affair", state: "knows" }],
      physicalChanges: [{ subject: "Alex", kind: "injury", detail: "broken arm" }],
    });
    expect(updated.knowledgeLedger).toEqual([
      { characterId: "char-1", characterName: "Alex", fact: "the affair", state: "knows", sinceSceneNumber: 4 },
    ]);
    expect(updated.physicalTracking).toEqual([
      { subject: "Alex", kind: "injury", detail: "broken arm", sinceSceneNumber: 4 },
    ]);
    // original untouched
    expect(matrix.knowledgeLedger).toHaveLength(0);
  });

  it("opens a new loop and leaves it open", () => {
    const matrix = createEmptyContinuityMatrix();
    const updated = applyContinuityMatrixUpdate(matrix, {
      sceneNumber: 2,
      loopsOpened: [{ id: "loop-1", description: "The gun", kind: "setup", payoffSceneNumber: 40 }],
    });
    expect(listOpenLoops(updated)).toHaveLength(1);
    expect(updated.openLoops[0]).toMatchObject({
      id: "loop-1",
      status: "open",
      plantedSceneNumber: 2,
      payoffSceneNumber: 40,
    });
  });

  it("closes an existing open loop", () => {
    const matrix = applyContinuityMatrixUpdate(createEmptyContinuityMatrix(), {
      sceneNumber: 2,
      loopsOpened: [{ id: "loop-1", description: "The gun", kind: "setup" }],
    });
    const updated = applyContinuityMatrixUpdate(matrix, { sceneNumber: 40, loopsClosed: ["loop-1"] });
    expect(listOpenLoops(updated)).toHaveLength(0);
    expect(updated.openLoops[0]).toMatchObject({ status: "closed", closedSceneNumber: 40 });
  });

  it("handles a loop opened and closed within the same update (same-scene payoff)", () => {
    const matrix = createEmptyContinuityMatrix();
    const updated = applyContinuityMatrixUpdate(matrix, {
      sceneNumber: 10,
      loopsOpened: [{ id: "loop-1", description: "A quick visual gag", kind: "visual_motif" }],
      loopsClosed: ["loop-1"],
    });
    expect(updated.openLoops).toHaveLength(1);
    expect(updated.openLoops[0]).toMatchObject({ status: "closed", closedSceneNumber: 10 });
  });

  it("does not reopen or duplicate a loop already closed in a prior update", () => {
    let matrix = applyContinuityMatrixUpdate(createEmptyContinuityMatrix(), {
      sceneNumber: 2,
      loopsOpened: [{ id: "loop-1", description: "The gun", kind: "setup" }],
    });
    matrix = applyContinuityMatrixUpdate(matrix, { sceneNumber: 40, loopsClosed: ["loop-1"] });
    const updated = applyContinuityMatrixUpdate(matrix, { sceneNumber: 41 });
    expect(updated.openLoops).toHaveLength(1);
    expect(updated.openLoops[0].status).toBe("closed");
  });
});
