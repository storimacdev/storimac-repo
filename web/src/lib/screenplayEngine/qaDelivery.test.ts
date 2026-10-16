import { describe, it, expect } from "vitest";
import {
  buildVisualStorytellingCheck,
  buildLeanActionWhiteSpaceAudit,
  buildDialogueVoiceAudit,
  buildOpenClosedLoopsRegister,
  buildRevisionInvitation,
  buildComplianceReport,
  formatScreenplayDelivery,
  SCREENPLAY_SECTION_DIVIDER,
} from "./qaDelivery";
import { createEmptyContinuityMatrix, type ContinuityMatrix } from "./continuityMatrix";

describe("buildVisualStorytellingCheck", () => {
  it("confirms a clean draft with no findings", () => {
    expect(buildVisualStorytellingCheck([])).toContain("Confirmed");
  });

  it("lists each flagged finding", () => {
    const result = buildVisualStorytellingCheck([
      { blockIndex: 0, kind: "internal_thought", matchedPhrase: "knows deep down", excerpt: "Alex knows deep down" },
    ]);
    expect(result).toContain("1 potential");
    expect(result).toContain("knows deep down");
  });
});

describe("buildLeanActionWhiteSpaceAudit", () => {
  it("confirms when every paragraph is lean", () => {
    expect(buildLeanActionWhiteSpaceAudit([])).toContain("Confirmed");
  });

  it("lists over-length blocks", () => {
    const result = buildLeanActionWhiteSpaceAudit([{ blockIndex: 2, lineCount: 5, excerpt: "Long block" }]);
    expect(result).toContain("Block 3");
    expect(result).toContain("5 lines");
  });
});

describe("buildDialogueVoiceAudit", () => {
  it("reports clean subtext", () => {
    const result = buildDialogueVoiceAudit({ subtextPresent: true, notes: "" });
    expect(result).toContain("Subtext present");
    expect(result).toContain("no additional notes");
  });

  it("flags a lack of subtext with notes", () => {
    const result = buildDialogueVoiceAudit({ subtextPresent: false, notes: "Line 4 states the theme outright." });
    expect(result).toContain("Flagged");
    expect(result).toContain("Line 4 states the theme outright.");
  });
});

describe("buildOpenClosedLoopsRegister", () => {
  const matrix: ContinuityMatrix = {
    knowledgeLedger: [],
    physicalTracking: [],
    openLoops: [
      { id: "l1", description: "The gun", kind: "setup", plantedSceneNumber: 5, payoffSceneNumber: null, status: "open", closedSceneNumber: null },
      { id: "l2", description: "The red door", kind: "visual_motif", plantedSceneNumber: 2, payoffSceneNumber: null, status: "closed", closedSceneNumber: 5 },
      { id: "l3", description: "A ticking clock", kind: "sound_cue", plantedSceneNumber: 1, payoffSceneNumber: null, status: "open", closedSceneNumber: null },
    ],
  };

  it("lists loops opened and closed in the given scene, and all still-open loops", () => {
    const result = buildOpenClosedLoopsRegister(matrix, 5);
    expect(result).toContain("Opened this scene: [l1]");
    expect(result).toContain("Closed this scene: [l2]");
    expect(result).toContain("Still open overall (2)");
    expect(result).toContain("[l1]");
    expect(result).toContain("[l3]");
  });

  it("reports 'none' for a scene with no activity", () => {
    const result = buildOpenClosedLoopsRegister(matrix, 99);
    expect(result).toContain("Opened this scene: none.");
    expect(result).toContain("Closed this scene: none.");
  });

  it("reports no outstanding loops when the matrix is empty", () => {
    const result = buildOpenClosedLoopsRegister(createEmptyContinuityMatrix(), 1);
    expect(result).toContain("No Open Loops remain outstanding.");
  });
});

describe("buildRevisionInvitation", () => {
  it("names all four required topics", () => {
    const result = buildRevisionInvitation();
    expect(result).toContain("visual clarity");
    expect(result).toContain("dialogue rhythm");
    expect(result).toContain("scene pacing");
    expect(result).toContain("subtext intensity");
  });
});

describe("buildComplianceReport", () => {
  it("composes all five sections", () => {
    const report = buildComplianceReport({
      visualDisciplineFindings: [],
      leanParagraphFindings: [],
      dialogueVoiceAudit: { subtextPresent: true, notes: "" },
      matrix: createEmptyContinuityMatrix(),
      sceneNumber: 1,
    });
    expect(report.visualStorytellingCheck).toContain("Confirmed");
    expect(report.leanActionWhiteSpaceAudit).toContain("Confirmed");
    expect(report.dialogueVoiceAudit).toContain("Subtext present");
    expect(report.openClosedLoopsRegister).toContain("No Open Loops");
    expect(report.revisionInvitation).toContain("visual clarity");
  });
});

describe("formatScreenplayDelivery", () => {
  it("wraps both blocks in the exact divider, in order", () => {
    const compliance = buildComplianceReport({
      visualDisciplineFindings: [],
      leanParagraphFindings: [],
      dialogueVoiceAudit: { subtextPresent: true, notes: "" },
      matrix: createEmptyContinuityMatrix(),
      sceneNumber: 1,
    });
    const output = formatScreenplayDelivery("INT. ROOM - DAY\n\nAction.", compliance);
    const screenplayIndex = output.indexOf("THE SCREENPLAY");
    const complianceIndex = output.indexOf("COMPLIANCE REPORT");
    expect(screenplayIndex).toBeGreaterThan(-1);
    expect(complianceIndex).toBeGreaterThan(screenplayIndex);
    expect(output.split(SCREENPLAY_SECTION_DIVIDER).length - 1).toBe(4);
  });

  it("never injects anything into the pure screenplay text itself", () => {
    const compliance = buildComplianceReport({
      visualDisciplineFindings: [],
      leanParagraphFindings: [],
      dialogueVoiceAudit: { subtextPresent: true, notes: "" },
      matrix: createEmptyContinuityMatrix(),
      sceneNumber: 1,
    });
    const screenplayText = "INT. ROOM - DAY\n\nAction only, nothing else.";
    const output = formatScreenplayDelivery(screenplayText, compliance);
    const screenplayBlock = output.split("COMPLIANCE REPORT")[0];
    expect(screenplayBlock).toContain(screenplayText);
    expect(screenplayBlock).not.toContain("Visual Storytelling Check");
  });
});
