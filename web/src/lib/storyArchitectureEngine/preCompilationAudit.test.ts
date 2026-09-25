import { describe, it, expect } from "vitest";

import {
  checkScale,
  checkEarmark,
  checkFormatting,
  runPreCompilationAudit,
  type PreCompilationCheckFinding,
} from "./preCompilationAudit";
import { MIN_TARGET_SCENES, MAX_TARGET_SCENES } from "./sceneDensity";
import { CRITICAL_BEAT_LOOKUP } from "./structuralFramework";
import { createUnit, setUnitStatus, setUnitContent, type StructuralUnit } from "./stateLedger";

/**
 * Coverage for issue #91's Pre-Compilation Audit (Screenplay Structural
 * Architecture Framework v3.0 §6): the Scale, Earmark, and Formatting
 * checks, plus the top-level orchestrator. All three checks operate on
 * Confirmed units only (via `getConfirmedUnits`), so several fixtures
 * below deliberately mix in non-Confirmed units to prove that filter is
 * actually load-bearing rather than assumed.
 *
 * `checkEarmark`'s "multi-tag" test below is the most important one in
 * this file: this session's final whole-branch review found that
 * `checkEarmark` used to reuse the shared, non-global
 * `CRITICAL_BEAT_TAG_PATTERN` directly, which only ever finds a unit's
 * FIRST beat tag - a unit with two valid tags would silently lose the
 * second. The fix was a local global clone of the pattern, scoped per
 * unit (mirroring `parseSceneRegisterEntry`'s own identical fix in
 * `developmentLoop.ts`). The fixture is built so that if that bug ever
 * came back, this test would flip from "pass" to "flag" - not just fail
 * to find "some" tags.
 */

const ALL_CRITICAL_BEAT_TAGS = Object.keys(CRITICAL_BEAT_LOOKUP);

/** A bare Confirmed unit with no content - sufficient for `checkScale`,
 * which only counts Confirmed units and never inspects their content. */
function confirmedUnits(count: number, idPrefix = "scale"): StructuralUnit[] {
  const units: StructuralUnit[] = [];
  for (let i = 0; i < count; i++) {
    units.push(setUnitStatus(createUnit(`${idPrefix}-${i}`, "Scene"), "Confirmed"));
  }
  return units;
}

/** A Confirmed unit carrying specific content, built via stateLedger's
 * own createUnit/setUnitStatus/setUnitContent - never a hand-rolled
 * StructuralUnit literal. */
function confirmedUnit(id: string, content: string): StructuralUnit {
  return setUnitContent(setUnitStatus(createUnit(id, "Scene"), "Confirmed"), content);
}

/** A well-formed scene body per checkSceneRegisterFormat: a valid
 * slugline, an optional single Critical Beat tag, and a 3-sentence
 * explanatory paragraph. */
function wellFormedContent(index: number, tag?: string): string {
  const tagPrefix = tag ? `[CRITICAL BEAT: ${tag}] ` : "";
  return (
    `SCENE ${index}: INT. LOCATION ${index} - DAY\n` +
    `${tagPrefix}The character moves through the scene with clear purpose. ` +
    "Something shifts subtly in the air around them. A quiet decision begins to form."
  );
}

