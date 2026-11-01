import { describe, it, expect } from "vitest";
import { processConflict, type ProcessConflictParams } from "./foundationConflict";
import type { FactUpdateInput } from "./characterTurnSchema";
import type { P2PendingConflict } from "@/lib/canonEngine/storyStore";

/**
 * Issue #117 - cross-character sibling of issue #106's chained-conflict
 * fix. #106 covers the SAME character having a second conflict arise
 * while their first is still pending; this suite covers a DIFFERENT
 * character declaring a fresh conflict while another character's
 * conflict is still pending. The pending-conflict slot
 * (`P2PendingConflict`) is singular by design either way, so both cases
 * get the same suppress-and-defer treatment: downgrade the stray
 * Confirmed proposal(s) to Working, signal it via
 * `suppressedConflictField` instead of dropping it silently, and leave
 * the OTHER character's pending conflict untouched for a later turn's
 * ordinary fresh-detection branch to catch it for real.
 */

const PENDING_FOR_CHAR_A: P2PendingConflict = {
  charId: "char-a",
  characterName: "Alice",
  field: "coreWound",
  proposedValue: "Abandoned by her mother as a child",
  conflictDescription: "Contradicts the Story Foundation's established backstory for Alice.",
  ts: "2026-10-01T00:00:00.000Z",
};

function baseParams(overrides: Partial<ProcessConflictParams>): ProcessConflictParams {
  return {
    enforcedUpdates: [],
    rawUpdates: [],
    pendingConflict: null,
    charId: "char-b",
    characterName: "Bob",
    conflictDetected: false,
    conflictDescription: undefined,
    resolution: undefined,
    ts: "2026-10-16T00:00:00.000Z",
    alreadyConfirmedFields: new Set<string>(),
    ...overrides,
  };
}

describe("processConflict - issue #117 (different character's fresh conflict while another's is pending)", () => {
  it("suppresses and defers character B's fresh Confirmed conflict instead of dropping it, leaving character A's pending conflict untouched", () => {
    const bobUpdates: FactUpdateInput[] = [
      { field: "coreBelief", value: "Trust is earned, never given", state: "Confirmed" },
    ];

    const result = processConflict(
      baseParams({
        enforcedUpdates: bobUpdates,
        rawUpdates: bobUpdates,
        pendingConflict: PENDING_FOR_CHAR_A,
        charId: "char-b",
        characterName: "Bob",
        conflictDetected: true,
        conflictDescription: "Bob's belief contradicts the Story Foundation's theme.",
      })
    );

    // Bob's conflict is suppressed, not silently dropped.
    expect(result.suppressedConflictField).toBe("coreBelief");
    // Alice's pending conflict is left exactly as it was.
    expect(result.nextPendingConflict).toEqual(PENDING_FOR_CHAR_A);
    // No resolution/log entry - nothing was resolved this turn.
    expect(result.logEntry).toBeNull();
    expect(result.resolvedField).toBeNull();
    // Bob's stray Confirmed proposal is downgraded to Working, not applied
    // as Confirmed and not dropped from the update list entirely.
    expect(result.enforcedUpdates).toEqual([{ field: "coreBelief", value: "Trust is earned, never given", state: "Working" }]);
  });

  it("downgrades ALL of character B's stray Confirmed proposals this turn, not just the first culprit found", () => {
    const bobUpdates: FactUpdateInput[] = [
      { field: "coreBelief", value: "Trust is earned, never given", state: "Confirmed" },
      { field: "greatestFear", value: "Dying alone", state: "Confirmed" },
      { field: "voice", value: "Terse, clipped sentences", state: "Working" },
    ];

    const result = processConflict(
      baseParams({
        enforcedUpdates: bobUpdates,
        rawUpdates: bobUpdates,
        pendingConflict: PENDING_FOR_CHAR_A,
        charId: "char-b",
        conflictDetected: true,
        conflictDescription: "Bob's belief contradicts the Story Foundation's theme.",
      })
    );

    expect(result.suppressedConflictField).toBe("coreBelief");
    expect(result.enforcedUpdates).toEqual([
      { field: "coreBelief", value: "Trust is earned, never given", state: "Working" },
      { field: "greatestFear", value: "Dying alone", state: "Working" },
      { field: "voice", value: "Terse, clipped sentences", state: "Working" },
    ]);
    expect(result.nextPendingConflict).toEqual(PENDING_FOR_CHAR_A);
  });

  it("does not treat an already-Confirmed field as a new culprit, and passes everything through untouched when nothing is suppressible", () => {
    const bobUpdates: FactUpdateInput[] = [{ field: "name", value: "Bob", state: "Confirmed" }];

    const result = processConflict(
      baseParams({
        enforcedUpdates: bobUpdates,
        rawUpdates: bobUpdates,
        pendingConflict: PENDING_FOR_CHAR_A,
        charId: "char-b",
        conflictDetected: true,
        conflictDescription: "Flagged, but the only Confirmed field is already settled canon.",
        alreadyConfirmedFields: new Set(["name"]),
      })
    );

    expect(result.suppressedConflictField).toBeNull();
    expect(result.nextPendingConflict).toEqual(PENDING_FOR_CHAR_A);
    expect(result.enforcedUpdates).toEqual(bobUpdates);
  });

  it("leaves character A's own pending conflict alone when A is the one speaking (no cross-character suppression against yourself)", () => {
    const aliceUpdates: FactUpdateInput[] = [
      { field: "greatestFear", value: "Being forgotten", state: "Confirmed" },
    ];

    const result = processConflict(
      baseParams({
        enforcedUpdates: aliceUpdates,
        rawUpdates: aliceUpdates,
        pendingConflict: PENDING_FOR_CHAR_A,
        charId: "char-a",
        characterName: "Alice",
        conflictDetected: true,
        conflictDescription: "A second conflict for Alice herself - issue #106's territory, not #117's.",
      })
    );

    // This is #106's same-character re-gate path, not #117's cross-character
    // suppression - suppressedConflictField must stay null here, and the
    // existing field-specific re-gate (not the blanket downgrade) applies.
    expect(result.suppressedConflictField).toBeNull();
    expect(result.nextPendingConflict).toEqual(PENDING_FOR_CHAR_A);
  });

  it("does not suppress when conflict_detected is false, even with a different character's conflict pending", () => {
    const bobUpdates: FactUpdateInput[] = [{ field: "coreBelief", value: "Trust is earned", state: "Confirmed" }];

    const result = processConflict(
      baseParams({
        enforcedUpdates: bobUpdates,
        rawUpdates: bobUpdates,
        pendingConflict: PENDING_FOR_CHAR_A,
        charId: "char-b",
        conflictDetected: false,
      })
    );

    expect(result.suppressedConflictField).toBeNull();
    expect(result.nextPendingConflict).toEqual(PENDING_FOR_CHAR_A);
    // Nothing to suppress - Bob's update passes through unchanged (no
    // conflict was declared against it this turn).
    expect(result.enforcedUpdates).toEqual(bobUpdates);
  });
});
