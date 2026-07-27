"use client";

import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebaseClient";

/**
 * Shared sign-in logic — GitHub issue #90. Used by both OnboardingFlow and
 * the /login page so the two auth surfaces can never drift. Every success
 * path establishes the HttpOnly session cookie (with terms acceptance —
 * both surfaces display the Terms/Privacy links beside the controls).
 */

async function establishSession(idToken: string): Promise<void> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, acceptedTerms: true }),
  });
  if (!res.ok) throw new Error("Could not start your session. Please try again.");
}

export type AuthResult = { email: string };

export function useAuth() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle(): Promise<AuthResult | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await establishSession(await result.user.getIdToken());
      return { email: result.user.email ?? "" };
    } catch {
      setError("Google sign-in failed. Please try again or use email instead.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Creates the account if it doesn't exist yet, signs in if it does. */
  async function signInWithEmail(email: string, password: string): Promise<AuthResult | null> {
    if (!password) {
      setError("Enter a password to continue with email.");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      let credential;
      try {
        credential = await createUserWithEmailAndPassword(auth, email, password);
      } catch (err) {
        if (err instanceof Error && "code" in err && err.code === "auth/email-already-in-use") {
          credential = await signInWithEmailAndPassword(auth, email, password);
        } else {
          throw err;
        }
      }
      await establishSession(await credential.user.getIdToken());
      return { email: credential.user.email ?? email };
    } catch {
      setError("Sign-in failed. Check your email and password.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, setError, signInWithGoogle, signInWithEmail };
}
