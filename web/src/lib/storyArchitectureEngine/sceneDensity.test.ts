import { describe, it, expect } from "vitest";
import {
  computeSceneDensity,
  applySceneDensityDismissal,
  nextSceneDensityDismissal,
  DEFAULT_SCENE_DENSITY_DISMISSAL,
  MIN_TARGET_SCENES,
  MAX_TARGET_SCENES,
  type SceneDensityReading,
} from "./sceneDensity";
import { createUnit, setUnitStatus, setUnitStepNumber, type StructuralUnit } from "./stateLedger";

// MIN_COUNT_FOR_PROJECTION (20) and MIN_STEPS_FOR_PROJECTION (2) are internal
// to sceneDensity.ts (declared `const`, not exported) - mirrored here as
// plain numbers since several fixtures below need to deliberately straddle
// both floors. Keep these in sync with the source if it ever changes.
const MIN_COUNT_FOR_PROJECTION = 20;
const MIN_STEPS_FOR_PROJECTION = 2;

type CountedStatus = "Working" | "Confirmed";

/** Builds `distribution.length` distinct steps (1-indexed), each holding
 * `distribution[i]` counted (Working/Confirmed) units tagged with that step
 * number via stateLedger's own createUnit/setUnitStepNumber/setUnitStatus -
 * never a hand-rolled StructuralUnit. */
function buildCountedUnits(distribution: number[], status: CountedStatus = "Working"): StructuralUnit[] {
  const units: StructuralUnit[] = [];
  distribution.forEach((countAtStep, idx) => {
    const step = idx + 1;
    for (let i = 0; i < countAtStep; i++) {
      units.push(setUnitStatus(setUnitStepNumber(createUnit(`s${step}-u${i}`, "Scene"), step), status));
    }
  });
  return units;
}

/** A "legacy" unit predating issue #56: counted (Working/Confirmed) but
 * deliberately never tagged with a stepNumber, so it stays at createUnit's
 * initialized `null` rather than being hand-set to some other value. */
function buildLegacyUnit(id: string, status: CountedStatus = "Working"): StructuralUnit {
  return setUnitStatus(createUnit(id, "Scene"), status);
}

/** A unit shaped like a REAL pre-issue-#56 Firestore document: the
 * `stepNumber` key is entirely ABSENT (`undefined` at runtime), not set to
 * `null` - see storyStore.ts's own note on this exact distinction, and why
 * computeSceneDensity's guard is `typeof n === "number"`, not `n !== null`.
 * `buildLegacyUnit` above covers the `null` shape; this covers the shape
 * that actually occurs in production. */
function buildUndefinedStepNumberUnit(id: string, status: CountedStatus = "Working"): StructuralUnit {
  const unit = setUnitStatus(createUnit(id, "Scene"), status) as Partial<StructuralUnit> & Omit<StructuralUnit, "stepNumber">;
  delete unit.stepNumber;
  return unit as StructuralUnit;
}

