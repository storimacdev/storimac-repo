import { describe, it, expect } from "vitest";
import { checkThematicAnchorCoverage, THEMATIC_ANCHOR_STEPS } from "./thematicAnchorAudit";
import { createUnit, setUnitContent, setUnitStatus, setUnitStepNumber, type StructuralUnit } from "./stateLedger";

/**
 * Scope note (see task-6-brief.md): only `checkThematicAnchorCoverage` is
 * under test here - the fully deterministic, no-I/O half of this audit.
 * `runThematicAnchorConsistencyCheck` / `runThematicAnchorAudit` make a real
 * Anthropic API call via extractTurn and are out of scope for this suite.
 */

/** A Confirmed unit tagged to `stepNumber` with real (non-empty) content -
 * built via stateLedger's own createUnit/setUnitStepNumber/setUnitStatus/
 * setUnitContent, never a hand-rolled StructuralUnit, matching this file's
 * sibling sceneDensity.test.ts's existing convention. */
function buildConfirmedUnitAtStep(unitId: string, stepNumber: number): StructuralUnit {
  return setUnitContent(
    setUnitStatus(setUnitStepNumber(createUnit(unitId, "Scene"), stepNumber), "Confirmed"),
    `Real scene content for step ${stepNumber}.`
  );
}

/** Same as above but left at "Working" status - exists at the right step
 * number but isn't Confirmed. checkThematicAnchorCoverage only counts
 * Confirmed content (via stateLedger's getConfirmedUnits), so this must
 * not count as coverage. */
function buildWorkingUnitAtStep(unitId: string, stepNumber: number): StructuralUnit {
  return setUnitContent(
    setUnitStatus(setUnitStepNumber(createUnit(unitId, "Scene"), stepNumber), "Working"),
    `Draft content for step ${stepNumber}, not yet Confirmed.`
  );
}

describe("checkThematicAnchorCoverage", () => {
  it("passes with a single 'coverage-complete' finding when every anchor step has Confirmed content", () => {
    const units = THEMATIC_ANCHOR_STEPS.map((stepNumber) =>
      buildConfirmedUnitAtStep(`u-${stepNumber}`, stepNumber)
    );
    expect(units).toHaveLength(THEMATIC_ANCHOR_STEPS.length);

    const result = checkThematicAnchorCoverage(units);

    expect(result).toEqual([
      {
        id: "coverage-complete",
        status: "pass",
        detail: "Every anchor step (2, 5, 6, 7, 8, 9) has Confirmed content.",
      },
    ]);
  });

  it("flags exactly the one anchor step with no unit tagged to it at all, and no others", () => {
    // Every anchor step except 6 (Midpoint) gets a Confirmed unit; step 6
    // has no unit whatsoever at that stepNumber - omitted entirely.
    const stepsWithContent = THEMATIC_ANCHOR_STEPS.filter((stepNumber) => stepNumber !== 6);
    const units = stepsWithContent.map((stepNumber) => buildConfirmedUnitAtStep(`u-${stepNumber}`, stepNumber));
    expect(units.some((u) => u.stepNumber === 6)).toBe(false);

    const result = checkThematicAnchorCoverage(units);

    expect(result).toEqual([
      {
        id: "coverage-step-6",
        status: "flag",
        detail:
          "Step 6 (The Illusory Peak (Midpoint)) has no Confirmed content currently tagged to it - the internal-transformation arc can't be complete without it.",
      },
    ]);
  });

  it("flags a step whose only unit is 'Working', not 'Confirmed' - a Working unit does not count as coverage", () => {
    // Steps 2, 5, 6, 8, 9 are properly Confirmed; step 7 (All Is Lost) has a
    // unit tagged to it, but it's still Working, never promoted to Confirmed.
    const confirmedSteps = THEMATIC_ANCHOR_STEPS.filter((stepNumber) => stepNumber !== 7);
    const units: StructuralUnit[] = [
      ...confirmedSteps.map((stepNumber) => buildConfirmedUnitAtStep(`u-${stepNumber}`, stepNumber)),
      buildWorkingUnitAtStep("u-7-working", 7),
    ];
    expect(units.some((u) => u.stepNumber === 7)).toBe(true);
    expect(units.find((u) => u.stepNumber === 7)?.status).toBe("Working");

    const result = checkThematicAnchorCoverage(units);

    expect(result).toEqual([
      {
        id: "coverage-step-7",
        status: "flag",
        detail:
          "Step 7 (The Escalating Pressure (Bad Guys Close In / All Is Lost)) has no Confirmed content currently tagged to it - the internal-transformation arc can't be complete without it.",
      },
    ]);
  });
});
