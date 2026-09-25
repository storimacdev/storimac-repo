import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/canonEngine/canonStore", () => ({
  listDependents: vi.fn().mockResolvedValue([]),
  WORLD_ELEMENTS_COLLECTION: "worldElements",
}));

vi.mock("@/lib/canonEngine/storyStore", () => ({
  appendP4CanonRevisionLog: vi.fn().mockResolvedValue(undefined),
  appendOutstandingQuestions: vi.fn().mockResolvedValue(undefined),
}));

import { resolveP4Conflict, type ResolveP4ConflictParams } from "./canonRevision";
import { createUnit, findUnit } from "./stateLedger";
import type { P4PendingConflict } from "@/lib/canonEngine/storyStore";

/**
 * Regression coverage for the final whole-branch review finding (issue
 * #56): resolveP4Conflict's "park" and "accept_and_update" branches
 * previously never tagged the resolved unit's stepNumber, biasing
 * sceneDensity.ts's projection upward (every unit resolved through this
 * path counted toward the numerator with no representation in the
 * step-coverage denominator). These tests pin down the fix -
 * `activeStepNumber !== null ? setUnitStepNumber(...) : contentApplied` -
 * from both sides: tagged when non-null, left alone (not coerced) when null.
 */

const unitRegressionConflict: P4PendingConflict = {
  kind: "unit_regression",
  unitId: "unit-regression-1",
  type: "Scene",
  requestedStatus: "Working",
  requestedContent: "The author's latest proposal for this scene.",
  requestedCanonRefs: [],
  ts: "2026-01-01T00:00:00.000Z",
};

// sourceProject is "Project 1" (not "Project 3") so resolveP4Conflict never
// calls listDependents for real cascade data - the mock's [] is enough.
const canonContradictionConflict: P4PendingConflict = {
  kind: "canon_contradiction",
  unitId: "unit-contradiction-1",
  type: "Scene",
  sourceProject: "Project 1",
  contradictedRef: "world-element-42",
  explanation: "This scene contradicts a locked Story Foundation fact.",
  requestedStatus: "Working",
  requestedContent: "Updated scene content reflecting the new idea.",
  requestedCanonRefs: ["world-element-42"],
  gatesPassed: true,
  ts: "2026-01-01T00:00:00.000Z",
};

function baseParams(overrides: Partial<ResolveP4ConflictParams>): ResolveP4ConflictParams {
  return {
    storyId: "story-1",
    conflict: unitRegressionConflict,
    resolution: "park",
    turnId: "turn-1",
    resolvedBy: "author-1",
    units: [],
    activeStepNumber: null,
    ...overrides,
  };
}

describe("resolveP4Conflict - stepNumber tagging (issue #56 final review fix)", () => {
  it("tags the resolved unit's stepNumber on 'park' when activeStepNumber is non-null", async () => {
    const result = await resolveP4Conflict(
      baseParams({ conflict: unitRegressionConflict, resolution: "park", activeStepNumber: 4 })
    );

    const unit = findUnit(result.units, unitRegressionConflict.unitId);
    expect(unit).not.toBeNull();
    expect(unit?.stepNumber).toBe(4);
    expect(unit?.status).toBe("Parked");
    expect(unit?.content).toBe(unitRegressionConflict.requestedContent);
  });

  it("tags the resolved unit's stepNumber on 'accept_and_update' when activeStepNumber is non-null", async () => {
    const result = await resolveP4Conflict(
      baseParams({ conflict: canonContradictionConflict, resolution: "accept_and_update", activeStepNumber: 4 })
    );

    const unit = findUnit(result.units, canonContradictionConflict.unitId);
    expect(unit).not.toBeNull();
    expect(unit?.stepNumber).toBe(4);
    expect(unit?.status).toBe("Working");
    expect(unit?.canonRefs).toEqual(["world-element-42"]);
    expect(result.cascadeReview).toEqual([]);
  });

  it("leaves stepNumber null (not coerced to a default) on 'park' when activeStepNumber is null", async () => {
    const result = await resolveP4Conflict(
      baseParams({ conflict: unitRegressionConflict, resolution: "park", activeStepNumber: null })
    );

    const unit = findUnit(result.units, unitRegressionConflict.unitId);
    expect(unit).not.toBeNull();
    expect(unit?.stepNumber).toBeNull();
  });

  it("leaves stepNumber null (not coerced to a default) on 'accept_and_update' when activeStepNumber is null", async () => {
    const result = await resolveP4Conflict(
      baseParams({ conflict: canonContradictionConflict, resolution: "accept_and_update", activeStepNumber: null })
    );

    const unit = findUnit(result.units, canonContradictionConflict.unitId);
    expect(unit).not.toBeNull();
    expect(unit?.stepNumber).toBeNull();
  });

  it("tags stepNumber on a pre-existing ledger unit as well as a newly created one", async () => {
    const existingUnit = createUnit(unitRegressionConflict.unitId, "Scene");
    const result = await resolveP4Conflict(
      baseParams({
        conflict: unitRegressionConflict,
        resolution: "park",
        activeStepNumber: 7,
        units: [existingUnit],
      })
    );

    const unit = findUnit(result.units, unitRegressionConflict.unitId);
    expect(unit).not.toBeNull();
    expect(unit?.stepNumber).toBe(7);
    expect(result.units).toHaveLength(1);
  });
});