describe("computeSceneDensity", () => {
  it("does not count a legacy unit's null OR undefined stepNumber as a phantom step (final review fix)", () => {
    // 18 units spread across 2 real steps, plus one legacy unit with
    // stepNumber explicitly null (createUnit's own initialized value) and
    // one shaped like a REAL pre-#56 Firestore document, where the
    // stepNumber key is entirely absent (undefined at runtime, not null).
    // If either were ever miscounted as a distinct 3rd/4th step,
    // projectedTotal would come out wrong instead of the correct 100.
    const units = [
      ...buildCountedUnits([10, 8]),
      buildLegacyUnit("legacy-null"),
      buildUndefinedStepNumberUnit("legacy-undefined"),
    ];
    expect(units).toHaveLength(20);
    expect(units.find((u) => u.unitId === "legacy-undefined")?.stepNumber).toBeUndefined();

    const result = computeSceneDensity(units);

    expect(result).toEqual({ count: 20, projectedTotal: 100, rawAlert: null });
  });

  it("suppresses any projection below MIN_COUNT_FOR_PROJECTION even with enough distinct steps", () => {
    const units = buildCountedUnits([3, 2]); // count 5, 2 distinct steps
    expect(units).toHaveLength(5);
    expect(units.length).toBeLessThan(MIN_COUNT_FOR_PROJECTION);

    const result = computeSceneDensity(units);

    expect(result).toEqual({ count: 5, projectedTotal: null, rawAlert: null });
  });

  it("allows a real alert once MIN_COUNT_FOR_PROJECTION is met", () => {
    const units = buildCountedUnits([4, 4, 4, 4, 4]); // count 20, 5 distinct steps -> 40
    expect(units).toHaveLength(MIN_COUNT_FOR_PROJECTION);
    expect(new Set(units.map((u) => u.stepNumber)).size).toBeGreaterThanOrEqual(MIN_STEPS_FOR_PROJECTION);

    const result = computeSceneDensity(units);

    expect(result).toEqual({ count: 20, projectedTotal: 40, rawAlert: "under" });
  });

  it("flags 'under' when the projected total falls clearly below MIN_TARGET_SCENES", () => {
    const units = buildCountedUnits([7, 7, 6]); // count 20, 3 distinct steps -> 67
    const density = computeSceneDensity(units);
    const result = applySceneDensityDismissal(density, DEFAULT_SCENE_DENSITY_DISMISSAL);

    expect(result.count).toBe(units.length);
    expect(result.projectedTotal).toBe(67);
    expect(result.projectedTotal).toBeLessThan(MIN_TARGET_SCENES);
    expect(result.alert).toBe("under");
  });

  it("flags 'over' when the projected total falls clearly above MAX_TARGET_SCENES", () => {
    const units = buildCountedUnits([16, 15]); // count 31, 2 distinct steps -> 155
    const density = computeSceneDensity(units);
    const result = applySceneDensityDismissal(density, DEFAULT_SCENE_DENSITY_DISMISSAL);

    expect(result.count).toBe(units.length);
    expect(result.projectedTotal).toBe(155);
    expect(result.projectedTotal).toBeGreaterThan(MAX_TARGET_SCENES);
    expect(result.alert).toBe("over");
  });

  it("raises no alert when the projected total lands inside the target range", () => {
    const units = buildCountedUnits([10, 10]); // count 20, 2 distinct steps -> 100
    const density = computeSceneDensity(units);
    const result = applySceneDensityDismissal(density, DEFAULT_SCENE_DENSITY_DISMISSAL);

    expect(result.count).toBe(units.length);
    expect(result.projectedTotal).toBe(100);
    expect(result.alert).toBeNull();
  });
});

describe("scene density dismissal round-trip", () => {
  it("has the expected shape by default", () => {
    expect(DEFAULT_SCENE_DENSITY_DISMISSAL).toEqual({ under: false, over: false });
  });

  it("keeps a direction dismissed only while its own condition remains true", () => {
    const underReading: SceneDensityReading = { count: 25, projectedTotal: 50, rawAlert: "under" };
    const dismissedUnder = { under: true, over: false };

    // Same direction ("under") as the current rawAlert -> the dismissal persists.
    expect(nextSceneDensityDismissal(underReading, dismissedUnder)).toEqual({ under: true, over: false });

    // The direction has cleared (now "over", not "under") -> the stale
    // "under" dismissal resets to false rather than staying permanently
    // suppressed by the earlier click.
    const overReading: SceneDensityReading = { count: 40, projectedTotal: 160, rawAlert: "over" };
    expect(nextSceneDensityDismissal(overReading, dismissedUnder)).toEqual({ under: false, over: false });
  });

  it("suppresses only the dismissed direction, not the other one", () => {
    const dismissal = { under: true, over: false };

    const underReading: SceneDensityReading = { count: 25, projectedTotal: 50, rawAlert: "under" };
    const suppressed = applySceneDensityDismissal(underReading, dismissal);
    expect(suppressed.alert).toBeNull();
    expect(suppressed.count).toBe(25);
    expect(suppressed.projectedTotal).toBe(50);

    const overReading: SceneDensityReading = { count: 40, projectedTotal: 160, rawAlert: "over" };
    const notSuppressed = applySceneDensityDismissal(overReading, dismissal);
    expect(notSuppressed.alert).toBe("over");
  });
});
