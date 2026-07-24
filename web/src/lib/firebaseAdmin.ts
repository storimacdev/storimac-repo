import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";

/**
 * Firebase Admin SDK bootstrap — server-side only (API routes), never import
 * from a client component.
 *
 * On Cloud Run / Firebase App Hosting, the backend's attached service
 * account provides Application Default Credentials automatically — no key
 * file needed. For local dev, either run against the Firebase Local
 * Emulator Suite (`firebase emulators:start`, no credentials needed), or set
 * GOOGLE_APPLICATION_CREDENTIALS_JSON to a service-account key's JSON
 * contents in .env.local.
 */
function getAdminApp(): App {
  const existing = getApps();
  if (existing.length > 0) {
    return existing[0];
  }

  const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  // Build options conditionally rather than passing `credential: undefined` /
  // `storageBucket: undefined` explicitly - the Admin SDK validates on key
  // *presence*, not truthiness, so an explicit undefined value throws
  // "Invalid Firebase app options" instead of falling back to Application
  // Default Credentials the way omitting the key entirely does.
  return initializeApp({
    ...(serviceAccountJson ? { credential: cert(JSON.parse(serviceAccountJson)) } : {}),
    ...(process.env.FIREBASE_STORAGE_BUCKET
      ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET }
      : {}),
  });
}

export function getDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function getBucket(): Storage {
  return getStorage(getAdminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}
