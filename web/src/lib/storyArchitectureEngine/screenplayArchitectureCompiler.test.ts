import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * Coverage for `screenplayArchitectureCompiler.ts`'s two orchestration
 * entry points. `generatePartialScreenplayArchitectureDraft` (issue
 * #71) is the focus here: it must filter `units` to the requested
 * Act's `stepNumbers`, increment `draftVersion` independently PER
 * SCOPE, and never touch the full document's own version counter
 * (`generateScreenplayArchitectureDocument`'s own
 * `getLatestScreenplayArchitectureVersion`/`saveScreenplayArchitectureVersion`
 * are mocked below but never called by the draft path - asserted
 * directly).
 */

const {
  mockGetStory,
  mockGetLatestVersion,
  mockListVersions,
  mockSaveVersion,
  mockListDrafts,
  mockGetLatestDraft,
  mockSaveDraft,
  mockIngestCanon,
} = vi.hoisted(() => ({
  mockGetStory: vi.fn(),
  mockGetLatestVersion: vi.fn(),
  mockListVersions: vi.fn(),
  mockSaveVersion: vi.fn(),
  mockListDrafts: vi.fn(),
  mockGetLatestDraft: vi.fn(),
  mockSaveDraft: vi.fn(),
  mockIngestCanon: vi.fn(),
}));

vi.mock("@/lib/canonEngine/storyStore", () => ({
  getStory: mockGetStory,
  getLatestScreenplayArchitectureVersion: mockGetLatestVersion,
  listScreenplayArchitectureVersions: mockListVersions,
  saveScreenplayArchitectureVersion: mockSaveVersion,
  listScreenplayArchitectureDrafts: mockListDrafts,
  getLatestScreenplayArchitectureDraft: mockGetLatestDraft,
  saveScreenplayArchitectureDraft: mockSaveDraft,
}));

vi.mock("./ingestCanon", () => ({
  ingestCanon: mockIngestCanon,
}));

import {
  generateScreenplayArchitectureDocument,
  generatePartialScreenplayArchitectureDraft,
} from "./screenplayArchitectureCompiler";
import { createUnit, setUnitContent, setUnitStatus, setUnitStepNumber, type StructuralUnit } from "./stateLedger";

function confirmedUnit(unitId: string, content: string, stepNumber: number | null): StructuralUnit {
  let unit = setUnitStatus(setUnitContent(createUnit(unitId, "Scene"), content), "Confirmed");
  if (stepNumber !== null) unit = setUnitStepNumber(unit, stepNumber);
  return unit;
}

const EMPTY_CANON = {
  storyId: "story-1",
  p1: null,
  p2: { characters: [] },
  p3: { worldComplexityLevel: null, pillars: [] },
  gaps: [],
  structuralOverview: "overview",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStory.mockResolvedValue({ storyId: "story-1", p4Units: [] });
  mockGetLatestVersion.mockResolvedValue(null);
  mockListVersions.mockResolvedValue([]);
  mockSaveVersion.mockResolvedValue(undefined);
  mockListDrafts.mockResolvedValue([]);
  mockGetLatestDraft.mockResolvedValue(null);
  mockSaveDraft.mockResolvedValue(undefined);
  mockIngestCanon.mockResolvedValue(EMPTY_CANON);
});

describe("generateScreenplayArchitectureDocument (regression, issue #70 unchanged by #71)", () => {
  it("still compiles the full document and never touches the draft persistence functions", async () => {
    mockGetStory.mockResolvedValue({
      storyId: "story-1",
      p4Units: [confirmedUnit("u1", "SCENE 1: INT. HOUSE - DAY\nShe waits. The room is still. Nothing moves here.", 1)],
    });

    const stored = await generateScreenplayArchitectureDocument("story-1");

    expect(stored.version).toBe(1);
    expect(stored.json["4_complete_approved_scene_register"]).toHaveLength(1);
    expect(mockSaveVersion).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    expect(mockGetLatestDraft).not.toHaveBeenCalled();
  });
});

