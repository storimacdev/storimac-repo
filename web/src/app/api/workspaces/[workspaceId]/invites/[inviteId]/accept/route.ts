import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { acceptInvite } from "@/lib/workspace/workspaceStore";

export const runtime = "nodejs";

/** The invited user accepts using their own authenticated session - acceptInvite verifies the email matches. */
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/invites/[inviteId]/accept">
) {
  try {
    const user = await requireUser();
    const { workspaceId, inviteId } = await ctx.params;
    const membership = await acceptInvite(workspaceId, inviteId, user.uid, user.email);
    return NextResponse.json({ membership });
  } catch (err) {
    return errorResponse(err);
  }
}
