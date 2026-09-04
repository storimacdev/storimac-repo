import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP1Locked } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Explicit unlock of a locked Story Foundation (Project 1) - the only way
 * p1Locked ever goes back to false. Generating a document is what sets it
 * true (see document/route.ts's POST handler). Any workspace member may
 * unlock, matching this route family's existing all-members-can-edit
 * authorization model - no new permission tier.
 */
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]/unlock">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    await setP1Locked(canvasId, false);
    return NextResponse.json({ locked: false });
  } catch (err) {
    return errorResponse(err);
  }
}