describe("generatePartialScreenplayArchitectureDraft (issue #71)", () => {
  it("includes a Confirmed unit whose stepNumber falls inside the requested Act's stepNumbers", async () => {
    const units: StructuralUnit[] = [confirmedUnit("u1", "SCENE 1: INT. HOUSE - DAY\nShe waits. The room is still. Nothing else here.", 2)];

    const draft = await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units, actId: "1" });

    expect(draft.json["4_complete_approved_scene_register"]).toHaveLength(1);
    expect(draft.json["4_complete_approved_scene_register"][0].unit_id).toBe("u1");
    expect(draft.json["1_screenplay_metadata"].status).toBe("Draft");
    expect(draft.json["1_screenplay_metadata"].scope).toContain("Act 1");
  });

  it("excludes a Confirmed unit whose stepNumber falls in a DIFFERENT Act, even though it's Confirmed", async () => {
    const units: StructuralUnit[] = [
      confirmedUnit("in-scope", "SCENE 1: INT. HOUSE - DAY\nShe waits. The room is still. Nothing else here.", 2),
      confirmedUnit("out-of-scope", "SCENE 2: EXT. STREET - DAY\nHe walks. The street is quiet. Nothing moves there.", 5),
    ];

    const draft = await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units, actId: "1" });

    const unitIds = draft.json["4_complete_approved_scene_register"].map((s) => s.unit_id);
    expect(unitIds).toEqual(["in-scope"]);
  });

  it("excludes a Confirmed unit with a null stepNumber - no signal to attribute it to any Act", async () => {
    const units: StructuralUnit[] = [confirmedUnit("untagged", "SCENE 1: INT. HOUSE - DAY\nShe waits. The room is still. Nothing else here.", null)];

    const draft = await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units, actId: "1" });

    expect(draft.json["4_complete_approved_scene_register"]).toHaveLength(0);
  });

  it("lists a Working-status in-scope unit under Outstanding Decisions, excluded from the Scene Register", async () => {
    const workingUnit = setUnitStepNumber(setUnitStatus(setUnitContent(createUnit("working-1", "Scene"), "draft text"), "Working"), 1);
    const draft = await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units: [workingUnit], actId: "1" });

    expect(draft.json["4_complete_approved_scene_register"]).toHaveLength(0);
    expect(draft.json["7_outstanding_decisions_version_history"].outstanding).toEqual([
      { unit_id: "working-1", status: "Working" },
    ]);
  });

  it("increments draftVersion independently per scope - Act 1 drafted twice, Act 2A drafted once in between", async () => {
    const units: StructuralUnit[] = [confirmedUnit("u1", "SCENE 1: INT. HOUSE - DAY\nShe waits. The room is still. Nothing else here.", 1)];

    // First Act 1 draft - no prior draft for "act-1" yet.
    mockGetLatestDraft.mockResolvedValueOnce(null);
    const firstAct1 = await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units, actId: "1" });
    expect(firstAct1.draftVersion).toBe(1);
    expect(firstAct1.scopeKey).toBe("act-1");

    // Act 2A draft - independent scope, also no prior draft for "act-2A".
    mockGetLatestDraft.mockResolvedValueOnce(null);
    const act2A = await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units, actId: "2A" });
    expect(act2A.draftVersion).toBe(1);
    expect(act2A.scopeKey).toBe("act-2A");

    // Second Act 1 draft - prior draft for "act-1" now exists (the first one above).
    mockGetLatestDraft.mockResolvedValueOnce(firstAct1);
    const secondAct1 = await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units, actId: "1" });
    expect(secondAct1.draftVersion).toBe(2);
    expect(secondAct1.scopeKey).toBe("act-1");
  });

  it("throws synchronously on an unknown actId, before any canon/Firestore call", async () => {
    await expect(
      generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units: [], actId: "9" as never })
    ).rejects.toThrow('Unknown Act id "9".');
    expect(mockIngestCanon).not.toHaveBeenCalled();
    expect(mockGetLatestDraft).not.toHaveBeenCalled();
  });

  it("never calls the full document's version persistence functions", async () => {
    const units: StructuralUnit[] = [confirmedUnit("u1", "SCENE 1: INT. HOUSE - DAY\nShe waits. The room is still. Nothing else here.", 1)];
    await generatePartialScreenplayArchitectureDraft({ storyId: "story-1", units, actId: "1" });

    expect(mockGetLatestVersion).not.toHaveBeenCalled();
    expect(mockSaveVersion).not.toHaveBeenCalled();
    expect(mockListVersions).not.toHaveBeenCalled();
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
  });
});
