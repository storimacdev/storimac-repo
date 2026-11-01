import { describe, it, expect } from "vitest";

import { checkDependencyCompleteness, checkRedundancy, formatStage4AuditSummary } from "./stage4Audit";
import type { CanonElement } from "@/lib/canonEngine/types";
import type { P3Stage4Audit, Stage4AuditFinding } from "@/lib/canonEngine/storyStore";

/**
 * Coverage for issue #49's Stage 4 System Integration Audit rules-based
 * checks and summary renderer, plus the three follow-up issues filed
 * against that final whole-branch review (#123 redundancy cap, #125
 * dependency name-resolution/hallucination-guard, #126 malformed-shape
 * defensive guard).
 */

/** A minimal Confirmed-shaped CanonElement - only the fields these
 * checks actually read are filled in meaningfully. */
function entry(
  id: string,
  opts: {
    name?: string;
    category?: string;
    functionalDescription?: string;
    dependsOn?: string[];
    status?: CanonElement["status"];
  } = {}
): CanonElement {
  return {
    project_id: "story-1",
    element_id: id,
    stage: 4,
    status: opts.status ?? "Confirmed",
    depth_mode: "Confirm",
    value: {
      name: opts.name ?? id,
      category: opts.category ?? "Location",
      narrativeRole: "",
      importance: "Major",
      depth: 3,
      functionalDescription: opts.functionalDescription ?? "",
      governingRules: "",
      outstandingQuestions: [],
    },
    rationale: "",
    depends_on: opts.dependsOn ?? [],
    retrieval_code: null,
    history: [],
  };
}

describe("checkDependencyCompleteness", () => {
  it("passes when every Confirmed entry's dependencies are themselves Confirmed", () => {
    const a = entry("a");
    const b = entry("b", { dependsOn: ["a"] });

    const result = checkDependencyCompleteness([a, b], [a, b]);

    expect(result).toEqual([
      {
        id: "dependency-complete",
        category: "dependency",
        status: "pass",
        detail: "Every Confirmed entry's dependencies are themselves Confirmed - no unresolved Dependency Review items.",
      },
    ]);
  });

  it("resolves the dependency's display name, not its raw id, for a real-but-unconfirmed dependency (issue #125)", () => {
    const shrine = entry("the-ember-shrine", { name: "The Ember Shrine", status: "Working" });
    const dependent = entry("hero", { name: "Hero", dependsOn: ["the-ember-shrine"] });
    const confirmedEntries = [dependent];
    const allEntries = [dependent, shrine];

    const result = checkDependencyCompleteness(confirmedEntries, allEntries);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("flag");
    expect(result[0].detail).toContain("The Ember Shrine");
    expect(result[0].detail).not.toContain("the-ember-shrine");
  });

  it("distinguishes a hallucinated/stale depends_on id (no matching entry at all) from a real-but-unconfirmed one (issue #125)", () => {
    const real = entry("real-place", { name: "Real Place", status: "Working" });
    const dependent = entry("hero", {
      name: "Hero",
      dependsOn: ["real-place", "nonexistent-id"],
    });
    const confirmedEntries = [dependent];
    const allEntries = [dependent, real];

    const result = checkDependencyCompleteness(confirmedEntries, allEntries);

    expect(result).toHaveLength(2);
    const unconfirmedFinding = result.find((f) => f.id === "dependency-hero");
    const unknownFinding = result.find((f) => f.id === "dependency-unknown-hero");

    expect(unconfirmedFinding?.detail).toContain("Real Place");
    expect(unconfirmedFinding?.detail).not.toContain("nonexistent-id");

    expect(unknownFinding?.detail).toContain("nonexistent-id");
    expect(unknownFinding?.detail).toMatch(/hallucinated|stale/);
    expect(unknownFinding?.status).toBe("flag");
  });

  it("falls back to the raw id when a real-but-unconfirmed dependency has no name set on its value", () => {
    const noName = { ...entry("no-name-entry", { status: "Working" }), value: {} };
    const dependent = entry("hero", { name: "Hero", dependsOn: ["no-name-entry"] });

    const result = checkDependencyCompleteness([dependent], [dependent, noName]);

    expect(result).toHaveLength(1);
    expect(result[0].detail).toContain("no-name-entry");
  });
});

