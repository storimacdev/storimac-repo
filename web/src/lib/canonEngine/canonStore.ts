import { getDb } from "@/lib/firebaseAdmin";
import { isValidTransition } from "./transitions";
import type { CanonElement, CanonElementPatch, CanonStatus } from "./types";

/**
 * Transactional Canon State store — GitHub issue #6, reference implementation
 * of the shared Canon Engine's CanonElement state machine (ARCHITECTURE.md §2).
 * Firestore-backed per ARCHITECTURE.md §6: /stories/{storyId}/elements/{elementId}.
 */

export class CanonConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonConflictError";
  }
}

/** Project 2's per-character fact subcollection name (issue #29) - a
 * sibling to Project 1's default "elements" collection, sharing the same
 * transactional store/status-transition logic via the `collection`
 * parameter added to every function below. */
export const CHARACTER_FACTS_COLLECTION = "characterFacts";

/** Project 3's canon-element subcollection name (issue #41) - a sibling
 * to CHARACTER_FACTS_COLLECTION, sharing the same store/transition logic
 * via the existing `collection` parameter on every function below. */
export const WORLD_ELEMENTS_COLLECTION = "worldElements";

function elementsCollection(storyId: string, collection: string = "elements") {
  return getDb().collection("stories").doc(storyId).collection(collection);
}

export async function getElement(
  storyId: string,
  elementId: string,
  collection: string = "elements"
): Promise<CanonElement | null> {
  const snap = await elementsCollection(storyId, collection).doc(elementId).get();
  return snap.exists ? (snap.data() as CanonElement) : null;
}

export async function listElements(storyId: string, collection: string = "elements"): Promise<CanonElement[]> {
  const snap = await elementsCollection(storyId, collection).get();
  return snap.docs.map((d) => d.data() as CanonElement);
}

/**
 * Elements whose depends_on includes elementId — the reverse-dependency
 * lookup Project 3's Dependency Review and Project 4's Relational Impact
 * Check need. array-contains query per ARCHITECTURE.md §6.
 */
export async function listDependents(
  storyId: string,
  elementId: string
): Promise<CanonElement[]> {
  const snap = await elementsCollection(storyId)
    .where("depends_on", "array-contains", elementId)
    .get();
  return snap.docs.map((d) => d.data() as CanonElement);
}

export type ElementUpdate = {
  element_id: string;
  patch: CanonElementPatch;
  /** Set only by the Conflict Resolution flow (issue #10) after the author picks a resolution. */
  allowConfirmedOverride?: boolean;
};

/**
 * Applies one or more element updates atomically in a single Firestore
 * transaction, so a turn producing multiple element changes (a structured
 * state delta, issue #9) can't leave partial state on a crash — issue #6 AC:
 * "no partial writes across multiple elements in one turn."
 *
 * Throws CanonConflictError, writing nothing, if any update would change a
 * Confirmed element's status or value without allowConfirmedOverride.
 * Throws a plain Error, writing nothing, on an invalid status transition.
 */
export async function applyStateDelta(
  storyId: string,
  updates: ElementUpdate[],
  turnId: string,
  collection: string = "elements"
): Promise<CanonElement[]> {
  if (updates.length === 0) return [];

  const db = getDb();
  const elementsRef = elementsCollection(storyId, collection);

  return db.runTransaction(async (tx) => {
    const refs = updates.map((u) => elementsRef.doc(u.element_id));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));

    const results: CanonElement[] = [];
    const now = new Date().toISOString();

    updates.forEach((update, i) => {
      const snap = snaps[i];
      const existing = snap.exists ? (snap.data() as CanonElement) : null;
      const currentStatus: CanonStatus = existing?.status ?? "Exploring";
      const nextStatus = update.patch.status ?? currentStatus;

      const nextValue =
        update.patch.value !== undefined ? update.patch.value : existing?.value ?? null;
      const changingValue = existing !== null && JSON.stringify(nextValue) !== JSON.stringify(existing.value);
      const changingStatus = nextStatus !== currentStatus;

      if (
        existing &&
        currentStatus === "Confirmed" &&
        (changingValue || changingStatus) &&
        !update.allowConfirmedOverride
      ) {
        throw new CanonConflictError(
          `Element "${update.element_id}" is Confirmed; changing it requires the Conflict Resolution flow.`
        );
      }

      if (!isValidTransition(currentStatus, nextStatus)) {
        throw new Error(
          `Invalid canon status transition for "${update.element_id}": ${currentStatus} -> ${nextStatus}`
        );
      }

      const historyEntry = {
        status: nextStatus,
        value: nextValue,
        ts: now,
        turn_id: turnId,
      };

      const next: CanonElement = {
        project_id: storyId,
        element_id: update.element_id,
        stage: update.patch.stage ?? existing?.stage ?? 0,
        status: nextStatus,
        depth_mode: update.patch.depth_mode ?? existing?.depth_mode ?? "Refine",
        value: nextValue,
        rationale: update.patch.rationale ?? existing?.rationale ?? "",
        depends_on: update.patch.depends_on ?? existing?.depends_on ?? [],
        retrieval_code: update.patch.retrieval_code ?? existing?.retrieval_code ?? null,
        history: [...(existing?.history ?? []), historyEntry],
      };

      tx.set(refs[i], next);
      results.push(next);
    });

    return results;
  });
}

/** Convenience wrapper for updating a single element. */
export async function upsertElement(
  storyId: string,
  elementId: string,
  patch: CanonElementPatch,
  turnId: string,
  allowConfirmedOverride = false,
  collection: string = "elements"
): Promise<CanonElement> {
  const [result] = await applyStateDelta(
    storyId,
    [{ element_id: elementId, patch, allowConfirmedOverride }],
    turnId,
    collection
  );
  return result;
}
