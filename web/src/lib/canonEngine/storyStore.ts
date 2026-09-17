import { getDb } from "@/lib/firebaseAdmin";
import { listElements } from "./canonStore";
import type { CanonElement, CanonStatus } from "./types";
import { getWorkspace, TierLimitError } from "@/lib/workspace/workspaceStore";
import { TIER_LIMITS } from "@/lib/workspace/types";
import type { RoutingState } from "@/lib/storyArchitectureEngine/developmentLoop";
import type { StructuralUnit, StructuralUnitType } from "@/lib/storyArchitectureEngine/stateLedger";

/**
 * Story persistence — GitHub issue #12, reference implementation of the
 * shared engine's session persistence (ARCHITECTURE.md §2). Firestore-backed
 * per ARCHITECTURE.md §6: /stories/{storyId}, with elements/messages/etc as
 * subcollections (elements via canonStore.ts; messages here).
 *
 * Scope note: ownership is enforced in code here (assertOwnership, called by
 * every mutating/reading function below) and mirrored in firestore.rules for
 * defense in depth, but real Firebase Auth (verifying an ID token to get a
 * trustworthy ownerUid in the first place) is NOT wired into the app yet -
 * that's separate, not-yet-filed work. Every function here takes ownerUid as
 * an explicit caller-supplied argument; once real auth exists, callers pass
 * the verified UID from the session instead of a placeholder.
 */

export type AuthorType = "A" | "B" | "C" | "D";

export interface AuthorTypeAssessment {
  type: AuthorType;
  confidence: number;
  ts: string;
}

export interface StoryPendingConflict {
  element_id: string;
  old_value: unknown;
  new_value: unknown;
}

/** Project 2 per-character interview progress (issue #26). */
export type P2CharacterStatus = "in_progress" | "deferred" | "signed_off";

export interface P2CharacterProgress {
  characterName: string;
  /** 1-6, app-computed ground truth - never trusted raw from the model. */
  stage: number;
  status: P2CharacterStatus;
}

export interface P2State {
  /** The locked character's charId, or null if no character is currently locked (free to start/resume anyone). */
  activeCharacterId: string | null;
  /** Keyed by charId (see character-chat/route.ts's resolveCharId). */
  characterProgress: Record<string, P2CharacterProgress>;
}

/** Project 2's pending conflict vs. the Story Foundation (issue #30) - a character fact awaiting one of three author resolutions, gating that fact's confirmation until resolved. Singular, like P1's own StoryPendingConflict - only one conflict is ever open at a time. */
export interface P2PendingConflict {
  charId: string;
  characterName: string;
  field: string;
  proposedValue: unknown;
  conflictDescription: string;
  ts: string;
}

/** Project 3's pending conflict (issue #47) - either a proposed edit
 * contradicting a Confirmed World Entry (detected structurally, hence
 * old_value/new_value under the same entryId - same shape as P1's own
 * StoryPendingConflict) or a new idea contradicting the immutable Story
 * Foundation (detected via model self-report, same as P2PendingConflict,
 * since there's no deterministic way to judge contradiction against
 * prose). Singular, like P1/P2's own pending-conflict fields - only one
 * conflict is ever open at a time. */
export type P3PendingConflict =
  | { kind: "confirmed_entry"; entryId: string; entryName: string; oldValue: unknown; newValue: unknown; ts: string }
  | { kind: "foundation"; description: string; ts: string };

/** Project 3's Stage 4 System Integration Audit (issue #49) - computed
 * once per story, the first time the model reports reaching Stage 4+;
 * gates only the 4->5 (Compile) transition. Findings mix two rules-based
 * checks (dependency-graph completeness, redundancy) with one
 * model-driven consistency pass - see worldEngine/stage4Audit.ts, which
 * computes these but doesn't own the persisted shape (same split already
 * established for P3PendingConflict/conflictResolution.ts). */
export interface Stage4AuditFinding {
  id: string;
  category: "dependency" | "redundancy" | "consistency";
  status: "pass" | "flag" | "skipped";
  detail: string;
}

export interface P3Stage4Audit {
  findings: Stage4AuditFinding[];
  generatedAt: string;
  /** Set only when the author gives a clear, explicit approval (issue
   * #49's AC requires this - deliberately stronger than Stage 7's own
   * "any reply counts as acknowledgment" convention). Gates Stage 5. */
  authorApproved: boolean;
}

