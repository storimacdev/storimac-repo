import { describe, it, expect } from "vitest";
import {
  checkFlashbackMarkers,
  validateFlashbackJustification,
  checkMontageMarkers,
  validateMontageShots,
  checkMotifAndSoundBridgeClosures,
  validateSpecialProcessingPaths,
} from "./specialProcessingPaths";
import { createEmptyContinuityMatrix, type ContinuityMatrix } from "./continuityMatrix";

describe("checkFlashbackMarkers", () => {
  it("passes a balanced BEGIN/END pair", () => {
    const text = `INT. ROOM - DAY\n\nBEGIN FLASHBACK:\n\nAction.\n\nEND FLASHBACK.`;
    const result = checkFlashbackMarkers(text);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
  });

  it("passes text with no flashback at all", () => {
    expect(checkFlashbackMarkers("INT. ROOM - DAY\n\nAction.").ok).toBe(true);
  });

  it("rejects an unclosed BEGIN", () => {
    const text = `BEGIN FLASHBACK:\n\nAction.`;
    expect(checkFlashbackMarkers(text).ok).toBe(false);
  });

  it("rejects an END with no matching BEGIN", () => {
    const text = `Action.\n\nEND FLASHBACK.`;
    expect(checkFlashbackMarkers(text).ok).toBe(false);
  });

  it("rejects a nested BEGIN before the prior one closes", () => {
    const text = `BEGIN FLASHBACK:\n\nBEGIN FLASHBACK:\n\nEND FLASHBACK.`;
    expect(checkFlashbackMarkers(text).ok).toBe(false);
  });

  it("counts multiple sequential (non-overlapping) flashbacks", () => {
    const text = `BEGIN FLASHBACK:\n\nA\n\nEND FLASHBACK.\n\nBEGIN FLASHBACK:\n\nB\n\nEND FLASHBACK.`;
    const result = checkFlashbackMarkers(text);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
  });
});

describe("validateFlashbackJustification", () => {
  it("is a no-op when no flashback is present", () => {
    expect(validateFlashbackJustification(false, "").ok).toBe(true);
  });

  it("rejects a present flashback with no justification", () => {
    expect(validateFlashbackJustification(true, "").ok).toBe(false);
  });

  it("accepts a present flashback with a justification", () => {
    expect(validateFlashbackJustification(true, "Reveals why Alex can't trust Jordan now.").ok).toBe(true);
  });
});

describe("checkMontageMarkers", () => {
  it("passes a balanced BEGIN/END MONTAGE pair", () => {
    const text = `BEGIN MONTAGE:\n\nShot one.\n\nShot two.\n\nEND MONTAGE.`;
    expect(checkMontageMarkers(text).ok).toBe(true);
  });

  it("rejects an unbalanced montage", () => {
    expect(checkMontageMarkers("BEGIN MONTAGE:\n\nShot one.").ok).toBe(false);
  });
});

describe("validateMontageShots", () => {
  it("rejects fewer than 2 shots", () => {
    expect(validateMontageShots([{ description: "a", evolutionDescription: "b" }]).ok).toBe(false);
  });

  it("rejects a shot missing an evolution description", () => {
    const result = validateMontageShots([
      { description: "Alex packs a bag", evolutionDescription: "" },
      { description: "Alex unpacks it", evolutionDescription: "Resolve hardens" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("accepts 2+ fully described shots", () => {
    const result = validateMontageShots([
      { description: "Alex packs a bag", evolutionDescription: "Doubt creeps in" },
      { description: "Alex unpacks it", evolutionDescription: "Resolve hardens" },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("checkMotifAndSoundBridgeClosures", () => {
  it("rejects closing a motif loop that was never planted", () => {
    const result = checkMotifAndSoundBridgeClosures(createEmptyContinuityMatrix(), ["motif-1"]);
    expect(result.ok).toBe(false);
  });

  it("accepts closing a motif loop that exists", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [],
      physicalTracking: [],
      openLoops: [
        {
          id: "motif-1",
          description: "Recurring red door",
          kind: "visual_motif",
          plantedSceneNumber: 3,
          payoffSceneNumber: null,
          status: "open",
          closedSceneNumber: null,
        },
      ],
    };
    expect(checkMotifAndSoundBridgeClosures(matrix, ["motif-1"]).ok).toBe(true);
  });
});

describe("validateSpecialProcessingPaths", () => {
  const matrix = createEmptyContinuityMatrix();

  it("passes clean plain text with no special constructs", () => {
    const result = validateSpecialProcessingPaths("INT. ROOM - DAY\n\nAction.", matrix, {
      flashback: null,
      montage: null,
      loopsToClose: [],
    });
    expect(result.ok).toBe(true);
  });

  it("blocks when a flashback is present but unjustified", () => {
    const text = `BEGIN FLASHBACK:\n\nAction.\n\nEND FLASHBACK.`;
    const result = validateSpecialProcessingPaths(text, matrix, {
      flashback: { present: true, justification: "" },
      montage: null,
      loopsToClose: [],
    });
    expect(result.ok).toBe(false);
  });

  it("blocks when montage markers are unbalanced", () => {
    const text = `BEGIN MONTAGE:\n\nShot one.`;
    const result = validateSpecialProcessingPaths(text, matrix, {
      flashback: null,
      montage: null,
      loopsToClose: [],
    });
    expect(result.ok).toBe(false);
  });

  it("blocks when montage shots are reported incomplete", () => {
    const text = `BEGIN MONTAGE:\n\nShot one.\n\nShot two.\n\nEND MONTAGE.`;
    const result = validateSpecialProcessingPaths(text, matrix, {
      flashback: null,
      montage: { present: true, shots: [{ description: "a", evolutionDescription: "" }] },
      loopsToClose: [],
    });
    expect(result.ok).toBe(false);
  });

  it("blocks when closing a loop that was never planted", () => {
    const result = validateSpecialProcessingPaths("INT. ROOM - DAY\n\nAction.", matrix, {
      flashback: null,
      montage: null,
      loopsToClose: ["motif-1"],
    });
    expect(result.ok).toBe(false);
  });

  it("passes a fully valid flashback + montage + loop closure combination", () => {
    const matrixWithLoop: ContinuityMatrix = {
      ...matrix,
      openLoops: [
        {
          id: "motif-1",
          description: "Recurring red door",
          kind: "visual_motif",
          plantedSceneNumber: 1,
          payoffSceneNumber: null,
          status: "open",
          closedSceneNumber: null,
        },
      ],
    };
    const text = `BEGIN FLASHBACK:\n\nAction.\n\nEND FLASHBACK.\n\nBEGIN MONTAGE:\n\nShot one.\n\nShot two.\n\nEND MONTAGE.`;
    const result = validateSpecialProcessingPaths(text, matrixWithLoop, {
      flashback: { present: true, justification: "Explains Alex's hesitation now." },
      montage: {
        present: true,
        shots: [
          { description: "Alex packs a bag", evolutionDescription: "Doubt creeps in" },
          { description: "Alex unpacks it", evolutionDescription: "Resolve hardens" },
        ],
      },
      loopsToClose: ["motif-1"],
    });
    expect(result.ok).toBe(true);
  });
});
