import { describe, it, expect } from "vitest";
import { buildSynthesisEntryDescriptions, buildDependencyEdgeDescriptions } from "./worldBibleCompiler";
import type { CanonElement } from "@/lib/canonEngine/types";
import type { WorldEntryValue } from "./worldEntry";

/**
 * Unit tests for the pure grounding-block builders behind
 * runWorldBibleSynthesis (issue #128) - the one consolidated Anthropic
 * call itself is out of scope for this suite (see
 * thematicAnchorAudit.test.ts's own note on the same convention), since
 * it requires a real/mocked Anthropic API call via extractTurn.
 */

function makeEntry(overrides: Partial<CanonElement> & { value: Partial<WorldEntryValue> }): CanonElement {
  const value: WorldEntryValue = {
    name: "Entry",
    category: "Geography",
    narrativeRole: "",
    importance: "Major",
    depth: 3,
    functionalDescription: "",
    governingRules: "",
    outstandingQuestions: [],
    ...overrides.value,
  };
  return {
    project_id: "story-1",
    element_id: overrides.element_id ?? "entry_1",
    stage: 1,
    status: "Confirmed",
    depth_mode: "Confirm",
    rationale: "",
    depends_on: overrides.depends_on ?? [],
    retrieval_code: null,
    history: [],
    ...overrides,
    value,
  };
}

describe("buildSynthesisEntryDescriptions", () => {
  it("returns a placeholder when there are no Confirmed entries", () => {
    expect(buildSynthesisEntryDescriptions([])).toBe("(None yet.)");
  });

  it("includes name, category, functionalDescription, and governingRules for each entry", () => {
    const entry = makeEntry({
      element_id: "castle_1",
      value: { name: "Castle Ardent", category: "Geography", functionalDescription: "A fortress.", governingRules: "No magic within its walls." },
    });
    const out = buildSynthesisEntryDescriptions([entry]);
    expect(out).toContain("Castle Ardent");
    expect(out).toContain("Geography");
    expect(out).toContain("A fortress.");
    expect(out).toContain("No magic within its walls.");
  });

  it("truncates a long functionalDescription/governingRules to the fixed per-field character budget", () => {
    const longText = "x".repeat(5000);
    const entry = makeEntry({ value: { functionalDescription: longText, governingRules: longText } });
    const out = buildSynthesisEntryDescriptions([entry]);
    // Each field is capped well below its original 5000-char length, and
    // the truncation marker shows up exactly once per truncated field.
    expect(out.length).toBeLessThan(1000);
    expect(out).toContain("…");
  });

  it("caps the total number of entries included and appends a synthesized '...and N more' note", () => {
    const entries = Array.from({ length: 310 }, (_, i) =>
      makeEntry({ element_id: `entry_${i}`, value: { name: `Entry ${i}` } })
    );
    const out = buildSynthesisEntryDescriptions(entries);
    const lines = out.split("\n");
    // 300 entry lines + 1 synthesized "more" note.
    expect(lines.length).toBe(301);
    expect(out).toContain("...and 10 more Confirmed entries not shown.");
    expect(out).not.toContain("Entry 300");
  });

  it("does not add a 'more' note when the entry count is at or under the cap", () => {
    const entries = Array.from({ length: 300 }, (_, i) =>
      makeEntry({ element_id: `entry_${i}`, value: { name: `Entry ${i}` } })
    );
    const out = buildSynthesisEntryDescriptions(entries);
    expect(out).not.toContain("more Confirmed entries not shown");
    expect(out.split("\n").length).toBe(300);
  });
});

describe("buildDependencyEdgeDescriptions", () => {
  it("returns a placeholder when there are no recorded dependencies", () => {
    const entries = [makeEntry({ element_id: "a", value: { name: "A" } })];
    expect(buildDependencyEdgeDescriptions(entries)).toBe("No recorded dependencies between Confirmed entries.");
  });

  it("renders one sentence per recorded depends_on edge", () => {
    const a = makeEntry({ element_id: "a", value: { name: "Economy" } });
    const b = makeEntry({ element_id: "b", value: { name: "Politics" }, depends_on: ["a"] });
    const out = buildDependencyEdgeDescriptions([a, b]);
    expect(out).toBe('"Politics" depends on "Economy".');
  });

  it("caps the total number of edges and appends a synthesized '...and N more' note", () => {
    // One hub entry with 510 outgoing dependency edges to distinct targets.
    const targets = Array.from({ length: 510 }, (_, i) => makeEntry({ element_id: `t_${i}`, value: { name: `T${i}` } }));
    const hub = makeEntry({
      element_id: "hub",
      value: { name: "Hub" },
      depends_on: targets.map((t) => t.element_id),
    });
    const out = buildDependencyEdgeDescriptions([...targets, hub]);
    const lines = out.split("\n");
    expect(lines.length).toBe(501);
    expect(out).toContain("...and 10 more recorded dependencies not shown.");
  });
});