/** Project 3's World Complexity Level and Pillar list state (issues #39,
 * #40) - not part of the 4-state canon machinery. `proposedWorldComplexityLevel`
 * and `proposedPillars` update from any turn where the model reports a
 * value; `worldComplexityLevel` and `pillars` only change via an explicit
 * author action (PATCH /api/world-chat/wcl, PATCH /api/world-chat/pillars),
 * never from a turn response directly. `pillars: null` means the author
 * hasn't adopted a working list yet; `pillars: []` is a distinct,
 * deliberate "cleared it out" state - never conflate the two. */
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  proposedPillars: string[] | null;
  pillars: string[] | null;
  /** Issue #43: the pillar currently locked for Stage 3's Discover/
   * Develop/Validate cycle - mirrors P2State.activeCharacterId, per
   * issue #54's platform decision (one continuous thread, not
   * per-pillar sessions). `null` means no pillar is currently active. */
  activePillar: string | null;
}

/** Fills in `null` defaults for any P3 sub-field missing from a Story
 * doc written before that sub-field existed (Firestore has no schema, so
 * an old doc simply lacks the key rather than storing it as null) -
 * every route that needs "the current p3 state, safe to read or spread"
 * should go through this rather than hand-writing a defaults literal. */
export function normalizeP3(p3: P3State | null | undefined): P3State {
  return {
    proposedWorldComplexityLevel: null,
    worldComplexityLevel: null,
    proposedPillars: null,
    pillars: null,
    activePillar: null,
    ...p3,
  };
}

/** Project 4's onboarding/routing state (issue #111) - deliberately
 * minimal, mirroring P2State/P3State's own scalar/small-object shape.
 * The structural-unit ledger itself lives in the separate `p4Units`
 * field on Story (below), not nested here, matching how P3 keeps
 * `p3PendingConflict`/`p3Stage4Audit` as siblings of `p3` rather than
 * nested inside it. */
export interface P4State {
  /** False until the model reports a non-null routing_choice for the
   * first time (issue #111 Decision 2) - the app-side backstop for
   * onboardingGate.ts's own "no prose before the gate completes" rule,
   * mirroring how p3Stage4Audit.authorApproved gates issue #49's Stage
   * 4->5 transition. Never set back to false once true. */
  onboardingComplete: boolean;
  routing: RoutingState | null;
}

/** Fills in defaults for a Story doc written before P4 state existed -
 * same reasoning as normalizeP3. */
export function normalizeP4(p4: P4State | null | undefined): P4State {
  return {
    onboardingComplete: false,
    routing: null,
    ...p4,
  };
}

/** Project 4's pending Canon Revision conflict (issue #64) - either a
 * deterministic lifecycle regression (an already-Confirmed unit asked
 * to move back to Exploring/Working, detected via
 * canonEngine/transitions.ts's isValidTransition) or a cross-project
 * contradiction against already-locked P1-3 canon (detected via model
 * self-report, since there's no deterministic way to judge
 * contradiction against another project's canon from P4's side).
 * Singular, like P1/P2/P3's own pending-conflict fields - only one
 * conflict is ever open at a time. Both variants carry the triggering
 * turn's full requested content/status/canon_refs/type so
 * canonRevision.ts's resolveP4Conflict can apply the original request
 * later without asking the model to re-propose it from scratch - same
 * reasoning as P3PendingConflict's "confirmed_entry" variant storing
 * newValue at detection time. */
export type P4PendingConflict =
  | {
      kind: "unit_regression";
      unitId: string;
      type: StructuralUnitType;
      requestedStatus: CanonStatus;
      requestedContent: string;
      requestedCanonRefs: string[];
      ts: string;
    }
  | {
      kind: "canon_contradiction";
      unitId: string;
      type: StructuralUnitType;
      sourceProject: "Project 1" | "Project 2" | "Project 3";
      contradictedRef: string;
      explanation: string;
      requestedStatus: CanonStatus;
      requestedContent: string;
      requestedCanonRefs: string[];
      /** Whether the triggering turn's content already passed Core-Purpose
       * validation AND the causality gate (issues #111/#63), captured at
       * detection time since those results are otherwise discarded before
       * the author ever resolves this conflict. `accept_and_update`
       * (canonRevision.ts's resolveP4Conflict) clamps requestedStatus down
       * to Working when this is false and Confirmed was requested - final
       * whole-branch review finding I2: without this, an author's "yes,
       * accept the new idea" could reach Confirmed canon while silently
       * bypassing both already-shipped gates. unit_regression has no
       * equivalent field - its requestedStatus can never be Confirmed
       * (isValidTransition(Confirmed, Confirmed) is true, so that case
       * never reaches this trigger at all). */
      gatesPassed: boolean;
      ts: string;
    };

