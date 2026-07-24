import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { revokeInvite } from "@/lib/workspace/workspaceStore";

export const runtime = "nodejs";

/** Admin-only (enforced in workspaceStore.revokeInvite). */
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/invites/[inviteId]">
) {
  try {
    const user = await requireUser();
    const { workspaceId, inviteId } = await ctx.params;
    await revokeInvite(workspaceId, user.uid, inviteId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
