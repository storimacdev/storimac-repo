import { getDb } from "@/lib/firebaseAdmin";

/**
 * User profile store — GitHub issue #90. One doc per Firebase Auth user at
 * /users/{uid}, created on first session. Tracks the user's last-visited
 * workspace/canvas so returning users route straight back to their work
 * instead of being re-onboarded (the issue's core bug), plus terms
 * acceptance. All access is server-side via the Admin SDK; firestore.rules
 * mirror owner-only access as defense in depth.
 */

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: string;
  updatedAt: string;
  lastWorkspaceId: string | null;
  lastCanvasId: string | null;
  acceptedTermsAt: string | null;
}

function usersCollection() {
  return getDb().collection("users");
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await usersCollection().doc(uid).get();
  return snap.exists ? (snap.data() as UserProfile) : null;
}

/**
 * Idempotent: creates the profile on first call (first session), refreshes
 * email/displayName/photoURL from the auth token on later calls without
 * touching lastWorkspaceId/lastCanvasId/acceptedTermsAt.
 */
export async function ensureUserProfile(params: {
  uid: string;
  email: string;
  displayName?: string | null;
  photoURL?: string | null;
}): Promise<UserProfile> {
  const ref = usersCollection().doc(params.uid);
  const now = new Date().toISOString();

  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      const profile: UserProfile = {
        uid: params.uid,
        email: params.email,
        displayName: params.displayName ?? null,
        photoURL: params.photoURL ?? null,
        createdAt: now,
        updatedAt: now,
        lastWorkspaceId: null,
        lastCanvasId: null,
        acceptedTermsAt: null,
      };
      tx.set(ref, profile);
      return profile;
    }
    const existing = snap.data() as UserProfile;
    const refreshed: UserProfile = {
      ...existing,
      email: params.email,
      displayName: params.displayName ?? existing.displayName,
      photoURL: params.photoURL ?? existing.photoURL,
      updatedAt: now,
    };
    tx.set(ref, refreshed);
    return refreshed;
  });
}

/** Called whenever a canvas is opened or created, so "/" and bare "/interview" can resume it. */
export async function setLastVisited(
  uid: string,
  lastWorkspaceId: string,
  lastCanvasId: string
): Promise<void> {
  await usersCollection().doc(uid).set(
    { lastWorkspaceId, lastCanvasId, updatedAt: new Date().toISOString() },
    { merge: true }
  );
}

/** Records terms acceptance once (first signup through onboarding/login); later calls are no-ops. */
export async function recordTermsAcceptance(uid: string): Promise<void> {
  const ref = usersCollection().doc(uid);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as UserProfile) : null;
    if (existing?.acceptedTermsAt) return;
    tx.set(ref, { acceptedTermsAt: new Date().toISOString() }, { merge: true });
  });
}
