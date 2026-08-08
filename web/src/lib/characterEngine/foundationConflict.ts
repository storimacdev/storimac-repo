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
}

/**
 * Resolves this turn's conflict state against `pendingConflict`:
 * - A pending conflict plus a `resolution` this turn resolves it (revert
 *   drops the field entirely; update_foundation confirms it; park stores
 *   it as Deferred) and produces a log entry.
 * - No pending conflict, but `conflictDetected` is true and at least one
 *   Confirmed update exists: the first Confirmed update becomes the new
 *   pending conflict, and every Confirmed update this turn is downgraded
 *   to Working (conservative - no partial confirmation while a conflict
 *   is open).
 * - Otherwise: `enforcedUpdates` passes through unchanged, and
 *   `pendingConflict` (if any) stays open, still awaiting a resolution.
 */
export function processConflict(
  enforcedUpdates: FactUpdateInput[],
  pendingConflict: P2PendingConflict | null,
  charId: string,
  characterName: string,
  conflictDetected: boolean,
  conflictDescription: string | undefined,
  resolution: ConflictResolutionChoice | undefined,
  ts: string
): ConflictProcessingResult {
  if (pendingConflict && resolution) {
    const remaining = enforcedUpdates.filter((u) => u.field !== pendingConflict.field);
    const reproposed = enforcedUpdates.find((u) => u.field === pendingConflict.field);
    const value = reproposed?.value ?? pendingConflict.proposedValue;

    let resolvedUpdates: FactUpdateInput[] = remaining;
    if (resolution === "update_foundation") {
      resolvedUpdates = [...remaining, { field: pendingConflict.field, value, state: "Confirmed" }];
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
    };
  }

  if (!pendingConflict && conflictDetected) {
    const culprit = enforcedUpdates.find((u) => u.state === "Confirmed");
    if (culprit) {
      const downgraded: FactUpdateInput[] = enforcedUpdates.map((u) =>
        u.state === "Confirmed" ? { ...u, state: "Working" } : u
      );
      return {
        enforcedUpdates: downgraded,
        nextPendingConflict: {
          charId,
          characterName,
          field: culprit.field,
          proposedValue: culprit.value,
          conflictDescription: conflictDescription ?? "The model flagged a conflict but didn't provide a description.",
          ts,
        },
        logEntry: null,
      };
    }
  }

  return { enforcedUpdates, nextPendingConflict: pendingConflict, logEntry: null };
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
