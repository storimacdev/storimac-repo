import { describe, it, expect } from "vitest";

import {
  compileScreenplayArchitectureDocumentJson,
  renderScreenplayArchitectureMarkdown,
  type CompileScreenplayArchitectureDocumentParams,
} from "./compileArchitectureDocument";
import { createUnit, setUnitContent, setUnitStatus, type StructuralUnit } from "./stateLedger";
import { CRITICAL_BEAT_LOOKUP } from "./structuralFramework";
import type { IngestedCanon, IngestedProject1Canon } from "./ingestCanon";

/**
 * Coverage for issue #70's Screenplay Architecture Document compiler -
 * both the pure JSON builder (`compileScreenplayArchitectureDocumentJson`)
 * and the markdown renderer (`renderScreenplayArchitectureMarkdown`).
 *
 * Step 1 below is this session's single most important correctness
 * property for this file: the Section 4/5 cross-reference invariant.
 * `compileArchitectureDocument.ts`'s own comment above `earmarkIndex`
 * documents the final whole-branch review's fix (commit 10b9ae16) -
 * matching against `parsedEntries[i].parsed.criticalBeatTags` (plural)
 * instead of `sceneRegister[i].critical_beat_tag` (singular), so a
 * Critical Beat tagged as a scene's SECOND tag is no longer missed.
 * The test proves the invariant "by construction": it reads Section 5's
 * resolved scene_number/unit_id/slugline and Section 4's own entry for
 * that same unit off the SAME result object and compares them directly,
 * rather than hand-recomputing expected values separately - the two
 * sections literally cannot disagree in this test's assertions.
 */

const ALL_CRITICAL_BEAT_TAGS = Object.keys(CRITICAL_BEAT_LOOKUP);

/** A minimal but fully-typed non-null Project 1 canon fixture - every
 * field the compiler actually reads carries a distinctive value; every
 * field it doesn't read is filled with an inert placeholder so the
 * fixture satisfies `IngestedProject1Canon`'s real shape (read directly
 * off ingestCanon.ts) without guessing at nesting. */
function buildP1Canon(overrides: Partial<IngestedProject1Canon> = {}): IngestedProject1Canon {
  return {
    storyDna: {
      core_story_promise: "A promise of transformation.",
      story_identity: "identity",
      narrative_priorities: [],
      always_emphasize: [],
      never_become: [],
      comparable_works: [],
    },
    format: {
      primary_format: { name: "Feature Film", reason: "reason" },
      supporting_formats: [],
    },
    premise: "premise",
    logline: "logline",
    thematicBlueprint: {
      external_theme: "external theme",
      internal_theme: "internal theme",
      core_dramatic_question: "Can she let go?",
      theme_statement: "Letting go is its own kind of strength.",
      narrative_purpose: "purpose",
    },
    dramaticEngine: {
      protagonist: "protagonist",
      antagonistic_force: "force",
      central_conflict: "conflict",
      primary_stakes: "stakes",
      transformation_arc: "arc",
      emotional_journey: "journey",
    },
    storySpine: {
      opening_image: "opening",
      inciting_incident: "inciting",
      first_turning_point: "turn1",
      midpoint: "midpoint",
      second_turning_point: "turn2",
      climax: "climax",
      closing_image: "closing",
    },
    principalCharacters: [],
    version: 1,
    workingTitle: "The Working Title",
    genreTone: {
      genre: "Drama",
      subgenre: "subgenre",
      tone: "Wistful",
      style: "style",
      audience: "audience",
      scale: "scale",
    },
    ...overrides,
  };
}

function buildCanon(p1: IngestedProject1Canon | null): IngestedCanon {
  return {
    storyId: "story-1",
    p1,
    p2: { characters: [] },
    p3: { worldComplexityLevel: null, pillars: [] },
    gaps: [],
    structuralOverview: "overview",
  };
}

function confirmedUnit(unitId: string, content: string): StructuralUnit {
  return setUnitStatus(setUnitContent(createUnit(unitId, "Scene"), content), "Confirmed");
}

function baseParams(
  units: StructuralUnit[],
  canon: IngestedCanon
): CompileScreenplayArchitectureDocumentParams {
  return {
    storyId: "story-1",
    canon,
    units,
    version: 1,
    versionHistory: [],
  };
}

