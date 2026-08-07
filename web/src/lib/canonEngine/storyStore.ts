import { getDb } from "@/lib/firebaseAdmin";
import { listElements } from "./canonStore";
import type { CanonElement } from "./types";
import { getWorkspace, TierLimitError } from "@/lib/workspace/workspaceStore";
import { TIER_LIMITS } from "@/lib/workspace/types";

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
}

export interface StoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  turnId: string;
  context?: string;
  /** Project 2 only (issues #26/#27) — the character/stage this assistant
   * turn reported as current. Optional since Project 1 messages, and every
   * user-role message, never set these. */
  current_character?: string;
  current_stage?: number;
}

/** Project 2's message subcollection name (issues #26/#27) - exported so
 * every consumer references the same literal instead of duplicating the
 * string across files, which would let a typo silently split reads and
 * writes across two different subcollections with no compile error. */
export const CHARACTER_MESSAGES_COLLECTION = "characterMessages";

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

/** Stores Project 2's per-character lock/progress (issue #26) - whole-object replace, same convention as setStage7Audit. */
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2, updatedAt: new Date().toISOString() });
}

export interface StoredOutstandingQuestion {
  item: string;
  defer_to: "Project 2" | "Project 3" | "Project 4" | "Project 5" | null;
  notes: string;
  ts: string;
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
