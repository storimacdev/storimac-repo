import { describe, it, expect } from "vitest";
import {
  validateRevisionClassification,
  validateApprovalGate,
  canonizeScene,
} from "./revisionCanonization";
import { createSceneRecord, setDraftText, setPendingMatrixUpdate } from "./sceneLedger";
import { createEmptyContinuityMatrix } from "./continuityMatrix";

describe("validateRevisionClassification", () => {
  it("rejects an empty description", () => {
    const result = validateRevisionClassification(
      { feedbackType: "Dialogue", scope: "Line", description: "" },
      false
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a Full Scene scope without explicit request", () => {
    const result = validateRevisionClassification(
      { feedbackType: "Structure", scope: "Full Scene", description: "Rewriting everything." },
      false
    );
    expect(result.ok).toBe(false);
  });

  it("accepts a Full Scene scope when explicitly requested", () => {
    const result = validateRevisionClassification(
      { feedbackType: "Structure", scope: "Full Scene", description: "Author asked for a full rewrite." },
      true
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a Line-scope edit without needing explicit request", () => {
    const result = validateRevisionClassification(
      { feedbackType: "Dialogue", scope: "Line", description: "Tightened one line of dialogue." },
      false
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateApprovalGate", () => {
  it("rejects when approval is not explicit", () => {
    expect(validateApprovalGate(false).ok).toBe(false);
  });

  it("accepts explicit approval", () => {
    expect(validateApprovalGate(true).ok).toBe(true);
  });
});

describe("canonizeScene", () => {
  it("refuses to confirm without explicit approval, leaving scene/matrix untouched", () => {
    const scene = setDraftText(createSceneRecord(1), "INT. ROOM - DAY\n\nAction.");
    const matrix = createEmptyContinuityMatrix();
    const result = canonizeScene({ scene, finalText: scene.draftText!, matrix, explicitApproval: false });
    expect(result.ok).toBe(false);
    expect(result.scene).toBeNull();
    expect(result.matrix).toBeNull();
  });

  it("freezes the scene and applies its pending matrix update together", () => {
    let scene = setDraftText(createSceneRecord(5), "INT. ROOM - DAY\n\nAction.");
    scene = setPendingMatrixUpdate(scene, {
      knowledgeGained: [{ characterId: "c1", characterName: "Alex", fact: "the affair", state: "knows" }],
      physicalChanges: [{ subject: "Alex", kind: "injury", detail: "broken arm" }],
      loopsOpened: [{ id: "loop-1", description: "The gun", kind: "setup" }],
    });
    const matrix = createEmptyContinuityMatrix();

    const result = canonizeScene({ scene, finalText: scene.draftText!, matrix, explicitApproval: true });

    expect(result.ok).toBe(true);
    expect(result.scene?.status).toBe("Confirmed");
    expect(result.scene?.confirmedText).toBe("INT. ROOM - DAY\n\nAction.");
    expect(result.matrix?.knowledgeLedger).toEqual([
      { characterId: "c1", characterName: "Alex", fact: "the affair", state: "knows", sinceSceneNumber: 5 },
    ]);
    expect(result.matrix?.physicalTracking).toEqual([
      { subject: "Alex", kind: "injury", detail: "broken arm", sinceSceneNumber: 5 },
    ]);
    expect(result.matrix?.openLoops).toHaveLength(1);
    expect(result.matrix?.openLoops[0]).toMatchObject({ id: "loop-1", status: "open", plantedSceneNumber: 5 });
  });

  it("applies no matrix changes when pendingMatrixUpdate is null", () => {
    const scene = setDraftText(createSceneRecord(2), "INT. ROOM - DAY\n\nAction.");
    const matrix = createEmptyContinuityMatrix();
    const result = canonizeScene({ scene, finalText: scene.draftText!, matrix, explicitApproval: true });
    expect(result.ok).toBe(true);
    expect(result.matrix).toEqual(createEmptyContinuityMatrix());
  });

  it("propagates confirmScene's immutability guard for a mismatched re-confirm", () => {
    let scene = setDraftText(createSceneRecord(1), "Original text");
    const matrix = createEmptyContinuityMatrix();
    const first = canonizeScene({ scene, finalText: "Original text", matrix, explicitApproval: true });
    scene = first.scene!;
    expect(() =>
      canonizeScene({ scene, finalText: "Changed text", matrix: first.matrix!, explicitApproval: true })
    ).toThrow();
  });
});