describe("checkScale", () => {
  it("flags a fixture below MIN_TARGET_SCENES, ignoring non-Confirmed units", () => {
    const units = [
      ...confirmedUnits(50),
      // 40 non-Confirmed units: if getConfirmedUnits' filter were ever
      // dropped, 50 + 40 = 90 would push this fixture inside the target
      // range and this test would wrongly expect "pass".
      ...Array.from({ length: 40 }, (_, i) => createUnit(`exploring-${i}`, "Scene")),
    ];

    const result = checkScale(units);

    expect(result).toEqual({
      id: "scale",
      status: "flag",
      detail: `50 Confirmed unit(s) - outside the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
    });
  });

  it("passes at the MIN_TARGET_SCENES boundary (inclusive)", () => {
    const units = confirmedUnits(MIN_TARGET_SCENES);

    const result: PreCompilationCheckFinding = checkScale(units);

    expect(result).toEqual({
      id: "scale",
      status: "pass",
      detail: `${MIN_TARGET_SCENES} Confirmed unit(s) - within the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
    });
  });

  it("passes at the MAX_TARGET_SCENES boundary (inclusive)", () => {
    const units = confirmedUnits(MAX_TARGET_SCENES);

    const result = checkScale(units);

    expect(result).toEqual({
      id: "scale",
      status: "pass",
      detail: `${MAX_TARGET_SCENES} Confirmed unit(s) - within the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
    });
  });

  it("flags a fixture above MAX_TARGET_SCENES", () => {
    const count = MAX_TARGET_SCENES + 1;
    const units = confirmedUnits(count);

    const result = checkScale(units);

    expect(result).toEqual({
      id: "scale",
      status: "flag",
      detail: `${count} Confirmed unit(s) - outside the ${MIN_TARGET_SCENES}-${MAX_TARGET_SCENES} scene target range.`,
    });
  });
});

describe("checkEarmark", () => {
  it("finds BOTH tags from a single unit carrying two different Critical Beat tags (final review multi-tag fix)", () => {
    // tagA/tagB come from ONE Confirmed unit's content. The other 8
    // canonical tags are each covered by their own separate unit, and
    // NEITHER tagA nor tagB is covered anywhere else. If the old
    // non-global-pattern bug were present, only the first of tagA/tagB
    // would ever be found, leaving the other one permanently missing -
    // this fixture would then report status "flag" with exactly one
    // missing tag, not "pass".
    const [tagA, tagB, ...restTags] = ALL_CRITICAL_BEAT_TAGS;
    expect(restTags).toHaveLength(ALL_CRITICAL_BEAT_TAGS.length - 2);

    const multiTagUnit = confirmedUnit(
      "multi-tag-unit",
      `[CRITICAL BEAT: ${tagA}] The hero reaches a turning point in the plan. ` +
        `[CRITICAL BEAT: ${tagB}] She resolves to change course entirely.`
    );
    const restUnits = restTags.map((tag, i) =>
      confirmedUnit(`single-tag-${i}`, `[CRITICAL BEAT: ${tag}] Something relevant happens in this scene.`)
    );

    const result = checkEarmark([multiTagUnit, ...restUnits]);

    expect(result).toEqual({
      id: "earmark",
      status: "pass",
      detail: `All ${ALL_CRITICAL_BEAT_TAGS.length} Critical Beats are tagged in the Confirmed Scene Register.`,
    });
  });

  it("flags and names exactly the missing tags when only some are covered", () => {
    const covered = ALL_CRITICAL_BEAT_TAGS.slice(0, 3);
    const missing = ALL_CRITICAL_BEAT_TAGS.slice(3);
    expect(missing.length).toBeGreaterThan(0);

    const units = covered.map((tag, i) =>
      confirmedUnit(`covered-${i}`, `[CRITICAL BEAT: ${tag}] Something relevant happens in this scene.`)
    );

    const result = checkEarmark(units);

    expect(result).toEqual({
      id: "earmark",
      status: "flag",
      detail: `${missing.length} of ${ALL_CRITICAL_BEAT_TAGS.length} Critical Beats not yet tagged in any Confirmed scene: ${missing.join(", ")}.`,
    });
  });

  it("passes when all 10 canonical tags are covered", () => {
    const units = ALL_CRITICAL_BEAT_TAGS.map((tag, i) =>
      confirmedUnit(`covered-${i}`, `[CRITICAL BEAT: ${tag}] Something relevant happens in this scene.`)
    );

    const result = checkEarmark(units);

    expect(result).toEqual({
      id: "earmark",
      status: "pass",
      detail: `All ${ALL_CRITICAL_BEAT_TAGS.length} Critical Beats are tagged in the Confirmed Scene Register.`,
    });
  });
});

describe("checkFormatting", () => {
  it("passes when every Confirmed unit is well-formed", () => {
    const units = [confirmedUnit("well-formed-1", wellFormedContent(1)), confirmedUnit("well-formed-2", wellFormedContent(2))];

    const result = checkFormatting(units);

    expect(result).toEqual({
      id: "formatting",
      status: "pass",
      detail: "Every Confirmed scene has a standard slugline and exactly one explanatory paragraph.",
    });
  });

  it("flags and identifies the malformed Confirmed unit by id and reason", () => {
    const goodUnit = confirmedUnit("good-1", wellFormedContent(1));
    const badUnit = confirmedUnit("bad-1", "FADE IN:\nThis scene has no slugline at all, unfortunately for the check.");

    const result = checkFormatting([goodUnit, badUnit]);

    const expectedReason =
      'Missing or malformed slugline - every scene must open with "SCENE [X]: [INT./EXT. LOCATION - TIME OF DAY]".';
    expect(result).toEqual({
      id: "formatting",
      status: "flag",
      detail: `1 Confirmed scene(s) fail formatting: bad-1 (${expectedReason}).`,
    });
  });
});

describe("runPreCompilationAudit", () => {
  it("fails all three checks together on a small, tag-less, malformed fixture", () => {
    const badUnit = confirmedUnit("bad-1", "FADE IN:\nNo slugline, no Critical Beat tags, nothing recognized here.");

    const result = runPreCompilationAudit([badUnit]);

    expect(result.failed).toBe(true);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.map((f) => f.id)).toEqual(["scale", "earmark", "formatting"]);
    expect(result.findings.map((f) => f.status)).toEqual(["flag", "flag", "flag"]);
  });

  it("passes all three checks together on a fully compliant fixture", () => {
    const units: StructuralUnit[] = [];
    for (let i = 0; i < MIN_TARGET_SCENES; i++) {
      const tag = ALL_CRITICAL_BEAT_TAGS[i]; // one of the 10 tags for i < 10, undefined (no tag) after
      units.push(confirmedUnit(`pass-${i}`, wellFormedContent(i, tag)));
    }
    expect(units).toHaveLength(MIN_TARGET_SCENES);

    const result = runPreCompilationAudit(units);

    expect(result.failed).toBe(false);
    expect(result.findings).toHaveLength(3);
    expect(result.findings.map((f) => f.status)).toEqual(["pass", "pass", "pass"]);
  });
});
