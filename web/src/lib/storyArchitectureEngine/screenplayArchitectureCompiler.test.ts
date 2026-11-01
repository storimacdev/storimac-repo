import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * Regression coverage for issue #174: `generateScreenplayArchitectureDocument`
 * must compile the exact `units` snapshot its caller already fetched and
 * ran the Pre-Compilation Audit / Thematic Anchor Audit against
 * (architecture-chat/document/route.ts) - never independently re-fetch
 * `story.p4Units` from Firestore. A re-fetch would reopen a TOCTOU gap: a
 * concurrent edit landing between the audit and the compile could persist
 * a version reflecting content that never actually passed the audit that
 * gated it.
 *
 * This test proves the fix by mocking `getStory` to return a story whose
 * `p4Units` DIFFERS from the `units` parameter passed in, then asserting
 * the compiled document reflects the PARAMETER, not `story.p4Units` - the
 * only way that can happen is if the compiler never reads `story.p4Units`
 * at all.
 */

const { mockGetStory, mockGetLatestVersion, mockListVersions, mockSaveVersion, mockIngestCanon } = vi.hoisted(
  () => ({
    mockGetStory: vi.fn(),
    mockGetLatestVersion: vi.fn(),
    mockListVersions: vi.fn(),
    mockSaveVersion: vi.fn(),
    mockIngestCanon: vi.fn(),
  })
);

vi.mock("@/lib/canonEngine/storyStore", () => ({
  getStory: mockGetStory,
  getLatestScreenplayArchitectureVersion: mockGetLatestVersion,
  listScreenplayArchitectureVersions: mockListVersions,
  saveScreenplayArchitectureVersion: mockSaveVersion,
}));

vi.mock("./ingestCanon", () => ({
  ingestCanon: mockIngestCanon,
}));

import { generateScreenplayArchitectureDocument } from "./screenplayArchitectureCompiler";
import { createUnit, setUnitContent, setUnitStatus, type StructuralUnit } from "./stateLedger";

function confirmedUnit(unitId: string, content: string): StructuralUnit {
  return setUnitStatus(setUnitContent(createUnit(unitId, "Scene"), content), "Confirmed");
}

const STALE_UNIT = confirmedUnit(
  "stale-unit",
  "SCENE 1: INT. ATTIC - NIGHT\nShe finds the box at last. Dust rises in the light. Nothing will be the same."
);
const FRESH_UNIT = confirmedUnit(
  "fresh-unit",
  "SCENE 1: INT. ATTIC - NIGHT\nShe finds something else entirely. The air goes cold at once. Everything changes here."
);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStory.mockResolvedValue({
    storyId: "story-1",
    // Deliberately stale/different from the `units` param below - if the
    // compiler ever reads this instead of its parameter, the assertions
    // on the compiled Scene Register will fail.
    p4Units: [STALE_UNIT],
  });
  mockGetLatestVersion.mockResolvedValue(null);
  mockListVersions.mockResolvedValue([]);
  mockSaveVersion.mockResolvedValue(undefined);
  mockIngestCanon.mockResolvedValue({
    storyId: "story-1",
    p1: null,
    p2: { characters: [] },
    p3: { worldComplexityLevel: null, pillars: [] },
    gaps: [],
    structuralOverview: "overview",
  });
});

describe("generateScreenplayArchitectureDocument", () => {
  it("compiles the `units` parameter it was given, never falling back to story.p4Units (issue #174)", async () => {
    const stored = await generateScreenplayArchitectureDocument("story-1", [FRESH_UNIT]);

    const sceneRegister = stored.json["4_complete_approved_scene_register"];
    expect(sceneRegister).toHaveLength(1);
    expect(sceneRegister[0].unit_id).toBe("fresh-unit");
    expect(sceneRegister.some((s) => s.unit_id === "stale-unit")).toBe(false);

    // The persisted units snapshot (used for the next version's diff) must
    // also reflect the parameter, not story.p4Units.
    expect(Object.keys(stored.unitsSnapshot)).toEqual(["fresh-unit"]);
  });

  it("compiles zero scenes when the caller passes an empty units snapshot, even though story.p4Units is non-empty", async () => {
    const stored = await generateScreenplayArchitectureDocument("story-1", []);

    expect(stored.json["4_complete_approved_scene_register"]).toHaveLength(0);
    expect(stored.unitsSnapshot).toEqual({});
  });

  it("still throws when the story itself doesn't exist, regardless of the units passed in", async () => {
    mockGetStory.mockResolvedValue(null);
    await expect(generateScreenplayArchitectureDocument("missing-story", [FRESH_UNIT])).rejects.toThrow(
      'Story "missing-story" not found.'
    );
  });
});
