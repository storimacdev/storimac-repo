import { describe, it, expect } from "vitest";

import { ArchitectureTurnSchema } from "./architectureTurnSchema";

/**
 * Coverage for issue #141: deferred_items[].defer_to_project was typed
 * `.nullable()`, diverging from worldTurnSchema.ts's/characterTurnSchema.ts's
 * own precedent for this exact field (both required, non-nullable). A
 * deferred item is only ever logged once its target project is known,
 * so there's no turn where this is legitimately null.
 */

const baseTurn = {
  reply: "Here's my take.",
  context: "Internal reasoning.",
  routing_choice: null,
  active_step_number: null,
  proposed_unit: null,
  validation_result: "not_applicable" as const,
  validation_reason: "No unit evaluated this turn.",
  resolution: null,
  structural_vector_options: null,
};

describe("ArchitectureTurnSchema - deferred_items.defer_to_project (issue #141)", () => {
  it("accepts a deferred item with a concrete defer_to_project", () => {
    const result = ArchitectureTurnSchema.safeParse({
      ...baseTurn,
      deferred_items: [{ item: "Character backstory detail", defer_to_project: "Project 2", notes: "Came up mid-turn." }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a deferred item with defer_to_project: null", () => {
    const result = ArchitectureTurnSchema.safeParse({
      ...baseTurn,
      deferred_items: [{ item: "Something", defer_to_project: null, notes: "" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects defer_to_project: 'Project 4' (P4 deferring to itself is never valid)", () => {
    const result = ArchitectureTurnSchema.safeParse({
      ...baseTurn,
      deferred_items: [{ item: "Something", defer_to_project: "Project 4", notes: "" }],
    });
    expect(result.success).toBe(false);
  });
});
