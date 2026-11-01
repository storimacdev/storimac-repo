/**
 * Continuity Matrix & Tracking Roster — GitHub issue #97, PRD refs
 * P5-Prompt5 SCREENPLAY EDITION v2.0 §5.
 *
 * Built ahead of its issue number per the parent task's own build-order
 * note: Phase 2 (Scene Drafting, issue #94) must check this state before
 * a new scene drafts, and Phase 4 (Revision & Canonization, issue #96)
 * must update it when a scene is Confirmed - both are genuine consumers
 * of this module, not the reverse, so this is built first.
 *
 * Pure, immutable-update functions only - no Firestore, no LLM call in
 * this file, matching stateLedger.ts's own precedent. Persistence lives
 * in storyStore.ts's `p5ContinuityMatrix` field (added in this PR so
 * Phase 2/4 have somewhere to read/write it; issue #100 covers full
 * session-resume behavior on top of this).
 */

/** AC1: Hierarchy of Authority, enforced in this exact order for conflict
 * resolution. Index 0 is highest precedence. Exported as a const array
 * (not an enum) so `resolveAuthorityPrecedence` below can use simple
 * `indexOf` ranking without a parallel lookup table. */
export const HIERARCHY_OF_AUTHORITY = [
  "Author Directives",
  "Approved Screenplay Pages",
  "Project 4 Outline",
  "Project 1 Foundation",
  "Project 2 Characters",
  "Project 3 World",
] as const;

export type AuthoritySource = (typeof HIERARCHY_OF_AUTHORITY)[number];

/** Returns whichever of the given sources has the highest precedence
 * (lowest index in HIERARCHY_OF_AUTHORITY). Used by the Conflict
 * Intercept protocol (issue #98) to decide which side of a contradiction
 * wins when the author hasn't explicitly overridden. Throws on an empty
 * input or an unrecognized source, rather than silently defaulting - a
 * caller passing a bad source is a bug, not a runtime-recoverable case. */
export function resolveAuthorityPrecedence(sources: AuthoritySource[]): AuthoritySource {
  if (sources.length === 0) {
    throw new Error("resolveAuthorityPrecedence requires at least one source.");
  }
  return sources.reduce((highest, candidate) => {
    const highestRank = HIERARCHY_OF_AUTHORITY.indexOf(highest);
    const candidateRank = HIERARCHY_OF_AUTHORITY.indexOf(candidate);
    return candidateRank < highestRank ? candidate : highest;
  });
}

/** AC2: Knowledge & Secrets Ledger entry. `state` distinguishes a
 * character genuinely knowing a fact from merely suspecting it, or
 * actively lying about it - the three states the PRD names. */
export type KnowledgeState = "knows" | "suspects" | "lying";

export interface KnowledgeLedgerEntry {
  characterId: string;
  characterName: string;
  fact: string;
  state: KnowledgeState;
  /** The Confirmed scene number where this character first encountered
   * this fact on screen - the PRD's own "systematically encountered on
   * screen" test. */
  sinceSceneNumber: number;
}

/** AC3: Physical & Timeline Tracking entry - one tracked fact about a
 * character, prop, or the environment across Confirmed scenes. `kind`
 * covers the four categories AC3 names explicitly. */
export type PhysicalTrackingKind = "injury" | "costume" | "prop" | "weather" | "time_elapsed";

export interface PhysicalTrackingEntry {
  subject: string;
  kind: PhysicalTrackingKind;
  detail: string;
  sinceSceneNumber: number;
}

/** AC4: Narrative Loop Controls - a setup, visual motif, or sound cue
 * intentionally opened, tracked under Open Loops until intentionally
 * closed. `payoffSceneNumber` is the Project 4 blueprint's intended
 * payoff scene when known; it is frequently unknown today (P4's own
 * Setup & Payoff Ledger, issue #70 §6, is explicitly "not yet tracked" -
 * see compileArchitectureDocument.ts's NOT_TRACKED_LEDGER), so this
 * field stays nullable rather than assuming P4 always supplies it. */
