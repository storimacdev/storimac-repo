import { describe, it, expect } from "vitest";
import { sameDependsOnSet } from "./dependsOnEquality";

describe("sameDependsOnSet", () => {
  it("treats two empty lists as the same", () => {
    expect(sameDependsOnSet([], [])).toBe(true);
  });

  it("treats identical lists in the same order as the same", () => {
    expect(sameDependsOnSet(["pillar-geography", "pillar-magic"], ["pillar-geography", "pillar-magic"])).toBe(true);
  });

  it("treats the same set in a different order as the same (order-insensitive)", () => {
    expect(sameDependsOnSet(["pillar-geography", "pillar-magic"], ["pillar-magic", "pillar-geography"])).toBe(true);
  });

  it("treats lists of different lengths as different", () => {
    expect(sameDependsOnSet(["pillar-geography"], ["pillar-geography", "pillar-magic"])).toBe(false);
  });

  it("treats same-length lists with different members as different", () => {
    expect(sameDependsOnSet(["pillar-geography"], ["pillar-magic"])).toBe(false);
  });

  it("treats a list against empty as different", () => {
    expect(sameDependsOnSet(["pillar-geography"], [])).toBe(false);
  });

  it("does not mutate its input arrays (sorts copies, not the originals)", () => {
    const a = ["pillar-magic", "pillar-geography"];
    const b = ["pillar-geography", "pillar-magic"];
    sameDependsOnSet(a, b);
    expect(a).toEqual(["pillar-magic", "pillar-geography"]);
    expect(b).toEqual(["pillar-geography", "pillar-magic"]);
  });

  it("treats duplicate entries as significant (not deduplicated)", () => {
    expect(sameDependsOnSet(["pillar-geography", "pillar-geography"], ["pillar-geography"])).toBe(false);
  });
});