describe("checkRedundancy", () => {
  const OVERLAPPING_TEXT_A =
    "ancient crumbling stone temple hidden beneath overgrown jungle vines guarding forgotten treasure";
  const OVERLAPPING_TEXT_B =
    "ancient crumbling stone temple hidden beneath overgrown jungle vines guarding forgotten relics";

  it("passes when no same-category pair shares enough overlap", () => {
    const a = entry("a", { functionalDescription: "a quiet seaside village with fishing boats" });
    const b = entry("b", { functionalDescription: "a volcanic mountain range with lava flows" });

    const result = checkRedundancy([a, b]);

    expect(result).toEqual([
      {
        id: "redundancy-none",
        category: "redundancy",
        status: "pass",
        detail: "No significant overlap found between same-category Confirmed entries.",
      },
    ]);
  });

  it("flags a same-category pair whose descriptions share enough concepts", () => {
    const a = entry("a", { name: "Temple A", category: "Location", functionalDescription: OVERLAPPING_TEXT_A });
    const b = entry("b", { name: "Temple B", category: "Location", functionalDescription: OVERLAPPING_TEXT_B });

    const result = checkRedundancy([a, b]);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("flag");
    expect(result[0].detail).toContain("Temple A");
    expect(result[0].detail).toContain("Temple B");
  });

  it("never flags a pair across different categories, however similar their descriptions", () => {
    const a = entry("a", { category: "Location", functionalDescription: OVERLAPPING_TEXT_A });
    const b = entry("b", { category: "Character", functionalDescription: OVERLAPPING_TEXT_B });

    const result = checkRedundancy([a, b]);

    expect(result).toEqual([
      {
        id: "redundancy-none",
        category: "redundancy",
        status: "pass",
        detail: "No significant overlap found between same-category Confirmed entries.",
      },
    ]);
  });

  it("caps output at 20 findings plus a synthetic '...and N more' summary when a dense same-category set produces more (issue #123)", () => {
    // 25 same-category entries sharing the exact same description text:
    // every pair overlaps maximally, producing C(25,2) = 300 raw
    // findings - comfortably over the 20-finding cap.
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry(`loc-${i}`, { name: `Location ${i}`, category: "Location", functionalDescription: OVERLAPPING_TEXT_A })
    );

    const result = checkRedundancy(entries);

    // 20 real findings + 1 synthetic "...and X more" summary.
    expect(result).toHaveLength(21);
    expect(result.slice(0, 20).every((f) => f.status === "flag" && f.id.startsWith("redundancy-loc-"))).toBe(true);

    const summary = result[20];
    expect(summary.id).toBe("redundancy-more");
    expect(summary.status).toBe("flag");
    // 300 total pairs - 20 kept = 280 omitted.
    expect(summary.detail).toContain("280 more");
  });

  it("does not append a summary finding when the raw finding count is within the cap", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      entry(`loc-${i}`, { category: "Location", functionalDescription: OVERLAPPING_TEXT_A })
    );
    // C(5,2) = 10 pairs, under the 20-finding cap.
    const result = checkRedundancy(entries);

    expect(result).toHaveLength(10);
    expect(result.some((f) => f.id === "redundancy-more")).toBe(false);
  });
});

describe("formatStage4AuditSummary", () => {
  function audit(findings: Stage4AuditFinding[]): P3Stage4Audit {
    return { findings, generatedAt: "2026-01-01T00:00:00.000Z", authorApproved: false };
  }

  it("renders every finding (pass, flag, skipped) in 'full' mode (the default)", () => {
    const result = formatStage4AuditSummary(
      audit([
        { id: "a", category: "dependency", status: "pass", detail: "All dependencies resolved." },
        { id: "b", category: "redundancy", status: "flag", detail: "Overlap found." },
        { id: "c", category: "consistency", status: "skipped", detail: "Nothing to check yet." },
      ])
    );

    expect(result).toContain("All dependencies resolved.");
    expect(result).toContain("Overlap found.");
    expect(result).toContain("Nothing to check yet.");
  });

  it("renders only flag-status findings in 'flagsOnly' mode (issue #123)", () => {
    const result = formatStage4AuditSummary(
      audit([
        { id: "a", category: "dependency", status: "pass", detail: "All dependencies resolved." },
        { id: "b", category: "redundancy", status: "flag", detail: "Overlap found." },
        { id: "c", category: "consistency", status: "skipped", detail: "Nothing to check yet." },
      ]),
      "flagsOnly"
    );

    expect(result).not.toContain("All dependencies resolved.");
    expect(result).not.toContain("Nothing to check yet.");
    expect(result).toContain("Overlap found.");
  });

  it("falls back to a 'no outstanding flags' line in 'flagsOnly' mode when nothing is flagged", () => {
    const result = formatStage4AuditSummary(
      audit([{ id: "a", category: "dependency", status: "pass", detail: "All dependencies resolved." }]),
      "flagsOnly"
    );

    expect(result).not.toContain("All dependencies resolved.");
    expect(result).toContain("No outstanding flags");
  });

  it("tolerates a non-array findings field instead of throwing (issue #126)", () => {
    const malformed = { findings: null, generatedAt: "2026-01-01T00:00:00.000Z", authorApproved: false } as unknown as P3Stage4Audit;

    expect(() => formatStage4AuditSummary(malformed)).not.toThrow();
    const result = formatStage4AuditSummary(malformed);
    expect(result).toContain("No outstanding flags");
  });
});
