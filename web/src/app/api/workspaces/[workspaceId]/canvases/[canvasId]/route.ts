import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listMessages } from "@/lib/canonEngine/storyStore";
import { listElements } from "@/lib/canonEngine/canonStore";
import { setLastVisited } from "@/lib/userStore";

export const runtime = "nodejs";

/**
 * Resume a Story Canvas — issue #89. Any workspace member can load it (not
 * just the creator), matching the sibling canvases collection route's
 * membership-based access rather than storyStore's own ownerUid-only checks
 * (which predate real auth/workspaces and are too strict for a shared Premium canvas).
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]">
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

    const [elements, messages] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

    return NextResponse.json({ story, elements, messages });
  } catch (err) {
    return errorResponse(err);
  }
}