export interface Story {
  id: string;
  ownerUid: string;
  /** The Workspace ("Story Workspace") this Canvas belongs to - see lib/workspace. */
  workspaceId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentProject: string;
  currentStage: number;
  currentElementId: string | null;
  authorTypeHistory: AuthorTypeAssessment[];
  /**
   * Set by /api/chat (issue #89) when a turn's proposed update conflicts
   * with a Confirmed element, cleared once the author picks a resolution
   * (issue #10's 3-way choice). Optional/nullable since Stories created
   * before this field existed won't have it in Firestore.
   */
  pendingConflict?: StoryPendingConflict | null;
  /**
   * Stage 7 audit result (issue #17), written when the Project enters Stage
   * 7. Stage 8 entry is gated on `authorResponded` becoming true (the
   * author's next message after seeing the summary flips it).
   */
  stage7Audit?: import("./stage7Audit").Stage7AuditResult | null;
  /**
   * Project 2's per-character interview lock/progress (issue #26).
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2?: P2State | null;
  /**
   * Project 2's pending conflict vs. the Story Foundation (issue #30),
   * cleared once the author picks one of the three resolution choices.
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2PendingConflict?: P2PendingConflict | null;
  /**
   * Project 3's pending conflict (issue #47), cleared once the author
   * picks one of the three resolution choices. Optional/nullable since
   * Stories created before this field existed won't have it in
   * Firestore.
   */
  p3PendingConflict?: P3PendingConflict | null;
  /**
   * Project 3's Stage 4 System Integration Audit (issue #49), computed
   * once per story and cleared only if the story is ever reset. Optional/
   * nullable since Stories created before this field existed won't have
   * it in Firestore.
   */
  p3Stage4Audit?: P3Stage4Audit | null;
  /**
   * Project 3's World Complexity Level state (issue #39). Optional/
   * nullable since Stories created before this field existed won't have
   * it in Firestore.
   */
  p3?: P3State | null;
  /**
   * Project 4's onboarding/routing state (issue #111). Optional/nullable
   * since Stories created before this field existed won't have it in
   * Firestore.
   */
  p4?: P4State | null;
  /**
   * Project 4's structural-unit session ledger (issue #111) - the
   * author's editor is the sole owner of this array each turn (the live
   * agent reports the full current unit it's working on; the route
   * upserts into the existing array and writes the whole thing back),
   * matching setP3Pillars's own "no concurrent-multi-writer case"
   * reasoning. Optional/nullable since Stories created before this
   * field existed won't have it in Firestore.
   */
  p4Units?: StructuralUnit[] | null;
  /**
   * Project 4's pending Canon Revision conflict (issue #64), cleared
   * once the author picks one of the three resolution choices.
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p4PendingConflict?: P4PendingConflict | null;
  /**
   * Project 1 completion lock. Set true by every successful Story
   * Foundation Document generation (POST .../document); cleared only by
   * the explicit unlock action (POST .../unlock). Optional/nullable since
   * Stories created before this field existed won't have it in Firestore
   * — treat undefined/null the same as false (unlocked) everywhere this
   * is read.
   */
  p1Locked?: boolean | null;
}

export interface StoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  turnId: string;
  context?: string;
  /** Project 2 only (issues #26/#27) — the character this assistant turn
   * reported as current. Optional since Project 1 messages, and every
   * user-role message, never set this. */
  current_character?: string;
  /** The stage this assistant turn reported as current - Project 2 (1-6,
   * issues #26/#27) or Project 3 (1-5, issue #38), whichever project wrote
   * this message; each project's own subcollection keeps the two from ever
   * mixing. Optional since Project 1 messages, and every user-role
   * message, never set this. */
  current_stage?: number;
}

/** Project 2's message subcollection name (issues #26/#27) - exported so
 * every consumer references the same literal instead of duplicating the
 * string across files, which would let a typo silently split reads and
 * writes across two different subcollections with no compile error. */
export const CHARACTER_MESSAGES_COLLECTION = "characterMessages";

/** Project 3's message subcollection name (issue #38) - same reasoning as
 * CHARACTER_MESSAGES_COLLECTION above. Reuses StoryMessage's existing
 * `current_stage` field as-is (no Project-3-specific message type needed);
 * `current_character` simply stays unset for every Project 3 message,
 * since Project 3 has no per-character concept. */
export const WORLD_MESSAGES_COLLECTION = "worldMessages";

/** Project 4's message subcollection name (issue #111) - same reasoning
 * as WORLD_MESSAGES_COLLECTION/CHARACTER_MESSAGES_COLLECTION. */
export const ARCHITECTURE_MESSAGES_COLLECTION = "architectureMessages";

export class StoryAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryAccessError";
  }
}

function storiesCollection() {
  return getDb().collection("stories");
}

