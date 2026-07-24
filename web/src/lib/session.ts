import { cookies } from "next/headers";
import { getAdminAuth } from "@/lib/firebaseAdmin";

/**
 * Server-side session verification — issue #88. Reads the HttpOnly session
 * cookie set by /api/auth/session and verifies it via the Admin SDK.
 * `checkRevoked: true` so a revoked/logged-out session is rejected even if
 * the cookie itself hasn't expired yet.
 */

export const SESSION_COOKIE_NAME = "session";

export interface SessionUser {
  uid: string;
  email: string;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    return { uid: decoded.uid, email: decoded.email ?? "" };
  } catch {
    return null;
  }
}

export class UnauthenticatedError extends Error {
  constructor(message = "Not authenticated.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}
