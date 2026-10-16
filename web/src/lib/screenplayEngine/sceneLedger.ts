import type { CanonStatus } from "@/lib/canonEngine/types";
import type { ContinuityMatrixUpdate } from "./continuityMatrix";

/**
 * The state ledger for Project 5's scenes — GitHub issue #93 (Phase 1
 * gate needs somewhere to track per-scene gate/sign-off state), later
 * consumed by Phase 2 drafting (#94), Phase 3 QA (#95), Phase 4
 * Revision & Canonization (#96), and the Conflict Intercept protocol
 * (#98). Pure, immutable-update functions only — no Firestore, no LLM
 * call in this file, matching storyArchitectureEngine/stateLedger.ts's
 * exact convention for Project 4's structural units.
 *
 * `status` reuses the shared CanonStatus state machine (Exploring /
 * Working / Confirmed / Parked) per ARCHITECTURE.md §2: a scene starts
 * Exploring (no assignment summary yet), moves to Working once drafted
 * text exists, and only reaches Confirmed once the author explicitly
 * approves it in Phase 4 (issue #96 AC3/AC4) — "absolute, unalterable
 * text law" from that point on. `phase` tracks which of the four
 * Progressive Drafting Workflow phases (PRD §2) this scene is currently
 * sitting in, independent of (but usually correlated with) `status`.
 */

export type ScenePhase = "assignment_gate" | "drafting" | "qa_delivery" | "revision";

export interface SceneRecord {
  sceneNumber: number;
  status: CanonStatus;
  phase: ScenePhase;
  /** The Phase 1 one-paragraph assignment summary, once proposed. Null
   * until Phase 1 has produced one for this scene. */
  assignmentSummary: string | null;
  /** True only once the author has explicitly signed off on
   * `assignmentSummary` — issue #93 AC4's gate. Never set true any
   * other way. */
  signedOff: boolean;
  /** The current working draft text (Phase 2/3), overwritten freely
   * while status is Exploring/Working — provisional, not yet "law". */
  draftText: string | null;
  /** The frozen, immutable text once Confirmed (Phase 4, issue #96) —
   * once set, no code path in this module ever overwrites it; see
   * `confirmScene`'s own guard. */
  confirmedText: string | null;
  /** The Continuity Matrix outcomes (knowledge gained, physical
   * changes, loops opened/closed) this scene's current draft would
   * apply if Confirmed - captured whenever draft_text is (re)proposed
   * so Phase 4's confirmation turn (issue #96) can apply them to the
   * matrix without re-asking the model to repeat itself. Never applied
   * to the actual Continuity Matrix until the scene is genuinely
   * Confirmed (issue #97 AC5: "updated when a scene is Confirmed", not
   * before). */
  pendingMatrixUpdate: Omit<ContinuityMatrixUpdate, "sceneNumber"> | null;
  lastUpdated: string;
}

function nowOrDefault(now?: string): string {
  return now ?? new Date().toISOString();
}

export function createSceneRecord(sceneNumber: number, now?: string): SceneRecord {
  return {
    sceneNumber,
    status: "Exploring",
    phase: "assignment_gate",
    assignmentSummary: null,
    signedOff: false,
    draftText: null,
    confirmedText: null,
    pendingMatrixUpdate: null,
    lastUpdated: nowOrDefault(now),
  };
}

export function findScene(scenes: SceneRecord[], sceneNumber: number): SceneRecord | null {
  return scenes.find((s) => s.sceneNumber === sceneNumber) ?? null;
}

export function upsertScene(scenes: SceneRecord[], scene: SceneRecord): SceneRecord[] {
  const index = scenes.findIndex((s) => s.sceneNumber === scene.sceneNumber);
  if (index === -1) return [...scenes, scene];
  return scenes.map((s, i) => (i === index ? scene : s));
}

/**
 * Issue #93 AC1: "the system never drafts ahead or batches multiple
 * scenes." Encoded as: at most one scene may sit in a non-terminal
 * state (not Confirmed, not Parked) at a time. A scene already Parked
 * or Confirmed is resolved and does not block starting a different one.
 */