function messagesCollection(storyId: string, collection: string = "messages") {
  return storiesCollection().doc(storyId).collection(collection);
}

async function countStoriesInWorkspace(workspaceId: string): Promise<number> {
  const snap = await storiesCollection().where("workspaceId", "==", workspaceId).get();
  return snap.size;
}

/**
 * Creates a Story ("Story Canvas" in issue #88's terminology) inside a
 * Workspace. Enforces the workspace's tier canvas limit (Free: 1 canvas
 * per workspace) before creating - issue #88's "1 Story Canvas" Free-tier
 * limit, checked here rather than left to the caller/UI to remember.
 */
export async function createStory(
  ownerUid: string,
  workspaceId: string,
  title: string,
  currentProject = "project1"
): Promise<Story> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);

  const limits = TIER_LIMITS[workspace.tier];
  if (limits.maxCanvasesPerWorkspace !== null) {
    const existing = await countStoriesInWorkspace(workspaceId);
    if (existing >= limits.maxCanvasesPerWorkspace) {
      throw new TierLimitError(
        `${workspace.tier} tier allows only ${limits.maxCanvasesPerWorkspace} Story Canvas per workspace; workspace "${workspaceId}" already has ${existing}.`
      );
    }
  }

  const now = new Date().toISOString();
  const ref = storiesCollection().doc();
  const story: Story = {
    id: ref.id,
    ownerUid,
    workspaceId,
    title,
    createdAt: now,
    updatedAt: now,
    currentProject,
    currentStage: 1,
    currentElementId: null,
    authorTypeHistory: [],
    pendingConflict: null,
  };
  await ref.set(story);
  return story;
}

export async function getStory(storyId: string): Promise<Story | null> {
  const snap = await storiesCollection().doc(storyId).get();
  return snap.exists ? (snap.data() as Story) : null;
}

async function assertOwnership(storyId: string, ownerUid: string): Promise<Story> {
  const story = await getStory(storyId);
  if (!story) {
    throw new StoryAccessError(`Story "${storyId}" not found.`);
  }
  if (story.ownerUid !== ownerUid) {
    throw new StoryAccessError(`Story "${storyId}" does not belong to this author.`);
  }
  return story;
}

export async function listStories(ownerUid: string): Promise<Story[]> {
  const snap = await storiesCollection()
    .where("ownerUid", "==", ownerUid)
    .orderBy("updatedAt", "desc")
    .get();
  return snap.docs.map((d) => d.data() as Story);
}

export async function listStoriesInWorkspace(workspaceId: string): Promise<Story[]> {
  const snap = await storiesCollection()
    .where("workspaceId", "==", workspaceId)
    .orderBy("updatedAt", "desc")
    .get();
  return snap.docs.map((d) => d.data() as Story);
}

export async function renameStory(storyId: string, ownerUid: string, title: string): Promise<Story> {
  await assertOwnership(storyId, ownerUid);
  const updatedAt = new Date().toISOString();
  await storiesCollection().doc(storyId).update({ title, updatedAt });
  return { ...(await getStory(storyId))!, title, updatedAt };
}

/** Deletes the Story doc and every subcollection under it (elements, messages, ...). */
export async function deleteStory(storyId: string, ownerUid: string): Promise<void> {
  await assertOwnership(storyId, ownerUid);
  await getDb().recursiveDelete(storiesCollection().doc(storyId));
}

export async function touchStory(
  storyId: string,
  patch: Partial<Pick<Story, "currentStage" | "currentElementId">> = {}
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ ...patch, updatedAt: new Date().toISOString() });
}

/** Records or clears the conflict awaiting the author's 3-way resolution choice (issue #10, wired in issue #89). */
export async function setPendingConflict(
  storyId: string,
  conflict: StoryPendingConflict | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ pendingConflict: conflict, updatedAt: new Date().toISOString() });
}

/** Stores/updates the Stage 7 audit (issue #17); pass null to clear on stage revisit. */
export async function setStage7Audit(
  storyId: string,
  audit: import("./stage7Audit").Stage7AuditResult | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ stage7Audit: audit, updatedAt: new Date().toISOString() });
}

/** Project 1 completion lock (see the `p1Locked` field doc on `Story`) - same whole-value-replace convention as setPendingConflict/setStage7Audit above. */
export async function setP1Locked(storyId: string, locked: boolean): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p1Locked: locked, updatedAt: new Date().toISOString() });
}

/** Stores Project 2's per-character lock/progress (issue #26) - whole-object replace, same convention as setStage7Audit. */
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2, updatedAt: new Date().toISOString() });
}

