import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { deleteWorkspace, getMembership, getWorkspace, renameWorkspace } from "@/lib/workspace/workspaceStore";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]">) {
  try {
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    const workspace = await getWorkspace(workspaceId);
    return NextResponse.json({ workspace, membership });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]">) {
  try {
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const body = await req.json().catch(() => null);
    const name = body?.name;
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `name`." }, { status: 400 });
    }
    const workspace = await renameWorkspace(workspaceId, user.uid, name.trim());
    return NextResponse.json({ workspace });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]">) {
  try {
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    await deleteWorkspace(workspaceId, user.uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