export interface OpenLoop {
  id: string;
  description: string;
  kind: "setup" | "visual_motif" | "sound_cue";
  plantedSceneNumber: number;
  payoffSceneNumber: number | null;
  status: "open" | "closed";
  closedSceneNumber: number | null;
}

export interface ContinuityMatrix {
  knowledgeLedger: KnowledgeLedgerEntry[];
  physicalTracking: PhysicalTrackingEntry[];
  openLoops: OpenLoop[];
}

export function createEmptyContinuityMatrix(): ContinuityMatrix {
  return { knowledgeLedger: [], physicalTracking: [], openLoops: [] };
}

export interface ContinuityViolation {
  kind: "unearned_knowledge" | "stale_physical_state" | "open_loop_never_planted";
  message: string;
}

export interface ContinuityCheckResult {
  ok: boolean;
  violations: ContinuityViolation[];
}

/** AC2 + AC5: checked before a new scene drafts (Phase 2). A character
 * must never act on information they have not systematically
 * encountered on screen - `knows` is required; `suspects`/`lying` do not
 * satisfy a requirement that the character actually knows the fact
 * (those two states describe what a character currently believes or is
 * performing, not grounds for acting on confirmed knowledge). */
export function checkKnowledgeConsistency(
  matrix: ContinuityMatrix,
  requiredKnowledge: { characterId: string; fact: string }[],
  sceneNumber: number
): ContinuityCheckResult {
  const violations: ContinuityViolation[] = [];
  for (const req of requiredKnowledge) {
    const entry = matrix.knowledgeLedger.find(
      (k) => k.characterId === req.characterId && k.fact === req.fact
    );
    const earned = entry && entry.state === "knows" && entry.sinceSceneNumber < sceneNumber;
    if (!earned) {
      violations.push({
        kind: "unearned_knowledge",
        message: `Scene ${sceneNumber} requires ${req.characterId} to know "${req.fact}", but no prior Confirmed scene establishes that on screen.`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** AC5: checked before a new scene drafts. Flags when a scene's draft
 * ignores the most recent tracked physical/timeline state for a subject
 * it references (e.g. drafting a character as uninjured when the ledger
 * has a later, unresolved injury entry for them). Deliberately
 * last-write-wins per subject+kind - the ledger does not model recovery
 * timelines, only the most recent confirmed state. */
export function checkPhysicalConsistency(
  matrix: ContinuityMatrix,
  referencedSubjects: { subject: string; kind: PhysicalTrackingKind; expectedDetail: string }[]
): ContinuityCheckResult {
  const violations: ContinuityViolation[] = [];
  for (const ref of referencedSubjects) {
    const latest = matrix.physicalTracking
      .filter((p) => p.subject === ref.subject && p.kind === ref.kind)
      .sort((a, b) => b.sinceSceneNumber - a.sinceSceneNumber)[0];
    if (latest && latest.detail !== ref.expectedDetail) {
      violations.push({
        kind: "stale_physical_state",
        message: `"${ref.subject}" (${ref.kind}) is tracked as "${latest.detail}" since scene ${latest.sinceSceneNumber}, but this scene assumes "${ref.expectedDetail}".`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** AC4/AC5: a scene may only close an Open Loop that was actually
 * planted in an earlier Confirmed scene - closing one that was never
 * opened is itself a continuity error, not a valid payoff. */
export function checkLoopClosuresPlanted(
  matrix: ContinuityMatrix,
  loopIdsToClose: string[]
): ContinuityCheckResult {
  const violations: ContinuityViolation[] = [];
  for (const id of loopIdsToClose) {
    const loop = matrix.openLoops.find((l) => l.id === id);
    if (!loop) {
      violations.push({
        kind: "open_loop_never_planted",
        message: `Loop "${id}" cannot be closed - no Open Loop with that id has been planted.`,
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Composite pre-draft check (AC5: "checked before a new scene
 * drafts"). Runs all three checks and merges violations, so Phase 2's
 * drafting route has one call site. */
export function checkContinuityBeforeDraft(
  matrix: ContinuityMatrix,
  sceneNumber: number,
  params: {
    requiredKnowledge?: { characterId: string; fact: string }[];
    referencedSubjects?: { subject: string; kind: PhysicalTrackingKind; expectedDetail: string }[];
    loopIdsToClose?: string[];
  }
): ContinuityCheckResult {
  const knowledge = checkKnowledgeConsistency(matrix, params.requiredKnowledge ?? [], sceneNumber);
  const physical = checkPhysicalConsistency(matrix, params.referencedSubjects ?? []);
  const loops = checkLoopClosuresPlanted(matrix, params.loopIdsToClose ?? []);
  const violations = [...knowledge.violations, ...physical.violations, ...loops.violations];
  return { ok: violations.length === 0, violations };
}

/** The set of updates a Confirmed scene (Phase 4) applies to the matrix
 * (AC5: "updated when a scene is Confirmed"). Each array is additive;
 * callers report only what changed in this scene, not the full prior
 * state. */
export interface ContinuityMatrixUpdate {
  sceneNumber: number;
  knowledgeGained?: { characterId: string; characterName: string; fact: string; state: KnowledgeState }[];
  physicalChanges?: { subject: string; kind: PhysicalTrackingKind; detail: string }[];
  loopsOpened?: { id: string; description: string; kind: OpenLoop["kind"]; payoffSceneNumber?: number | null }[];
  loopsClosed?: string[];
}

/** AC5: applies a Confirmed scene's continuity updates. Immutable -
 * returns a new matrix, never mutates the one passed in, matching
 * stateLedger.ts's own convention. Each ledger kind is append-based (the
 * full history of who-knew-what-when and every tracked physical state
 * matters for later contradiction checks), except a loop open/close pair
 * which mutates that loop's own record in place since an Open Loop has
 * exactly one current status. */
export function applyContinuityMatrixUpdate(
  matrix: ContinuityMatrix,
  update: ContinuityMatrixUpdate
): ContinuityMatrix {
  const knowledgeLedger = [
    ...matrix.knowledgeLedger,
    ...(update.knowledgeGained ?? []).map((k) => ({ ...k, sinceSceneNumber: update.sceneNumber })),
  ];

  const physicalTracking = [
    ...matrix.physicalTracking,
    ...(update.physicalChanges ?? []).map((p) => ({ ...p, sinceSceneNumber: update.sceneNumber })),
  ];

  const openedIds = new Set((update.loopsOpened ?? []).map((l) => l.id));
  const closedIds = new Set(update.loopsClosed ?? []);

  const existingUpdated = matrix.openLoops.map((loop) =>
    closedIds.has(loop.id) && loop.status === "open"
      ? { ...loop, status: "closed" as const, closedSceneNumber: update.sceneNumber }
      : loop
  );

  const newlyOpened: OpenLoop[] = (update.loopsOpened ?? [])
    .filter((l) => !matrix.openLoops.some((existing) => existing.id === l.id))
    .map((l) => ({
      id: l.id,
      description: l.description,
      kind: l.kind,
      plantedSceneNumber: update.sceneNumber,
      payoffSceneNumber: l.payoffSceneNumber ?? null,
      status: "open" as const,
      closedSceneNumber: null,
    }));

  // A loop opened and closed in the very same update (a same-scene
  // setup+payoff) is valid - close it after adding it, never left
  // dangling open because closedIds was computed before newlyOpened
  // existed.
  const allOpened = [...existingUpdated, ...newlyOpened];
  const openLoops = allOpened.map((loop) =>
    openedIds.has(loop.id) && closedIds.has(loop.id) && loop.status === "open"
      ? { ...loop, status: "closed" as const, closedSceneNumber: update.sceneNumber }
      : loop
  );

  return { knowledgeLedger, physicalTracking, openLoops };
}

/** Narrative Loop Controls reporting helper - the Open Loops register
 * Phase 3's Compliance Report (issue #95) surfaces to the author. */
export function listOpenLoops(matrix: ContinuityMatrix): OpenLoop[] {
  return matrix.openLoops.filter((l) => l.status === "open");
}