/** Updates only Project 3's model-proposed World Complexity Level (issue
 * #39 final-review fix) - a dotted-field-path update so this write and
 * setP3ConfirmedLevel below touch disjoint Firestore fields. A whole-
 * object read-modify-write here previously let a turn's stale `story.p3`
 * snapshot (held across a 10-45s model call) silently overwrite an
 * author's confirmed level if they clicked Confirm while that turn was
 * still in flight - this write can never touch worldComplexityLevel, so
 * it can no longer clobber it no matter how stale the caller's own read
 * was. */
export async function setP3ProposedLevel(storyId: string, level: 1 | 2 | 3 | 4): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.proposedWorldComplexityLevel": level, updatedAt: new Date().toISOString() });
}

/** Updates only Project 3's author-confirmed World Complexity Level
 * (issue #39 final-review fix) - the counterpart to setP3ProposedLevel
 * above, keeping the two writers' fields disjoint so neither can clobber
 * the other regardless of which one reads a stale snapshot first. */
export async function setP3ConfirmedLevel(storyId: string, level: 1 | 2 | 3 | 4): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.worldComplexityLevel": level, updatedAt: new Date().toISOString() });
}

/** Updates only Project 3's model-proposed pillar list (issue #40) - a
 * dotted-field-path update, same disjointness reasoning as
 * setP3ProposedLevel: this write can never touch `pillars`, so it can't
 * clobber an author's already-adopted working list no matter how stale
 * this call's own read of `story.p3` was. */
export async function setP3ProposedPillars(storyId: string, pillars: string[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.proposedPillars": pillars, updatedAt: new Date().toISOString() });
}

/** Updates only Project 3's author-adopted pillar list (issue #40) - the
 * counterpart to setP3ProposedPillars above, keeping the two writers'
 * fields disjoint. */
export async function setP3Pillars(storyId: string, pillars: string[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.pillars": pillars, updatedAt: new Date().toISOString() });
}

/** Sets Project 3's currently-locked pillar for the Stage 3 Discover/
 * Develop/Validate cycle (issue #43) - null clears the lock. Uses a
 * dotted-field-path update, same convention as every other P3 sub-field
 * writer, so it can never clobber the other P3 fields regardless of
 * which writer reads a stale snapshot first. */
export async function setP3ActivePillar(storyId: string, pillar: string | null): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.activePillar": pillar, updatedAt: new Date().toISOString() });
}

export async function setP4OnboardingComplete(storyId: string, complete: boolean): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p4.onboardingComplete": complete, updatedAt: new Date().toISOString() });
}

export async function setP4Routing(storyId: string, routing: RoutingState | null): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p4.routing": routing, updatedAt: new Date().toISOString() });
}

/** Whole-array-replace, matching setP3Pillars's exact precedent - the
 * live agent reports the full current state of the unit it touched
 * this turn; the route (Task 4) merges it into the existing array via
 * stateLedger.ts's own upsertUnit before calling this. */
export async function setP4Units(storyId: string, units: StructuralUnit[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p4Units: units, updatedAt: new Date().toISOString() });
}

/** Records or clears Project 4's pending Canon Revision conflict (issue #64); pass null to clear once resolved. */
export async function setP4PendingConflict(
  storyId: string,
  conflict: P4PendingConflict | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p4PendingConflict: conflict, updatedAt: new Date().toISOString() });
}

/** Records or clears Project 2's pending Story Foundation conflict (issue #30); pass null to clear once resolved. */
export async function setP2PendingConflict(
  storyId: string,
  conflict: P2PendingConflict | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2PendingConflict: conflict, updatedAt: new Date().toISOString() });
}

/** Records or clears Project 3's pending conflict (issue #47); pass null to clear once resolved. */
export async function setP3PendingConflict(
  storyId: string,
  conflict: P3PendingConflict | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p3PendingConflict: conflict, updatedAt: new Date().toISOString() });
}

/** Records or clears Project 3's Stage 4 audit (issue #49); pass null only if the story is ever reset. */
export async function setP3Stage4Audit(
  storyId: string,
  audit: P3Stage4Audit | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p3Stage4Audit: audit, updatedAt: new Date().toISOString() });
}

export interface StoredOutstandingQuestion {
  item: string;
  defer_to: "Project 2" | "Project 3" | "Project 4" | "Project 5" | null;
  notes: string;
  ts: string;
  /** The P2 character this item was deferred from, if any (issue #34's
   * retrofit) - optional/absent on every P1-originated entry and every
   * issue #32 entry written before this field existed. */
  charId?: string;
}

function outstandingQuestionsCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("outstanding_questions");
}

