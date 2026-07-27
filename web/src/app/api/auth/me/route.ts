import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getUserProfile, ensureUserProfile } from "@/lib/userStore";
import { listWorkspacesForUser } from "@/lib/workspace/workspaceStore";

export const runtime = "nodejs";

/**
 * The client's single source of user state — issue #90. Returns the signed-in
 * user, their workspaces, and the last-visited workspace/canvas so every page
 * can route returning users correctly instead of re-onboarding them.
 * 401 for guests (UserProvider treats that as "guest", not an error).
 */
export async function GET() {
  try {
    const user = await requireUser();
    let profile = await getUserProfile(user.uid);
    if (!profile) {
      // Sessions minted before issue #90 shipped have no profile doc yet.
      profile = await ensureUserProfile({ uid: user.uid, email: user.email });
    }
    const workspaces = await listWorkspacesForUser(user.uid);
    return NextResponse.json({
      user: { uid: user.uid, email: user.email },
      workspaces,
      lastWorkspaceId: profile.lastWorkspaceId,
      lastCanvasId: profile.lastCanvasId,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
