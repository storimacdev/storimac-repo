import type { FactUpdateInput } from "./characterTurnSchema";
import type { P2PendingConflict } from "@/lib/canonEngine/storyStore";

/**
 * Project 2 conflict detection vs. the Story Foundation — GitHub issue
 * #30, design: docs/superpowers/specs/2026-08-08-p2-foundation-conflict-detection-design.md.
 * Pure, I/O-free (mirrors characterFsm.ts's/causalChain.ts's split from
 * their own I/O-bound callers). Detection itself is model-declared and
 * trusted (there's no deterministic way to judge whether a Core Wound
 * "contradicts" a Story Spine beat) - this module only enforces the
 * consequence of a declared conflict: gating canon status and tracking
 * the singular pending conflict/resolution lifecycle.
 *
 * Post-review fix (2026-08-08, whole-branch review of #30): the original
 * version only downgraded a conflicting fact once, on the detection turn.
 * A later turn that re-proposed the same fact as Confirmed - without the
 * model ever setting `resolution` - passed straight through, defeating
 * the feature's own hard-gate guarantee. This version re-gates on every
 * turn a conflict for the current character stays open, not just the
 * turn it was first detected on.
 */

export type ConflictResolutionChoice = "revert" | "update_foundation" | "park";

export interface ConflictLogEntryDraft {
  charId: string;
  field: string;
  conflictDescription: string;
  resolution: ConflictResolutionChoice;
}

export interface ConflictProcessingResult {
  enforcedUpdates: FactUpdateInput[];
  nextPendingConflict: P2PendingConflict | null;
  logEntry: ConflictLogEntryDraft | null;
  /**
   * Set only when resolution === "update_foundation" - names the field the
   * route must re-run through issue #28's causal-chain check before
   * treating it as final. This module can't do that check itself (it's
   * async/Firestore-backed, and this module is deliberately pure) - the
   * resolved update it builds carries whatever depends_on/rationale the
   * model re-proposed this turn (or none, if it didn't), so the route's
   * re-check is what actually decides whether it stays Confirmed.
   */
  resolvedField: string | null;
}

export interface ProcessConflictParams {
  /** This turn's updates after issue #28's causal-chain enforcement has already run. */
  enforcedUpdates: FactUpdateInput[];
  /**
   * This turn's updates BEFORE issue #28's enforcement ran - needed to
   * find a Confirmed proposal's original value/depends_on even when #28
   * already downgraded it to Working in enforcedUpdates. Without this, a
   * causal-chain-downgraded fact's Foundation conflict would go entirely
   * unrecorded (no pending conflict, no log, no warning).
   */
  rawUpdates: FactUpdateInput[];
  pendingConflict: P2PendingConflict | null;
  charId: string;
  characterName: string;
  conflictDetected: boolean;
  conflictDescription: string | undefined;
  resolution: ConflictResolutionChoice | undefined;
  ts: string;
  /**
   * Fields already Confirmed in the store for this character. Never
   * downgrade or select as a new conflict's culprit - re-litigating an
   * already-settled fact isn't this check's job (issue #10/#30's actual
   * Conflict Resolution flow, not automatic detection), and attempting to
   * change an already-Confirmed element's status aborts the whole turn's
   * fact-write transaction (the exact lesson issue #28 already learned
   * for its own causal-chain check - see causalChain.ts's isAlreadyConfirmed).
   */
  alreadyConfirmedFields: Set<string>;
}

function downgradeField(
  updates: FactUpdateInput[],
  field: string,
  alreadyConfirmedFields: Set<string>
): FactUpdateInput[] {
  return updates.map((u) =>
    u.field === field && u.state === "Confirmed" && !alreadyConfirmedFields.has(field)
      ? { ...u, state: "Working" }
      : u
  );
}

/**
 * Resolves this turn's conflict state:
 * - A pending conflict for THIS character plus a `resolution` this turn
 *   resolves it (revert drops the field entirely; update_foundation
 *   confirms it, carrying over any depends_on/rationale the model
 *   re-proposed this turn; park stores it as Deferred) and produces a log
 *   entry. A resolution turn under a DIFFERENT character than the one the
 *   conflict was raised against is ignored entirely (the conflict stays
 *   open for its own character) - reachable via issue #26's
 *   switch_override while a conflict is pending.
 * - No pending conflict, but `conflictDetected` is true and at least one
 *   Confirmed proposal exists in `rawUpdates` (checked against the
 *   ORIGINAL proposals, not the post-#28 `enforcedUpdates`, so a fact
 *   issue #28 already downgraded still gets caught here): that proposal
 *   becomes the new pending conflict, and every Confirmed update in
 *   `enforcedUpdates` this turn is downgraded to Working (conservative -
 *   no partial confirmation while a conflict is open).
 * - A conflict for THIS character is still open, but neither of the above
 *   applied this turn (no resolution, no fresh detection): re-gate it -
 *   a bare re-proposal of the same field as Confirmed, with no
 *   `resolution` set, must not slip through just because it isn't a
 *   "new" detection turn.
 * - Otherwise: `enforcedUpdates` passes through unchanged, and any
 *   pending conflict for a different character is left untouched.
 */