export function canOpenAssignmentGate(
  scenes: SceneRecord[],
  sceneNumber: number
): { ok: boolean; reason: string } {
  const blocking = scenes.find(
    (s) => s.sceneNumber !== sceneNumber && s.status !== "Confirmed" && s.status !== "Parked"
  );
  if (blocking) {
    return {
      ok: false,
      reason: `Scene ${blocking.sceneNumber} is still open (status: ${blocking.status}) — finish or park it before starting scene ${sceneNumber}.`,
    };
  }
  return { ok: true, reason: "" };
}

/** Issue #93 AC2/AC3: records the Phase 1 one-paragraph summary. Never
 * advances status/phase on its own — sign-off (below) is the only gate
 * that moves a scene out of assignment_gate. */
export function setAssignmentSummary(scene: SceneRecord, summary: string, now?: string): SceneRecord {
  return { ...scene, assignmentSummary: summary, lastUpdated: nowOrDefault(now) };
}

/** Issue #93 AC4: the gate. Only valid once a summary has actually been
 * proposed — signing off on nothing is a caller bug, not a state this
 * function silently accepts. */
export function signOffAssignment(scene: SceneRecord, now?: string): SceneRecord {
  if (!scene.assignmentSummary) {
    throw new Error(`Cannot sign off on scene ${scene.sceneNumber} — no assignment summary has been proposed yet.`);
  }
  return { ...scene, signedOff: true, phase: "drafting", lastUpdated: nowOrDefault(now) };
}

export function setDraftText(scene: SceneRecord, text: string, now?: string): SceneRecord {
  return { ...scene, draftText: text, status: "Working", lastUpdated: nowOrDefault(now) };
}

/** Captures this draft's Continuity Matrix outcomes for later
 * application on Confirm (issue #96). Independent of setDraftText so a
 * caller can update one without disturbing the other if needed, though
 * the route always calls both together. */
export function setPendingMatrixUpdate(
  scene: SceneRecord,
  update: Omit<ContinuityMatrixUpdate, "sceneNumber"> | null,
  now?: string
): SceneRecord {
  return { ...scene, pendingMatrixUpdate: update, lastUpdated: nowOrDefault(now) };
}

/** Issue #96 AC3: freezes a scene's text as immutable Confirmed canon.
 * Guards against re-confirming an already-Confirmed scene with
 * different text — "absolute, unalterable text law" means this
 * function is not how a Confirmed scene's text ever changes again. */
export function confirmScene(scene: SceneRecord, text: string, now?: string): SceneRecord {
  if (scene.status === "Confirmed" && scene.confirmedText !== text) {
    throw new Error(
      `Scene ${scene.sceneNumber} is already Confirmed — its text is immutable and cannot be re-confirmed with different content.`
    );
  }
  return {
    ...scene,
    status: "Confirmed",
    confirmedText: text,
    draftText: text,
    lastUpdated: nowOrDefault(now),
  };
}

export function parkScene(scene: SceneRecord, now?: string): SceneRecord {
  return { ...scene, status: "Parked", lastUpdated: nowOrDefault(now) };
}

/** Chooses the active scene for this turn (issue #93 AC1: one scene at a
 * time, never batched). Honors an explicit model-requested scene number
 * first (an author may legitimately revisit an open one); otherwise
 * resumes whichever scene is still open, or starts the next one after
 * the highest resolved scene number once every existing scene is
 * Confirmed/Parked. */
export function determineActiveSceneNumber(scenes: SceneRecord[], requested: number | null): number {
  if (requested !== null) return requested;
  const open = scenes.find((s) => s.status !== "Confirmed" && s.status !== "Parked");
  if (open) return open.sceneNumber;
  if (scenes.length === 0) return 1;
  return Math.max(...scenes.map((s) => s.sceneNumber)) + 1;
}

export function getConfirmedScenes(scenes: SceneRecord[]): SceneRecord[] {
  return scenes
    .filter((s) => s.status === "Confirmed")
    .sort((a, b) => a.sceneNumber - b.sceneNumber);
}
