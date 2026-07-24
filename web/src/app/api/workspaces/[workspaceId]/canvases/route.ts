import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { createStory, listStoriesInWorkspace } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases">) {
  try {
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    const canvases = await listStoriesInWorkspace(workspaceId);
    return NextResponse.json({ canvases });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases">) {
  try {
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Untitled Canvas";

    const canvas = await createStory(user.uid, workspaceId, title);
    return NextResponse.json({ canvas }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
