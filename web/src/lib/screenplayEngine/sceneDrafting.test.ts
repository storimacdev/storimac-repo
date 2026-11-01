import { describe, it, expect } from "vitest";
import {
  parseScreenplayBlocks,
  checkLeanActionParagraphs,
  checkVisualDiscipline,
  validateConflictMandateReport,
  validateEnterLateLeaveEarlyReport,
  validateSceneDraft,
} from "./sceneDrafting";

const GOOD_SCENE = `INT. KITCHEN - NIGHT

Alex grips the counter. A kettle screams on the stove.

JORDAN
You weren't going to tell me.

Alex kills the burner. Steam curls between them.

ALEX
I was going to.`;

describe("parseScreenplayBlocks", () => {
  it("classifies a slugline block as heading", () => {
    const blocks = parseScreenplayBlocks(GOOD_SCENE);
    expect(blocks[0].kind).toBe("heading");
  });

  it("classifies a character-cue-first multi-line block as dialogue", () => {
    const blocks = parseScreenplayBlocks(GOOD_SCENE);
    const dialogue = blocks.filter((b) => b.kind === "dialogue");
    expect(dialogue).toHaveLength(2);
    expect(dialogue[0].lines[0]).toBe("JORDAN");
  });

  it("classifies plain prose as action", () => {
    const blocks = parseScreenplayBlocks(GOOD_SCENE);
    expect(blocks.some((b) => b.kind === "action")).toBe(true);
  });

  it("tags transition keywords and flashback markers as their own kinds", () => {
    const text = `INT. ROOM - DAY\n\nAction line.\n\nCUT TO:\n\nEXT. STREET - DAY\n\nBEGIN FLASHBACK:\n\nMore action.\n\nEND FLASHBACK.`;
    const blocks = parseScreenplayBlocks(text);
    expect(blocks.find((b) => b.lines[0] === "CUT TO:")?.kind).toBe("transition");
    expect(blocks.find((b) => b.lines[0].startsWith("BEGIN FLASHBACK"))?.kind).toBe("other");
  });
});

describe("checkLeanActionParagraphs", () => {
  it("passes a 3-line-or-fewer action block", () => {
    expect(checkLeanActionParagraphs(GOOD_SCENE).ok).toBe(true);
  });

  it("flags an action block longer than 3 lines", () => {
    const text = `INT. ROOM - DAY\n\nLine one.\nLine two.\nLine three.\nLine four.`;
    const result = checkLeanActionParagraphs(text);
    expect(result.ok).toBe(false);
    expect(result.findings[0].lineCount).toBe(4);
  });

  it("never flags dialogue or heading blocks, however long", () => {
    const text = `INT. ROOM - DAY\n\nJORDAN\nLine one.\nLine two.\nLine three.\nLine four.`;
    expect(checkLeanActionParagraphs(text).ok).toBe(true);
  });
});

describe("checkVisualDiscipline", () => {
  it("passes clean, externally-observable action", () => {
    expect(checkVisualDiscipline(GOOD_SCENE).ok).toBe(true);
  });

  it("flags internal-thought language in an action block", () => {
    const text = `INT. ROOM - DAY\n\nAlex knows deep down this is a mistake.`;
    const result = checkVisualDiscipline(text);
    expect(result.ok).toBe(false);
    expect(result.findings[0].kind).toBe("internal_thought");
  });

  it("flags camera-direction language in an action block", () => {
    const text = `INT. ROOM - DAY\n\nCLOSE ON the ring as it falls.`;
    const result = checkVisualDiscipline(text);
    expect(result.ok).toBe(false);
    expect(result.findings[0].kind).toBe("camera_direction");
  });

  it("does not flag a legitimate CUT TO: transition block", () => {
    const text = `INT. ROOM - DAY\n\nAlex exits.\n\nCUT TO:\n\nEXT. STREET - DAY`;
    expect(checkVisualDiscipline(text).ok).toBe(true);
  });
});

describe("validateConflictMandateReport", () => {
  it("rejects when no opposition is present", () => {
    const result = validateConflictMandateReport({
      present: false,
      oppositionDescription: "",
      permanentShiftDescription: "",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a present-but-undescribed opposition", () => {
    const result = validateConflictMandateReport({
      present: true,
      oppositionDescription: "",
      permanentShiftDescription: "Alex now knows the truth.",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when no permanent shift is described", () => {
    const result = validateConflictMandateReport({
      present: true,
      oppositionDescription: "Jordan wants the truth; Alex wants to protect them.",
      permanentShiftDescription: "",
    });
    expect(result.ok).toBe(false);
  });

  it("accepts a fully reported conflict mandate", () => {
    const result = validateConflictMandateReport({
      present: true,
      oppositionDescription: "Jordan wants the truth; Alex wants to protect them.",
      permanentShiftDescription: "Jordan now knows about the affair.",
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateEnterLateLeaveEarlyReport", () => {
  it("rejects a scene that doesn't enter late or leave early", () => {
    const result = validateEnterLateLeaveEarlyReport({
      enteredLate: false,
      leftEarly: true,
      reason: "Opens with a few lines of small talk before the conflict.",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty justification even if both flags are true", () => {
    const result = validateEnterLateLeaveEarlyReport({ enteredLate: true, leftEarly: true, reason: "" });
    expect(result.ok).toBe(false);
  });

  it("accepts a fully reported compliant scene", () => {
    const result = validateEnterLateLeaveEarlyReport({
      enteredLate: true,
      leftEarly: true,
      reason: "Opens mid-argument; cuts the instant Alex confesses.",
    });
    expect(result.ok).toBe(true);
  });
});

describe("validateSceneDraft", () => {
  const goodReports = {
    conflictMandate: {
      present: true,
      oppositionDescription: "Jordan wants the truth; Alex wants to protect them.",
      permanentShiftDescription: "Jordan now knows about the affair.",
    },
    enterLateLeaveEarly: {
      enteredLate: true,
      leftEarly: true,
      reason: "Opens mid-argument; cuts the instant Alex confesses.",
    },
  };

  it("passes a clean draft with fully reported standards", () => {
    const result = validateSceneDraft(GOOD_SCENE, goodReports);
    expect(result.ok).toBe(true);
    expect(result.blockingReasons).toEqual([]);
  });

  it("blocks when the Conflict Mandate report fails, even with clean prose", () => {
    const result = validateSceneDraft(GOOD_SCENE, {
      ...goodReports,
      conflictMandate: { present: false, oppositionDescription: "", permanentShiftDescription: "" },
    });
    expect(result.ok).toBe(false);
    expect(result.blockingReasons.length).toBeGreaterThan(0);
  });

  it("surfaces lean-paragraph and visual-discipline findings as advisory, not blocking", () => {
    const messyText = `INT. ROOM - DAY\n\nAlex knows deep down this is wrong.\nLine two.\nLine three.\nLine four.`;
    const result = validateSceneDraft(messyText, goodReports);
    expect(result.ok).toBe(true);
    expect(result.advisoryFindings.leanParagraphs.length).toBeGreaterThan(0);
    expect(result.advisoryFindings.visualDiscipline.length).toBeGreaterThan(0);
  });
});
