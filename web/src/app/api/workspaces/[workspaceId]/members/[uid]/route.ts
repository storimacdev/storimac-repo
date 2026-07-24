import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { setMemberRole } from "@/lib/workspace/workspaceStore";
import type { MemberRole } from "@/lib/workspace/types";

export const runtime = "nodejs";

/** "Admin can promote/demote users" - Admin-only, protects the last remaining Admin (enforced in workspaceStore). */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/members/[uid]">
) {
  try {
    const user = await requireUser();
    const { workspaceId, uid: targetUid } = await ctx.params;
    const body = await req.json().catch(() => null);
    const role: MemberRole | undefined = body?.role;

    if (!role || !["Admin", "Member", "Viewer"].includes(role)) {
      return NextResponse.json({ error: "Request must include a valid `role`." }, { status: 400 });
    }

    const membership = await setMemberRole(workspaceId, user.uid, targetUid, role);
    return NextResponse.json({ membership });
  } catch (err) {
    return errorResponse(err);
  }
}
