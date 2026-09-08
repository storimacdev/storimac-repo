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
  /**
   * Set only on a resolution turn where `conflictDetected` pointed at a
   * DIFFERENT field than the one just resolved (issue #106). Rather than
   * starting to track that field as a second pending conflict in the same
   * turn - which would fight over the single turn-level
   * conflictDetected/conflictDescription fields with the resolution this
   * turn already applied, and could misattach the OLD conflict's
   * description to the wrong field - the app downgrades it (and any
   * other stray Confirmed proposal this turn) to Working and logs a
   * warning. It will be caught by ordinary fresh detection on a later
   * turn if the model re-proposes it as Confirmed once nothing is being
   * resolved.
   */
  suppressedConflictField: string | null;
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

function downgradeAllConfirmed(
  updates: FactUpdateInput[],
  alreadyConfirmedFields: Set<string>
): FactUpdateInput[] {
  return updates.map((u) =>
    u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field) ? { ...u, state: "Working" } : u
  );
}

function downgradeAllConfirmedExcept(
  updates: FactUpdateInput[],
  alreadyConfirmedFields: Set<string>,
  excludeField: string
): FactUpdateInput[] {
  return updates.map((u) =>
    u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field) && u.field !== excludeField
      ? { ...u, state: "Working" }
      : u
  );
}

function findConflictCulprit(
  updates: FactUpdateInput[],
  alreadyConfirmedFields: Set<string>,
  excludeField?: string
): FactUpdateInput | undefined {
  return updates.find(
    (u) => u.state === "Confirmed" && !alreadyConfirmedFields.has(u.field) && u.field !== excludeField
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
 * - That same resolution turn might ALSO have `conflictDetected` set for a
 *   DIFFERENT field (issue #106) - rather than starting a second pending
 *   conflict in the same turn, that field (and any other stray Confirmed
 *   proposal this turn, excluding the one just resolved) is downgraded to
 *   Working and signaled via `suppressedConflictField`; a later turn's
 *   fresh detection (below) catches it for real once nothing is being
 *   resolved.
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

    const logEntry: ConflictLogEntryDraft = {
      charId,
      field: pendingConflict.field,
      conflictDescription: pendingConflict.conflictDescription,
      resolution,
    };

    // Issue #106: this same turn might ALSO have conflictDetected set for a
    // different field - rather than starting a second pending conflict in
    // the same turn (which would fight over the single turn-level
    // conflictDetected/conflictDescription fields with the resolution just
    // applied above, and could misattach this turn's description to the
    // wrong field), downgrade it and signal suppressedConflictField for the
    // route to log. A later turn's ordinary fresh-detection branch below
    // will catch it for real once nothing is being resolved. The field
    // just resolved above is excluded from the downgrade so this doesn't
    // silently un-confirm the author's own resolution.
    let suppressedConflictField: string | null = null;
    if (conflictDetected) {
      const culprit = findConflictCulprit(rawUpdates, alreadyConfirmedFields, pendingConflict.field);
      if (culprit) {
        suppressedConflictField = culprit.field;
        resolvedUpdates = downgradeAllConfirmedExcept(resolvedUpdates, alreadyConfirmedFields, pendingConflict.field);
      }
    }

    return { enforcedUpdates: resolvedUpdates, nextPendingConflict: null, logEntry, resolvedField, suppressedConflictField };
  }

  if (!pendingConflict && conflictDetected) {
    const culprit = findConflictCulprit(rawUpdates, alreadyConfirmedFields);
    if (culprit) {
      return {
        enforcedUpdates: downgradeAllConfirmed(enforcedUpdates, alreadyConfirmedFields),
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
        suppressedConflictField: null,
      };
    }
  }

  if (pendingConflict && pendingConflict.charId === charId) {
    return {
      enforcedUpdates: downgradeField(enforcedUpdates, pendingConflict.field, alreadyConfirmedFields),
      nextPendingConflict: pendingConflict,
      logEntry: null,
      resolvedField: null,
      suppressedConflictField: null,
    };
  }

  return { enforcedUpdates, nextPendingConflict: pendingConflict, logEntry: null, resolvedField: null, suppressedConflictField: null };
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
