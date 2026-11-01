import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/canonEngine/storyStore", () => ({
  appendP5ConflictLog: vi.fn().mockResolvedValue(undefined),
}));

import {
  buildP5ConflictContextMessage,
  computeDownstreamContinuityDamage,
  resolveP5Conflict,
  type ResolveP5ConflictParams,
} from "./conflictIntercept";
import { appendP5ConflictLog } from "@/lib/canonEngine/storyStore";
import type { P5PendingConflict } from "@/lib/canonEngine/storyStore";
import { createSceneRecord, setDraftText, confirmScene } from "./sceneLedger";
import { createEmptyContinuityMatrix, type ContinuityMatrix } from "./continuityMatrix";

const structuralDeviationConflict: P5PendingConflict = {
  kind: "structural_deviation",
  sceneNumber: 10,
  explanation: "Draft removes the Midpoint turning point entirely.",
  requestedDraftText: "INT. ROOM - DAY\n\nNew content.",
  requestedMatrixUpdate: {},
  ts: "2026-01-01T00:00:00.000Z",
};

const continuityContradictionConflict: P5PendingConflict = {
  kind: "continuity_contradiction",
  sceneNumber: 10,
  violations: [{ kind: "unearned_knowledge", message: "Jordan acts on a fact never established on screen." }],
  requestedDraftText: "INT. ROOM - DAY\n\nJordan confronts Alex about the affair.",
  requestedMatrixUpdate: {},
  ts: "2026-01-01T00:00:00.000Z",
};

function baseParams(overrides: Partial<ResolveP5ConflictParams>): ResolveP5ConflictParams {
  return {
    storyId: "story-1",
    conflict: structuralDeviationConflict,
    resolution: "park",
    turnId: "turn-1",
    resolvedBy: "author-1",
    scenes: [createSceneRecord(10)],
    matrix: createEmptyContinuityMatrix(),
    ...overrides,
  };
}

describe("buildP5ConflictContextMessage", () => {
  it("describes a structural deviation and the three resolution choices", () => {
    const message = buildP5ConflictContextMessage(structuralDeviationConflict, []);
    expect(message).toContain("Scene 10");
    expect(message).toContain("Midpoint turning point");
    expect(message).toContain("(A) Revert");
    expect(message).toContain("(B) Accept");
    expect(message).toContain("(C) Park");
  });

  it("describes a continuity contradiction with its violation messages", () => {
    const message = buildP5ConflictContextMessage(continuityContradictionConflict, []);
    expect(message).toContain("never established on screen");
  });

  it("includes downstream damage when present, and a clean note when absent", () => {
    const withDamage = buildP5ConflictContextMessage(structuralDeviationConflict, ["Scene 12 may need review."]);
    expect(withDamage).toContain("Scene 12 may need review.");
    const withoutDamage = buildP5ConflictContextMessage(structuralDeviationConflict, []);
    expect(withoutDamage).toContain("No downstream Confirmed scenes or Open Loops");
  });
});

describe("computeDownstreamContinuityDamage", () => {
  it("lists later Confirmed scenes", () => {
    const scenes = [
      createSceneRecord(10),
      confirmScene(setDraftText(createSceneRecord(12), "text"), "text"),
      confirmScene(setDraftText(createSceneRecord(15), "text"), "text"),
    ];
    const result = computeDownstreamContinuityDamage(createEmptyContinuityMatrix(), scenes, 10);
    expect(result.some((r) => r.includes("12, 15"))).toBe(true);
  });

  it("lists Open Loops planted or closed at this scene number", () => {
    const matrix: ContinuityMatrix = {
      knowledgeLedger: [],
      physicalTracking: [],
      openLoops: [
        { id: "loop-1", description: "The gun", kind: "setup", plantedSceneNumber: 10, payoffSceneNumber: null, status: "open", closedSceneNumber: null },
      ],
    };
    const result = computeDownstreamContinuityDamage(matrix, [], 10);
    expect(result.some((r) => r.includes("The gun"))).toBe(true);
  });

  it("returns an empty array with no downstream effects", () => {
    expect(computeDownstreamContinuityDamage(createEmptyContinuityMatrix(), [createSceneRecord(10)], 10)).toEqual([]);
  });
});

describe("resolveP5Conflict", () => {
  it("parks the scene on 'park' resolution and logs it", async () => {
    const result = await resolveP5Conflict(baseParams({ resolution: "park" }));
    expect(result.scenes.find((s) => s.sceneNumber === 10)?.status).toBe("Parked");
    expect(appendP5ConflictLog).toHaveBeenCalledWith(
      "story-1",
      expect.objectContaining({ resolution: "park", sceneNumber: 10 })
    );
  });

  it("leaves scenes/matrix untouched on 'revert', but still logs it", async () => {
    const scenes = [createSceneRecord(10)];
    const matrix = createEmptyContinuityMatrix();
    const result = await resolveP5Conflict(baseParams({ resolution: "revert", scenes, matrix }));
    expect(result.scenes).toEqual(scenes);
    expect(result.matrix).toEqual(matrix);
    expect(appendP5ConflictLog).toHaveBeenCalledWith(
      "story-1",
      expect.objectContaining({ resolution: "revert" })
    );
  });

  it("writes the requested draft and applies the matrix update on 'accept_and_update'", async () => {
    const result = await resolveP5Conflict(
      baseParams({
        resolution: "accept_and_update",
        conflict: {
          ...continuityContradictionConflict,
          requestedMatrixUpdate: {
            knowledgeGained: [{ characterId: "jordan", characterName: "Jordan", fact: "the affair", state: "knows" }],
          },
        },
      })
    );
    const scene = result.scenes.find((s) => s.sceneNumber === 10);
    expect(scene?.status).toBe("Working");
    expect(scene?.draftText).toContain("Jordan confronts Alex");
    expect(result.matrix.knowledgeLedger).toEqual([
      { characterId: "jordan", characterName: "Jordan", fact: "the affair", state: "knows", sinceSceneNumber: 10 },
    ]);
  });

  it("accept_and_update never reaches Confirmed on its own", async () => {
    const result = await resolveP5Conflict(baseParams({ resolution: "accept_and_update" }));
    expect(result.scenes.find((s) => s.sceneNumber === 10)?.status).not.toBe("Confirmed");
  });
});
