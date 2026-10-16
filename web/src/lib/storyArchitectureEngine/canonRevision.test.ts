import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/canonEngine/canonStore", () => ({
  listDependents: vi.fn().mockResolvedValue([]),
  WORLD_ELEMENTS_COLLECTION: "worldElements",
}));

vi.mock("@/lib/canonEngine/storyStore", () => ({
  appendP4CanonRevisionLog: vi.fn().mockResolvedValue(undefined),
  appendP4ContinuityLedgerEntry: vi.fn().mockResolvedValue(undefined),
  appendOutstandingQuestions: vi.fn().mockResolvedValue(undefined),
}));

import { appendP4ContinuityLedgerEntry } from "@/lib/canonEngine/storyStore";
import { resolveP4Conflict, computeStructuralDownstream, type ResolveP4ConflictParams } from "./canonRevision";
import { createUnit, findUnit, type StructuralUnit } from "./stateLedger";
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

/**
 * Coverage for issue #72's cascade-tracing extension: structural-
 * downstream tracing (units built at a later structural step than the
 * affected unit), applied to BOTH Canon Revision Path trigger kinds,
 * merged/de-duplicated with the pre-existing same-canon-ref scan for
 * canon_contradiction.
 */

function makeUnit(overrides: Partial<StructuralUnit> & { unitId: string }): StructuralUnit {
  return {
    unitId: overrides.unitId,
    type: overrides.type ?? "Scene",
    status: overrides.status ?? "Working",
    content: overrides.content ?? "placeholder",
    causalTag: overrides.causalTag ?? "UNVALIDATED",
    canonRefs: overrides.canonRefs ?? [],
    stepNumber: overrides.stepNumber ?? null,
    lastUpdated: overrides.lastUpdated ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("computeStructuralDownstream (issue #72)", () => {
  it("returns [] when the affected unit's stepNumber is null", () => {
    const units = [makeUnit({ unitId: "a", stepNumber: null }), makeUnit({ unitId: "b", stepNumber: 5 })];
    expect(computeStructuralDownstream(units, "a")).toEqual([]);
  });

  it("returns [] when the affected unit isn't found in units", () => {
    const units = [makeUnit({ unitId: "b", stepNumber: 5 })];
    expect(computeStructuralDownstream(units, "missing")).toEqual([]);
  });

  it("returns only units with a strictly greater stepNumber, excluding the affected unit itself and units with equal/lesser/null stepNumber", () => {
    const units = [
      makeUnit({ unitId: "affected", stepNumber: 4 }),
      makeUnit({ unitId: "earlier", stepNumber: 2 }),
      makeUnit({ unitId: "same-step", stepNumber: 4 }),
      makeUnit({ unitId: "later-1", stepNumber: 6 }),
      makeUnit({ unitId: "later-2", stepNumber: 10 }),
      makeUnit({ unitId: "untagged", stepNumber: null }),
    ];
    const result = computeStructuralDownstream(units, "affected");
    expect(result.map((r) => r.id).sort()).toEqual(["later-1", "later-2"]);
    expect(result.every((r) => r.description.includes("later structural step"))).toBe(true);
  });
});

describe("resolveP4Conflict - cascade tracing extended to unit_regression (issue #72)", () => {
  it("populates cascadeReview with structural-downstream units for a unit_regression resolution (previously always null)", async () => {
    const regressedUnit = makeUnit({ unitId: unitRegressionConflict.unitId, status: "Confirmed", stepNumber: 3 });
    const laterUnit = makeUnit({ unitId: "later-unit", stepNumber: 8 });
    const earlierUnit = makeUnit({ unitId: "earlier-unit", stepNumber: 1 });

    const result = await resolveP4Conflict(
      baseParams({
        conflict: unitRegressionConflict,
        resolution: "accept_and_update",
        activeStepNumber: 3,
        units: [regressedUnit, laterUnit, earlierUnit],
      })
    );

    expect(result.cascadeReview).not.toBeNull();
    expect(result.cascadeReview?.map((e) => e.id)).toEqual(["later-unit"]);
  });

  it("returns an empty cascadeReview (not null) for unit_regression when nothing is downstream", async () => {
    const result = await resolveP4Conflict(
      baseParams({ conflict: unitRegressionConflict, resolution: "accept_and_update", activeStepNumber: null })
    );
    expect(result.cascadeReview).toEqual([]);
  });
});

describe("resolveP4Conflict - structural-downstream merged with same-ref citers for canon_contradiction (issue #72)", () => {
  it("merges same-ref-citer and structural-downstream results, de-duplicating a unit that appears in both", async () => {
    // "dupe" cites the same contradictedRef AND sits at a later step -
    // it must appear exactly once in the merged result.
    const dupe = makeUnit({ unitId: "dupe", stepNumber: 9, canonRefs: ["world-element-42"] });
    const onlyLaterStep = makeUnit({ unitId: "only-later-step", stepNumber: 7, canonRefs: [] });
    const onlySameRef = makeUnit({
      unitId: "only-same-ref",
      stepNumber: null,
      canonRefs: ["world-element-42"],
    });

    const result = await resolveP4Conflict(
      baseParams({
        conflict: canonContradictionConflict,
        resolution: "accept_and_update",
        activeStepNumber: 2,
        units: [dupe, onlyLaterStep, onlySameRef],
      })
    );

    expect(result.cascadeReview).not.toBeNull();
    const ids = result.cascadeReview!.map((e) => e.id).sort();
    expect(ids).toEqual(["dupe", "only-later-step", "only-same-ref"]);
  });
});

describe("resolveP4Conflict - Dependency & Continuity Ledger writes (issue #72)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes exactly one canon_revision ledger entry for 'revert'", async () => {
    await resolveP4Conflict(baseParams({ conflict: unitRegressionConflict, resolution: "revert" }));

    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledTimes(1);
    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledWith(
      "story-1",
      expect.objectContaining({ kind: "canon_revision", resolution: "revert", unitId: unitRegressionConflict.unitId })
    );
  });

  it("writes exactly one canon_revision ledger entry for 'park', no confirmed_transition entry", async () => {
    await resolveP4Conflict(baseParams({ conflict: unitRegressionConflict, resolution: "park" }));

    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledTimes(1);
    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledWith(
      "story-1",
      expect.objectContaining({ kind: "canon_revision", resolution: "park" })
    );
  });

  it("writes a canon_revision entry AND a confirmed_transition entry when accept_and_update lands on Confirmed from a non-Confirmed prior state", async () => {
    const confirmableContradiction: P4PendingConflict = {
      ...canonContradictionConflict,
      requestedStatus: "Confirmed",
      gatesPassed: true,
    };

    await resolveP4Conflict(
      baseParams({ conflict: confirmableContradiction, resolution: "accept_and_update", units: [] })
    );

    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledTimes(2);
    expect(appendP4ContinuityLedgerEntry).toHaveBeenNthCalledWith(
      1,
      "story-1",
      expect.objectContaining({ kind: "canon_revision", resolution: "accept_and_update" })
    );
    expect(appendP4ContinuityLedgerEntry).toHaveBeenNthCalledWith(
      2,
      "story-1",
      expect.objectContaining({ kind: "confirmed_transition", unitId: confirmableContradiction.unitId })
    );
  });

  it("does NOT write a confirmed_transition entry when accept_and_update is clamped to Working by the gates-not-passed rule", async () => {
    const clampedContradiction: P4PendingConflict = {
      ...canonContradictionConflict,
      requestedStatus: "Confirmed",
      gatesPassed: false,
    };

    const result = await resolveP4Conflict(
      baseParams({ conflict: clampedContradiction, resolution: "accept_and_update", units: [] })
    );

    const unit = findUnit(result.units, clampedContradiction.unitId);
    expect(unit?.status).toBe("Working");
    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledTimes(1);
    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledWith(
      "story-1",
      expect.objectContaining({ kind: "canon_revision" })
    );
  });

  it("does NOT write a confirmed_transition entry when the unit was already Confirmed before this resolution", async () => {
    const alreadyConfirmed = makeUnit({
      unitId: canonContradictionConflict.unitId,
      status: "Confirmed",
      canonRefs: ["world-element-42"],
    });
    const confirmableContradiction: P4PendingConflict = {
      ...canonContradictionConflict,
      requestedStatus: "Confirmed",
      gatesPassed: true,
    };

    await resolveP4Conflict(
      baseParams({ conflict: confirmableContradiction, resolution: "accept_and_update", units: [alreadyConfirmed] })
    );

    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledTimes(1);
    expect(appendP4ContinuityLedgerEntry).toHaveBeenCalledWith(
      "story-1",
      expect.objectContaining({ kind: "canon_revision" })
    );
  });
});