/** Persists outstanding questions generated at stage advancement (ARCHITECTURE.md §6 subcollection). */
export async function appendOutstandingQuestions(
  storyId: string,
  questions: Omit<StoredOutstandingQuestion, "ts">[]
): Promise<void> {
  if (questions.length === 0) return;
  const ts = new Date().toISOString();
  const batch = getDb().batch();
  for (const q of questions) {
    batch.set(outstandingQuestionsCollection(storyId).doc(), { ...q, ts });
  }
  await batch.commit();
}

export async function listOutstandingQuestions(storyId: string): Promise<StoredOutstandingQuestion[]> {
  const snap = await outstandingQuestionsCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as StoredOutstandingQuestion);
}

export interface StoredGuardrailFlag {
  turnId: string;
  questionCount: number;
  ts: string;
}

function guardrailFlagsCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("guardrail_flags");
}

/** Persists a questionnaire-dump flag for prompt-tuning review (issue #23). Only flagged turns get a doc. */
export async function appendGuardrailFlag(
  storyId: string,
  flag: Omit<StoredGuardrailFlag, "ts">
): Promise<StoredGuardrailFlag> {
  const ts = new Date().toISOString();
  const full: StoredGuardrailFlag = { ...flag, ts };
  await guardrailFlagsCollection(storyId).add(full);
  return full;
}

export async function listGuardrailFlags(storyId: string): Promise<StoredGuardrailFlag[]> {
  const snap = await guardrailFlagsCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as StoredGuardrailFlag);
}

/** Project 2's canon_conflicts_log (issue #30, PRD §7) - one entry per resolved Story Foundation conflict. */
export interface CharacterConflictLogEntry {
  charId: string;
  field: string;
  conflictDescription: string;
  resolution: "revert" | "update_foundation" | "park";
  resolvedBy: string;
  ts: string;
  turnId: string;
}

function characterConflictsLogCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("characterConflictsLog");
}

/** Appends a resolved conflict to Project 2's conflicts log (issue #30). */
export async function appendCharacterConflictLog(
  storyId: string,
  entry: CharacterConflictLogEntry
): Promise<void> {
  await characterConflictsLogCollection(storyId).add(entry);
}

/** Project 3's conflict resolution log (issue #47, PRD §4.5) - one entry per resolved conflict, either kind. */
export interface P3ConflictLogEntry {
  kind: "confirmed_entry" | "foundation";
  description: string;
  /** Present only for kind "confirmed_entry". */
  entryId?: string;
  /** Present only for kind "confirmed_entry" - the entry's value before/after the proposed change, so a deferred decision remains actionable later instead of being lost once p3PendingConflict is cleared. */
  oldValue?: unknown;
  newValue?: unknown;
  resolution: "revert" | "revise" | "defer";
  resolvedBy: string;
  ts: string;
  turnId: string;
}

function p3ConflictLogCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("p3ConflictLog");
}

/** Appends a resolved conflict to Project 3's conflict log (issue #47). */
export async function appendP3ConflictLog(storyId: string, entry: P3ConflictLogEntry): Promise<void> {
  await p3ConflictLogCollection(storyId).add(entry);
}

export async function listP3ConflictLog(storyId: string): Promise<P3ConflictLogEntry[]> {
  const snap = await p3ConflictLogCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as P3ConflictLogEntry);
}

/** Project 4's Canon Revision log (issue #64) - one entry per resolved conflict, either kind. */
export interface P4CanonRevisionLogEntry {
  kind: "unit_regression" | "canon_contradiction";
  unitId: string;
  description: string;
  /** Present only for kind "canon_contradiction". */
  sourceProject?: "Project 1" | "Project 2" | "Project 3";
  contradictedRef?: string;
  resolution: "revert" | "accept_and_update" | "park";
  resolvedBy: string;
  ts: string;
  turnId: string;
}

function p4CanonRevisionLogCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("p4CanonRevisionLog");
}

/** Appends a resolved conflict to Project 4's Canon Revision log (issue #64). */
export async function appendP4CanonRevisionLog(storyId: string, entry: P4CanonRevisionLogEntry): Promise<void> {
  await p4CanonRevisionLogCollection(storyId).add(entry);
}

/** Project 2's compiled, permanent Character Bible entries (issue #34,
 * CDRM §7) - one per signed-off character, written exactly once. */
