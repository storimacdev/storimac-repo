import { vi, describe, it, expect } from "vitest";

vi.mock("@/lib/canonEngine/canonStore", () => ({
  listDependents: vi.fn().mockResolvedValue([]),
  WORLD_ELEMENTS_COLLECTION: "worldElements",
}));

vi.mock("@/lib/canonEngine/storyStore", () => ({
  appendP4CanonRevisionLog: vi.fn().mockResolvedValue(undefined),
  appendOutstandingQuestions: vi.fn().mockResolvedValue(undefined),
}));

import { resolveP4Conflict, buildP4ConflictContextMessage, type ResolveP4ConflictParams } from "./canonRevision";
import { createUnit, findUnit } from "./stateLedger";
import type { P4PendingConflict } from "@/lib/canonEngine/storyStore";
import * as storyStore from "@/lib/canonEngine/storyStore";

// A content string that satisfies checkSceneRegisterFormat (slugline +
// exactly 3 sentences) - used wherever a test needs the "accept_and_update
// lands at the requested status" path to NOT be clamped by issue #164's
// format check, so these tests isolate the behavior they're actually
// pinning down from that separate, orthogonal check.
const VALID_SCENE_CONTENT =
  "SCENE 9: INT. STUDY - NIGHT\n" +
  "The updated idea reflects a genuinely new direction. It satisfies the formatting bar on its own. This sentence makes three total.";

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
// requestedContent uses VALID_SCENE_CONTENT (not an arbitrary string) so
// issue #164's format clamp (added after these stepNumber tests were
// written) never fires here - these tests isolate stepNumber tagging,
// not format enforcement.
const canonContradictionConflict: P4PendingConflict = {
  kind: "canon_contradiction",
  unitId: "unit-contradiction-1",
  type: "Scene",
  sourceProject: "Project 1",
  contradictedRef: "world-element-42",
  explanation: "This scene contradicts a locked Story Foundation fact.",
  requestedStatus: "Working",
  requestedContent: VALID_SCENE_CONTENT,
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
 * Coverage for issue #164: the Canon Revision Path's accept_and_update
 * clamp previously only ever checked Scene Register format when
 * requestedStatus was "Confirmed" (via the stale gatesPassed snapshot).
 * A canon_contradiction requesting Working directly, or any
 * unit_regression (no gatesPassed data at all), reached Working with no
 * format check whatsoever. These tests pin down the fresh, universal
 * format re-check added to close that gap, including the
 * Confirmed -> Working -> Exploring cascade.
 */
describe("resolveP4Conflict - Scene Register format clamp (issue #164)", () => {
  const malformedContent = "This has no slugline at all and would fail checkSceneRegisterFormat.";

  it("clamps a canon_contradiction requesting Working directly down to Exploring when content is malformed", async () => {
    const conflict: P4PendingConflict = {
      ...canonContradictionConflict,
      requestedStatus: "Working",
      requestedContent: malformedContent,
      gatesPassed: true, // format is checked fresh here, independent of gatesPassed
    };
    const result = await resolveP4Conflict(baseParams({ conflict, resolution: "accept_and_update" }));
    const unit = findUnit(result.units, conflict.unitId);
    expect(unit?.status).toBe("Exploring");
  });

  it("cascades a canon_contradiction requesting Confirmed with malformed content all the way to Exploring", async () => {
    const conflict: P4PendingConflict = {
      ...canonContradictionConflict,
      requestedStatus: "Confirmed",
      requestedContent: malformedContent,
      gatesPassed: false, // already clamps Confirmed -> Working on its own
    };
    const result = await resolveP4Conflict(baseParams({ conflict, resolution: "accept_and_update" }));
    const unit = findUnit(result.units, conflict.unitId);
    // Working alone isn't good enough either, since the content is malformed.
    expect(unit?.status).toBe("Exploring");
  });

  it("stops at Working for a canon_contradiction requesting Confirmed when gatesPassed is false but format is actually valid", async () => {
    const conflict: P4PendingConflict = {
      ...canonContradictionConflict,
      requestedStatus: "Confirmed",
      requestedContent: VALID_SCENE_CONTENT,
      gatesPassed: false, // e.g. core-purpose or causal failed, not format
    };
    const result = await resolveP4Conflict(baseParams({ conflict, resolution: "accept_and_update" }));
    const unit = findUnit(result.units, conflict.unitId);
    expect(unit?.status).toBe("Working");
  });

  it("clamps a unit_regression (Confirmed -> Working) with malformed content down to Exploring", async () => {
    const conflict: P4PendingConflict = {
      ...unitRegressionConflict,
      requestedStatus: "Working",
      requestedContent: malformedContent,
    };
    const result = await resolveP4Conflict(baseParams({ conflict, resolution: "accept_and_update" }));
    const unit = findUnit(result.units, conflict.unitId);
    expect(unit?.status).toBe("Exploring");
  });

  it("never clamps 'park' - Parked carries no format requirement", async () => {
    const conflict: P4PendingConflict = {
      ...unitRegressionConflict,
      requestedContent: malformedContent,
    };
    const result = await resolveP4Conflict(baseParams({ conflict, resolution: "park" }));
    const unit = findUnit(result.units, conflict.unitId);
    expect(unit?.status).toBe("Parked");
  });
});

/**
 * Coverage for issue #154: isValidTransition(Confirmed, Confirmed) is
 * true, so a content-only rewrite of an already-Confirmed unit that
 * keeps requesting "Confirmed" is routed through the SAME
 * "unit_regression" conflict kind as a genuine status regression
 * (route.ts's own trigger-detection, not exercised here - these tests
 * cover the shared downstream pieces: the grounding text and log
 * description both need to describe this case honestly rather than
 * claiming a "regression to Confirmed," which never happened).
 */
describe("buildP4ConflictContextMessage - content-rewrite wording (issue #154)", () => {
  it("describes a genuine status regression as moving back to the requested status", () => {
    const message = buildP4ConflictContextMessage(unitRegressionConflict);
    expect(message).toContain(`move it back to ${unitRegressionConflict.requestedStatus}`);
    expect(message).not.toContain("rewrite its content");
  });

  it("describes a same-status content rewrite distinctly, without implying a status regression", () => {
    const contentRewrite: P4PendingConflict = { ...unitRegressionConflict, requestedStatus: "Confirmed" };
    const message = buildP4ConflictContextMessage(contentRewrite);
    expect(message).toContain("rewrite its content while keeping it Confirmed");
    expect(message).not.toContain("move it back to");
  });
});

/**
 * Coverage for issue #156: canon_revision_log entries previously
 * dropped the model's own explanation/requestedStatus/content excerpt -
 * the closest thing to the issue's own AC ("resolution choice AND
 * rationale"). These assert on the mocked appendP4CanonRevisionLog's
 * call arguments directly.
 */
describe("resolveP4Conflict - canon_revision_log enrichment (issue #156)", () => {
  it("includes explanation, requestedStatus, and a content excerpt for canon_contradiction", async () => {
    const appendLogMock = vi.mocked(storyStore.appendP4CanonRevisionLog);
    appendLogMock.mockClear();
    await resolveP4Conflict(baseParams({ conflict: canonContradictionConflict, resolution: "park" }));

    expect(appendLogMock).toHaveBeenCalledTimes(1);
    const entry = appendLogMock.mock.calls[0][1];
    expect(entry.explanation).toBe(canonContradictionConflict.explanation);
    expect(entry.requestedStatus).toBe(canonContradictionConflict.requestedStatus);
    expect(entry.contentExcerpt).toBe(canonContradictionConflict.requestedContent);
  });

  it("truncates a long content excerpt to 200 characters plus an ellipsis", async () => {
    const appendLogMock = vi.mocked(storyStore.appendP4CanonRevisionLog);
    appendLogMock.mockClear();
    const longContent = "A".repeat(250);
    const conflict: P4PendingConflict = { ...unitRegressionConflict, requestedContent: longContent };
    await resolveP4Conflict(baseParams({ conflict, resolution: "park" }));

    const entry = appendLogMock.mock.calls[0][1];
    expect(entry.contentExcerpt).toBe(`${"A".repeat(200)}…`);
  });

  it("omits explanation for unit_regression (no model rationale to carry)", async () => {
    const appendLogMock = vi.mocked(storyStore.appendP4CanonRevisionLog);
    appendLogMock.mockClear();
    await resolveP4Conflict(baseParams({ conflict: unitRegressionConflict, resolution: "park" }));

    const entry = appendLogMock.mock.calls[0][1];
    expect(entry.explanation).toBeUndefined();
    expect(entry.requestedStatus).toBe(unitRegressionConflict.requestedStatus);
  });
});
