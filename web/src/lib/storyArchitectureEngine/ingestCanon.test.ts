import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * Coverage for issue #140: architecture-chat/route.ts fetched `story`
 * once, then called `ingestCanon(storyId)`, which fetched the exact
 * same Story doc a second time internally. The fix adds an optional
 * `knownStory` second parameter - these tests pin down both ends of
 * that behavior: skip the redundant fetch when the caller already has
 * the Story, and keep working unchanged for every existing caller that
 * doesn't pass one.
 */

const { getStoryMock } = vi.hoisted(() => ({ getStoryMock: vi.fn() }));

vi.mock("@/lib/canonEngine/storyStore", () => ({
  getStory: getStoryMock,
  StoryAccessError: class StoryAccessError extends Error {},
  listCharacterBibleEntries: vi.fn().mockResolvedValue([]),
  normalizeP3: vi.fn((p3: unknown) => ({
    worldComplexityLevel: null,
    pillars: null,
    activePillar: null,
    ...((p3 as object) ?? {}),
  })),
}));

vi.mock("@/lib/canonEngine/foundationDoc", () => ({
  listDocumentVersions: vi.fn().mockResolvedValue([]),
  getDocumentVersion: vi.fn(),
}));

vi.mock("@/lib/characterEngine/ingestFoundation", () => ({
  extractIngestedFoundation: vi.fn(),
}));

vi.mock("@/lib/canonEngine/canonStore", () => ({
  listElements: vi.fn().mockResolvedValue([]),
  WORLD_ELEMENTS_COLLECTION: "worldElements",
}));

vi.mock("@/lib/worldEngine/pillarElementId", () => ({
  pillarElementId: (name: string) => `pillar.${name}`,
}));

import { ingestCanon } from "./ingestCanon";
import type { Story } from "@/lib/canonEngine/storyStore";

const fakeStory = { id: "story-1", p1Locked: false, p2: null, p3: null } as unknown as Story;

describe("ingestCanon - knownStory passthrough (issue #140)", () => {
  beforeEach(() => {
    getStoryMock.mockClear();
    getStoryMock.mockResolvedValue(fakeStory);
  });

  it("does not call getStory when a knownStory is provided", async () => {
    const result = await ingestCanon("story-1", fakeStory);
    expect(getStoryMock).not.toHaveBeenCalled();
    expect(result.storyId).toBe("story-1");
  });

  it("falls back to fetching the story when knownStory is omitted", async () => {
    await ingestCanon("story-1");
    expect(getStoryMock).toHaveBeenCalledWith("story-1");
  });

  it("throws when knownStory is omitted and getStory returns null", async () => {
    getStoryMock.mockResolvedValue(null);
    await expect(ingestCanon("story-1")).rejects.toThrow();
  });
});