export function processConflict(params: ProcessConflictParams): ConflictProcessingResult {
  const {
    enforcedUpdates,
    rawUpdates,
    pendingConflict,
    charId,
    characterName,
    conflictDetected,
    conflictDescription,
    resolution,
    ts,
    alreadyConfirmedFields,
  } = params;

  if (pendingConflict && pendingConflict.charId === charId && resolution) {
    const remaining = enforcedUpdates.filter((u) => u.field !== pendingConflict.field);
    const reproposed =
      enforcedUpdates.find((u) => u.field === pendingConflict.field) ??
      rawUpdates.find((u) => u.field === pendingConflict.field);
    const value = reproposed?.value ?? pendingConflict.proposedValue ?? null;

    let resolvedUpdates: FactUpdateInput[] = remaining;
    let resolvedField: string | null = null;
    if (resolution === "update_foundation") {
      resolvedUpdates = [
        ...remaining,
        {
          field: pendingConflict.field,
          value,
          state: "Confirmed",
          rationale: reproposed?.rationale,
          depends_on: reproposed?.depends_on,
        },
      ];
      resolvedField = pendingConflict.field;
    } else if (resolution === "park") {
      resolvedUpdates = [...remaining, { field: pendingConflict.field, value, state: "Deferred" }];
    }
    // "revert": resolvedUpdates stays as `remaining` - the field is dropped entirely.

    return {
      enforcedUpdates: resolvedUpdates,
      nextPendingConflict: null,
      logEntry: {
        charId,
        field: pendingConflict.field,
        conflictDescription: pendingConflict.conflictDescription,
        resolution,
      },
      resolvedField,
    };
  }

  if (!pendingConflict && conflictDetected) {
    const culprit = rawUpdates.find((u) => u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field));
    if (culprit) {
      return {
        enforcedUpdates: downgradeField(enforcedUpdates, culprit.field, alreadyConfirmedFields),
        nextPendingConflict: {
          charId,
          characterName,
          field: culprit.field,
          proposedValue: culprit.value ?? null,
          conflictDescription: conflictDescription ?? "The model flagged a conflict but didn't provide a description.",
          ts,
        },
        logEntry: null,
        resolvedField: null,
      };
    }
  }

  if (pendingConflict && pendingConflict.charId === charId) {
    return {
      enforcedUpdates: downgradeField(enforcedUpdates, pendingConflict.field, alreadyConfirmedFields),
      nextPendingConflict: pendingConflict,
      logEntry: null,
      resolvedField: null,
    };
  }

  return { enforcedUpdates, nextPendingConflict: pendingConflict, logEntry: null, resolvedField: null };
}

/**
 * Context block to inject into the next model call once a conflict is
 * pending - mirrors conflictResolution.ts's buildConflictContextMessage
 * (Project 1, issue #10), adapted for P2's own resolution vocabulary and
 * for update_foundation's narrower scope in this issue (never auto-edits
 * the Foundation Document itself - see design decision 2).
 */
export function buildConflictContextMessage(conflict: P2PendingConflict): string {
  return [
    "[CONFLICT DETECTED - system note, not from the author]",
    `${conflict.characterName}'s proposed "${conflict.field}" (${JSON.stringify(conflict.proposedValue)}) contradicts the Story Foundation: ${conflict.conflictDescription}`,
    "Stop the interview. State this contradiction explicitly, in plain language, in `context` - that's where the full explanation belongs.",
    "In `reply`, present exactly three choices as the short numbered list: (A) Revert the proposal, (B) Update Story Foundation canon (the app logs this as a downstream-impact flag for the author to revisit in Project 1 later - it does not auto-edit the Foundation Document itself), (C) Park it for later.",
    "Your next structured output must set resolution to one of revert | update_foundation | park, matching the author's pick.",
  ].join("\n");
}
