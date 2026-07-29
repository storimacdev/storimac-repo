import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listMessages, renameStory, deleteStory } from "@/lib/canonEngine/storyStore";
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

/** Rename a Project — issue #22. Only the Story's owner may rename (renameStory's own check). */
export async function PATCH(
  req: NextRequest,
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

    const body = await req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const canvas = await renameStory(canvasId, user.uid, title);
    return NextResponse.json({ canvas });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Delete a Project and everything under it — issue #22. Only the Story's owner may delete (deleteStory's own check). */
export async function DELETE(
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

    await deleteStory(canvasId, user.uid);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
