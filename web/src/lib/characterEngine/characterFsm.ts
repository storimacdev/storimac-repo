import type { P2State, P2CharacterProgress, P2CharacterStatus } from "@/lib/canonEngine/storyStore";

/**
 * Project 2 per-character stage-gate/lock — GitHub issue #26, design:
 * docs/superpowers/specs/2026-08-07-p2-sequential-interview-engine-design.md.
 * Pure, I/O-free (mirrors stageFsm.ts's split from its own I/O-bound
 * callers) - testable in isolation and importable client-side later
 * without dragging in firebaseAdmin.
 *
 * Deliberately does NOT gate on fact content (which facts must be
 * Confirmed before leaving a stage) - only Stage 2 has a defined field
 * vocabulary today (factRegistry.ts), and even that needs tier-scaling
 * this module has no reason to duplicate. That's issue #28's job. This
 * module only enforces what it can honestly enforce today: monotonic
 * one-stage-per-turn progression, and the single-active-character lock.
 */

export const P2_STAGE_NAMES: Record<number, string> = {
  1: "Position & Purpose",
  2: "Psychological Core",
  3: "Outward Identity & Voice",
  4: "Relationship Integration",
  5: "Transformational Arc Pacing",
  6: "Sign-Off & Compile",
};

export type CharacterTurnResolution =
  | { allowed: true; nextP2State: P2State; stage: number; status: P2CharacterStatus }
  | { allowed: false; activeCharId: string; activeProgress: P2CharacterProgress };

// Advances at most one stage per turn, and never regresses: a claim of
// prevStage+1 or lower is honored (or held at prevStage if it's a repeat
// or a regression); a claim 2+ stages ahead is clamped down to
// prevStage+1, never jumped straight to the claimed number.
function clampStage(prevStage: number, requestedStage: number): number {
  if (requestedStage > prevStage + 1) return prevStage + 1;
  return Math.max(requestedStage, prevStage);
}

/**
 * Resolves one turn's proposed (character, stage, sign-off, override)
 * against the story's persisted P2State. Never throws - an out-of-range
 * requestedStage is clamped, not rejected, since it's just an untrusted
 * model claim (same posture Project 1 takes toward malformed fact
 * proposals).
 */
export function resolveCharacterTurn(
  p2State: P2State,
  charId: string,
  characterName: string,
  requestedStage: number,
  signedOff: boolean,
  switchOverride: boolean
): CharacterTurnResolution {
  const { activeCharacterId, characterProgress } = p2State;

  if (activeCharacterId !== null && activeCharacterId !== charId && !switchOverride) {
    // Guarded with a fallback even though activeCharacterId is only ever
    // set alongside a matching progress entry by this same function - a
    // defensive stance against a corrupted/hand-edited Story doc, same
    // idiom stageFsm.ts uses for its own Firestore-sourced reads.
    const activeProgress: P2CharacterProgress = characterProgress[activeCharacterId] ?? {
      characterName: activeCharacterId,
      stage: 1,
      status: "in_progress",
    };
    return { allowed: false, activeCharId: activeCharacterId, activeProgress };
  }

  const nextCharacterProgress = { ...characterProgress };

  if (activeCharacterId !== null && activeCharacterId !== charId && switchOverride) {
    const priorProgress = characterProgress[activeCharacterId];
    if (priorProgress) {
      nextCharacterProgress[activeCharacterId] = { ...priorProgress, status: "deferred" };
    }
  }

  const prevStage = characterProgress[charId]?.stage ?? 1;
  const stage = clampStage(prevStage, requestedStage);
  const status: P2CharacterStatus = signedOff && stage === 6 ? "signed_off" : "in_progress";

  nextCharacterProgress[charId] = { characterName, stage, status };

  const nextP2State: P2State = {
    activeCharacterId: status === "signed_off" ? null : charId,
    characterProgress: nextCharacterProgress,
  };

  return { allowed: true, nextP2State, stage, status };
}