export interface CharacterBibleEntry {
  charId: string;
  metadata: {
    character_name: string;
    age: string;
    occupation: string;
    story_role: string;
    narrative_importance: string;
    development_depth: string;
    arc_type: string;
    canon_status: "Signed Off";
  };
  story_function: {
    narrative_purpose: string;
    protagonist_relationship: string;
    conflict_contribution: string;
    thematic_thesis: string;
  };
  psychological_engine: {
    want: string;
    personality_how: string;
    need: string;
    values: string;
    life_experience: string;
    core_wound: string;
    false_belief: string;
    core_flaw: string;
    dominant_fear: string;
    defense_mechanisms: string;
    behavioral_trajectory: string;
  };
  behavior_voice_profile: {
    physical_description: string;
    habits: string;
    voice_signature: string;
    behavior_under_stress: string;
  };
  ensemble_interconnection_registry: {
    with: string;
    dynamic: string;
    trust_trajectory: string;
    power_dynamic: string;
  }[];
  milestone_arc_timeline: {
    initial_worldview: string;
    inciting_disruption: string;
    failed_resistance: string;
    midpoint_realization: string;
    crisis_choice: string;
    action_proven_transformation: string;
    new_identity: string;
  };
  continuity_canon_rules: string;
  outstanding_questions: { item: string; defer_to: string | null; notes: string }[];
  signed_off_at: string;
}

function characterBibleEntriesCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("characterBibleEntries");
}

/** Persists a character's compiled Character Bible entry exactly once
 * (issue #34, AC: "prior characters' entries are never overwritten").
 * Uses a read-then-write check rather than a create()-and-catch pattern -
 * matches the established isAlreadyConfirmed-style convention already
 * proven in issues #28/#30/#31, and avoids relying on an unverified
 * Firestore error-code shape for "already exists". */
export async function appendCharacterBibleEntry(
  storyId: string,
  entry: CharacterBibleEntry
): Promise<{ ok: true } | { ok: false; alreadyExists: true }> {
  const ref = characterBibleEntriesCollection(storyId).doc(entry.charId);
  const existing = await ref.get();
  if (existing.exists) {
    return { ok: false, alreadyExists: true };
  }
  await ref.set(entry);
  return { ok: true };
}

export async function listCharacterBibleEntries(storyId: string): Promise<CharacterBibleEntry[]> {
  const snap = await characterBibleEntriesCollection(storyId).get();
  return snap.docs.map((d) => d.data() as CharacterBibleEntry);
}

/**
 * Project 3's Stage 5 Compile output (issue #50) - the 15-section World
 * Bible schema (sp03-wdc-systemprompt.md §8). Sections 2/3/4/5-11/12 are
 * LLM-synthesized prose grounded in Confirmed World Entries (see
 * worldEngine/worldBibleCompiler.ts's runWorldBibleSynthesis); sections
 * 1/13/14/15 are pure template-fill, same posture as FoundationDocument's
 * (foundationDoc.ts, issue #18) "no fabrication" guarantee for those parts.
 * Numbered keys mirror FoundationDocument's own convention.
 */
export interface WorldBibleDocument {
  schema_version: string;
  "1_document_metadata": {
    story_id: string;
    world_bible_version: string; // "v{n}", matches FoundationDocument's own version string format
    working_title: string;
    date: string;
    status: "Compiled";
    related_project_1_version: string;
    related_project_2_status: string;
  };
  "2_world_overview_complexity_summary": string;
  "3_world_assumptions_canon_rules": string;
  "4_master_world_pillars": { pillar: string; summary: string }[];
  "5_geography_settings_registry": string;
  "6_societal_infrastructure_manual": string;
  "7_cultural_lived_experience_profiles": string;
  "8_narrative_lore_history": string;
  "9_system_mechanics": string;
  "10_significant_institutions_artifacts": string;
  "11_linguistic_communication_profile": string;
  "12_interconnection_map_systems_synthesis": string;
  "13_outstanding_world_questions": { defer_to: string; items: { item: string; notes: string }[] }[];
  "14_cross_project_reference_log": {
    project_1: { working_title: string; version: string } | null;
    project_2: { character_name: string; story_role: string; canon_status: string }[];
  };
  "15_version_history": { version: string; date: string; summary_of_changes: string }[];
}

export interface StoredWorldBibleVersion {
  version: number;
  date: string;
  summary_of_changes: string;
  json: WorldBibleDocument;
  markdown: string;
  /** Confirmed World Entries snapshot at generation time (element_id -> status/value), used to diff the next version - same shape/purpose as FoundationDocument's own elementsSnapshot. */
  elementsSnapshot: Record<string, { status: string; value: unknown }>;
  /** Issue #51 - true only once the structure-lint has passed and the
   * author has explicitly confirmed this specific version. Never set
   * automatically, never reversible in this issue's scope - a later,
   * better World Bible gets a new compiled version instead (versions are
   * otherwise immutable once written, issue #50 Decision 5). */
  confirmed: boolean;
  confirmedAt: string | null;
}

function worldBibleVersionsCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("worldBibleVersions");
}