describe("compileScreenplayArchitectureDocumentJson", () => {
  it("Section 5's Critical Beat Earmark Index can never disagree with Section 4's Scene Register, even for a unit carrying two valid tags (issue #70 final review fix, commit 10b9ae16)", () => {
    const units: StructuralUnit[] = [
      confirmedUnit(
        "u1",
        "SCENE 1: INT. HOUSE - DAY\nThe hero wakes up ordinary. Nothing seems unusual yet. Today will change everything."
      ),
      confirmedUnit(
        "u2",
        "SCENE 2: INT. WAREHOUSE - NIGHT\n" +
          "[CRITICAL BEAT: MIDPOINT] The hero confronts her fear. " +
          "[CRITICAL BEAT: FINAL IMAGE] She turns away wearing a new resolve. " +
          "This changes everything for the story."
      ),
      confirmedUnit(
        "u3",
        "SCENE 3: EXT. STREET - DAY\nShe walks away steady. The city hums around her. Nothing feels the same anymore."
      ),
    ];

    const result = compileScreenplayArchitectureDocumentJson(baseParams(units, buildCanon(buildP1Canon())));

    const sceneRegister = result["4_complete_approved_scene_register"];
    const earmarkIndex = result["5_critical_beat_earmark_index"];

    // Section 4's own entry for the multi-tag unit - read off the result,
    // never hand-recomputed.
    const unit2SceneRegisterEntry = sceneRegister.find((s) => s.unit_id === "u2");
    expect(unit2SceneRegisterEntry).toBeDefined();

    const midpointEntry = earmarkIndex.find((e) => e.tag === "MIDPOINT");
    const finalImageEntry = earmarkIndex.find((e) => e.tag === "FINAL IMAGE");
    expect(midpointEntry).toBeDefined();
    expect(finalImageEntry).toBeDefined();

    // Both of u2's tags resolve to the SAME scene_number/unit_id/slugline.
    expect(midpointEntry).toMatchObject({
      scene_number: finalImageEntry!.scene_number,
      unit_id: finalImageEntry!.unit_id,
      slugline: finalImageEntry!.slugline,
    });

    // Those resolved values are byte-identical to u2's own Section 4 entry.
    expect(midpointEntry!.scene_number).toBe(unit2SceneRegisterEntry!.scene_number);
    expect(midpointEntry!.unit_id).toBe(unit2SceneRegisterEntry!.unit_id);
    expect(midpointEntry!.slugline).toBe(unit2SceneRegisterEntry!.slugline);
    expect(finalImageEntry!.scene_number).toBe(unit2SceneRegisterEntry!.scene_number);
    expect(finalImageEntry!.unit_id).toBe(unit2SceneRegisterEntry!.unit_id);
    expect(finalImageEntry!.slugline).toBe(unit2SceneRegisterEntry!.slugline);

    // Sanity: u2 really is scene 2 with the slugline we wrote.
    expect(unit2SceneRegisterEntry!.scene_number).toBe(2);
    expect(unit2SceneRegisterEntry!.unit_id).toBe("u2");
    expect(unit2SceneRegisterEntry!.slugline).toBe("SCENE 2: INT. WAREHOUSE - NIGHT");

    // Every one of the other 8 canonical tags, absent from this fixture,
    // resolves to null across the board.
    const presentTags = new Set(["MIDPOINT", "FINAL IMAGE"]);
    const absentTags = ALL_CRITICAL_BEAT_TAGS.filter((t) => !presentTags.has(t));
    expect(absentTags).toHaveLength(8);
    for (const tag of absentTags) {
      const entry = earmarkIndex.find((e) => e.tag === tag);
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({ scene_number: null, unit_id: null, slugline: null });
    }
  });

  it("degrades every Project 1-sourced field to the disclosed '(not yet Confirmed)' placeholder when canon.p1 is null, without throwing", () => {
    const canon = buildCanon(null);
    const params = baseParams([], canon);

    expect(() => compileScreenplayArchitectureDocumentJson(params)).not.toThrow();
    const result = compileScreenplayArchitectureDocumentJson(params);

    expect(result["1_screenplay_metadata"].working_title).toBe("(not yet Confirmed)");
    expect(result["2_story_dna_blueprint"].genre).toBe("(not yet Confirmed)");
    expect(result["2_story_dna_blueprint"].tone).toBe("(not yet Confirmed)");
    expect(result["2_story_dna_blueprint"].summary_of_core_promise).toBe("(not yet Confirmed)");
    expect(result["2_story_dna_blueprint"].core_dramatic_question).toBe("(not yet Confirmed)");
  });

  it("projected_scene_count counts only Confirmed units, and outstanding lists exactly the non-Confirmed units", () => {
    const units: StructuralUnit[] = [
      confirmedUnit("confirmed-1", "SCENE 1: INT. HOUSE - DAY\nShe waits quietly. The room is still. Nothing moves for a while."),
      confirmedUnit("confirmed-2", "SCENE 2: EXT. YARD - DAY\nHe steps outside slowly. The air is cold. He does not look back."),
      setUnitStatus(createUnit("working-1", "Scene"), "Working"),
      setUnitStatus(createUnit("parked-1", "Scene"), "Parked"),
    ];

    const result = compileScreenplayArchitectureDocumentJson(baseParams(units, buildCanon(buildP1Canon())));

    expect(result["1_screenplay_metadata"].projected_scene_count).toBe(2);

    const outstanding = result["7_outstanding_decisions_version_history"].outstanding;
    expect(outstanding).toHaveLength(2);
    expect(outstanding).toEqual(
      expect.arrayContaining([
        { unit_id: "working-1", status: "Working" },
        { unit_id: "parked-1", status: "Parked" },
      ])
    );
    expect(outstanding.some((u) => u.unit_id === "confirmed-1")).toBe(false);
    expect(outstanding.some((u) => u.unit_id === "confirmed-2")).toBe(false);
  });
});

describe("renderScreenplayArchitectureMarkdown", () => {
  it("includes a Section 4 unit's causal_tag text in the rendered markdown - the baseline the docx/pdf exports must match", () => {
    const units: StructuralUnit[] = [
      setUnitStatus(
        setUnitContent(
          createUnit("u1", "Scene"),
          "SCENE 1: INT. HOUSE - DAY\nShe waits quietly. The room is still. Nothing moves for a while."
        ),
        "Confirmed"
      ),
    ];
    // causalTag defaults to "UNVALIDATED" from createUnit; give this unit
    // a real, distinctive validated tag the way evaluateCausalGate would.
    const taggedUnits: StructuralUnit[] = [{ ...units[0], causalTag: "Therefore" }];

    const doc = compileScreenplayArchitectureDocumentJson(baseParams(taggedUnits, buildCanon(buildP1Canon())));

    expect(doc["4_complete_approved_scene_register"][0].causal_tag).toBe("Therefore");

    const markdown = renderScreenplayArchitectureMarkdown(doc);

    expect(markdown).toContain("Therefore");
  });
});
