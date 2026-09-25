import { describe, it, expect } from "vitest";

import { checkSceneRegisterFormat, parseSceneRegisterEntry } from "./developmentLoop";

/**
 * Coverage for issue #66 (Scene Register format checking) and issue #70
 * (multi-tag scene parsing for the compiler). Step 2's "second valid tag
 * is NOT rejected" test is the reachability precondition that issue
 * #70's final whole-branch review discovered by execution: a unit
 * carrying two valid [CRITICAL BEAT: ...] tags is genuinely reachable
 * because checkSceneRegisterFormat only validates the FIRST tag it
 * finds, never checking whether a second one exists. That fact must
 * stay pinned down as documented/intentional behavior - if it ever
 * regresses (either silently rejecting multi-tag content, or silently
 * accepting it with nobody aware), this suite should fail loudly.
 */

describe("checkSceneRegisterFormat", () => {
  it("rejects a missing/malformed slugline", () => {
    const content = "FADE IN:\nSomething happens in the story right now, for certain.";
    const result = checkSceneRegisterFormat(content);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Missing or malformed slugline");
  });

  it("rejects an unrecognized Critical Beat tag name", () => {
    const content =
      "SCENE 3: INT. KITCHEN - DAY\n[CRITICAL BEAT: RANDOM TAG] She stares at the empty room in silence.";
    const result = checkSceneRegisterFormat(content);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('"RANDOM TAG" is not one of the 10 recognized Critical Beat tags.');
  });

  it("rejects a paragraph with fewer than 3 sentences", () => {
    const content = "SCENE 4: INT. HALLWAY - NIGHT\nThis is sentence one. This is sentence two.";
    const result = checkSceneRegisterFormat(content);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("has 2 sentence(s)");
    expect(result.reason).toContain("it must be exactly 3-4 dense sentences");
  });

  it("rejects a paragraph with more than 4 sentences", () => {
    const content = "SCENE 5: INT. ATTIC - DAY\nOne. Two. Three. Four. Five.";
    const result = checkSceneRegisterFormat(content);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("has 5 sentence(s)");
    expect(result.reason).toContain("it must be exactly 3-4 dense sentences");
  });

  it("accepts a fully valid scene body", () => {
    const content =
      "SCENE 2: EXT. STREET - NIGHT\n" +
      "Rain falls steadily on the empty street. A lone figure walks against the wind. " +
      "Sirens echo somewhere in the distance. The city holds its breath.";
    const result = checkSceneRegisterFormat(content);
    expect(result).toEqual({ ok: true });
  });

  it("does NOT reject a second valid Critical Beat tag (issue #70 reachability precondition)", () => {
    const content =
      "SCENE 5: INT. WAREHOUSE - NIGHT\n" +
      "[CRITICAL BEAT: MIDPOINT] The hero confronts her fear. " +
      "[CRITICAL BEAT: FINAL IMAGE] She turns away wearing a new resolve. " +
      "This changes everything for the story.";
    const result = checkSceneRegisterFormat(content);
    // Only the FIRST tag (MIDPOINT) is ever validated - a second tag
    // (FINAL IMAGE) is never inspected, so this scene passes even though
    // it carries two beat tags. This is intentional, known behavior.
    expect(result).toEqual({ ok: true });
  });
});

describe("parseSceneRegisterEntry", () => {
  it("collects both tags from a multi-tag scene, in first-encountered order", () => {
    const content =
      "SCENE 5: INT. WAREHOUSE - NIGHT\n" +
      "[CRITICAL BEAT: MIDPOINT] The hero confronts her fear. " +
      "[CRITICAL BEAT: FINAL IMAGE] She turns away wearing a new resolve. " +
      "This changes everything for the story.";
    const result = parseSceneRegisterEntry(content);

    expect(result.slugline).toBe("SCENE 5: INT. WAREHOUSE - NIGHT");
    expect(result.criticalBeatTags).toEqual(["MIDPOINT", "FINAL IMAGE"]);
    expect(result.criticalBeatTag).toBe("MIDPOINT");
    expect(result.paragraph).not.toContain("[CRITICAL BEAT: MIDPOINT]");
    expect(result.paragraph).not.toContain("[CRITICAL BEAT: FINAL IMAGE]");
  });

  it("degrades honestly when there is no slugline at all", () => {
    const content = "This is just plain prose with no slugline. It has two sentences.";
    expect(() => parseSceneRegisterEntry(content)).not.toThrow();
    const result = parseSceneRegisterEntry(content);
    expect(result.slugline).toBe("(malformed - no slugline found)");
    expect(result.criticalBeatTags).toEqual([]);
    expect(result.criticalBeatTag).toBeNull();
  });

  it("degrades honestly on an unrecognized tag name (valid slugline preserved, tag dropped)", () => {
    const content = "SCENE 1: INT. HOUSE - DAY\n[CRITICAL BEAT: NOT A REAL TAG] Something happens here today.";
    expect(() => parseSceneRegisterEntry(content)).not.toThrow();
    const result = parseSceneRegisterEntry(content);
    expect(result.slugline).toBe("SCENE 1: INT. HOUSE - DAY");
    expect(result.criticalBeatTags).toEqual([]);
    expect(result.criticalBeatTag).toBeNull();
  });

  it("degrades honestly on an empty string", () => {
    expect(() => parseSceneRegisterEntry("")).not.toThrow();
    const result = parseSceneRegisterEntry("");
    expect(result.slugline).toBe("(malformed - no slugline found)");
    expect(result.criticalBeatTags).toEqual([]);
    expect(result.criticalBeatTag).toBeNull();
    expect(result.paragraph).toBe("");
  });

  it("degrades honestly on a whitespace-only string", () => {
    const content = "   \n\t  ";
    expect(() => parseSceneRegisterEntry(content)).not.toThrow();
    const result = parseSceneRegisterEntry(content);
    expect(result.slugline).toBe("(malformed - no slugline found)");
    expect(result.criticalBeatTags).toEqual([]);
    expect(result.criticalBeatTag).toBeNull();
    expect(result.paragraph).toBe("");
  });
});