export async function listWorldBibleVersions(
  storyId: string
): Promise<Pick<StoredWorldBibleVersion, "version" | "date" | "summary_of_changes">[]> {
  const snap = await worldBibleVersionsCollection(storyId).orderBy("version", "asc").get();
  return snap.docs.map((d) => {
    const v = d.data() as StoredWorldBibleVersion;
    return { version: v.version, date: v.date, summary_of_changes: v.summary_of_changes };
  });
}

export async function getWorldBibleVersion(
  storyId: string,
  version: number
): Promise<StoredWorldBibleVersion | null> {
  const snap = await worldBibleVersionsCollection(storyId).doc(String(version)).get();
  return snap.exists ? (snap.data() as StoredWorldBibleVersion) : null;
}

export async function getLatestWorldBibleVersion(storyId: string): Promise<StoredWorldBibleVersion | null> {
  const snap = await worldBibleVersionsCollection(storyId).orderBy("version", "desc").limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as StoredWorldBibleVersion);
}

/** Persists a new World Bible version. Never overwrites a prior version - `stored.version` must already be `(latest?.version ?? 0) + 1`, computed by the caller (worldEngine/worldBibleCompiler.ts's generateWorldBibleDocument), same division of responsibility as FoundationDocument's own generateFoundationDocument/versionsCollection split. */
export async function saveWorldBibleVersion(storyId: string, stored: StoredWorldBibleVersion): Promise<void> {
  await worldBibleVersionsCollection(storyId).doc(String(stored.version)).set(stored);
}

/** Marks a specific World Bible version Confirmed (issue #51) - the
 * caller (the new confirm route) is responsible for running the
 * structure-lint first and only calling this on a pass. Idempotent: a
 * second confirm on an already-confirmed version simply re-sets
 * confirmedAt rather than being rejected - simplest option, no new state
 * to guard against, per the design doc's Testing section. */
export async function confirmWorldBibleVersion(
  storyId: string,
  version: number
): Promise<StoredWorldBibleVersion> {
  const ref = worldBibleVersionsCollection(storyId).doc(String(version));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`World Bible version ${version} not found for story "${storyId}".`);
  }
  const stored = snap.data() as StoredWorldBibleVersion;
  const updated: StoredWorldBibleVersion = {
    ...stored,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
  };
  await ref.set(updated);
  return updated;
}

/** Appends an author-type re-assessment (issue #8 calls this) without clobbering prior history. */
export async function appendAuthorTypeAssessment(
  storyId: string,
  assessment: AuthorTypeAssessment
): Promise<void> {
  const db = getDb();
  const ref = storiesCollection().doc(storyId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const story = snap.data() as Story | undefined;
    const history = story?.authorTypeHistory ?? [];
    tx.update(ref, {
      authorTypeHistory: [...history, assessment],
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function appendMessage(
  storyId: string,
  message: Omit<StoryMessage, "id">,
  collection: string = "messages"
): Promise<StoryMessage> {
  const ref = messagesCollection(storyId, collection).doc();
  const full: StoryMessage = { id: ref.id, ...message };
  await ref.set(full);
  await touchStory(storyId);
  return full;
}

/** All messages, oldest first. Pass `limit` to get only the most recent N.
 * Pass `collection` (issue #26/#27) to target a project-specific message
 * subcollection instead of Project 1's default "messages". */
export async function listMessages(
  storyId: string,
  limit?: number,
  collection: string = "messages"
): Promise<StoryMessage[]> {
  const snap = await messagesCollection(storyId, collection).orderBy("ts", "asc").get();
  const all = snap.docs.map((d) => d.data() as StoryMessage);
  if (limit && all.length > limit) {
    return all.slice(all.length - limit);
  }
  return all;
}

export interface ResumedStory {
  story: Story;
  elements: CanonElement[];
  recentMessages: StoryMessage[];
}

const DEFAULT_RESUME_MESSAGE_LIMIT = 10;

/**
 * Restores full canon state (every element, no data loss - satisfies the
 * "Resume reliability" success metric) plus a bounded recent-message window,
 * not the full transcript - issue #13 owns the compact state-summary
 * mechanism for grounding the model on resume; this just caps what would
 * otherwise be an unbounded replay.
 */
export async function resumeStory(
  storyId: string,
  ownerUid: string,
  messageLimit = DEFAULT_RESUME_MESSAGE_LIMIT
): Promise<ResumedStory> {
  const story = await assertOwnership(storyId, ownerUid);
  const [elements, recentMessages] = await Promise.all([
    listElements(storyId),
    listMessages(storyId, messageLimit),
  ]);
  return { story, elements, recentMessages };
}
