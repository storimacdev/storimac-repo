import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import {
  getStory,
  listMessages,
  renameStory,
  deleteStory,
  listGuardrailFlags,
  normalizeP3,
  CHARACTER_MESSAGES_COLLECTION,
  WORLD_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
import { listElements, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { setLastVisited } from "@/lib/userStore";

export const runtime = "nodejs";

/**
 * Resume a Story Canvas — issue #89. Any workspace member can load it (not
 * just the creator), matching the sibling canvases collection route's
 * membership-based access rather than storyStore's own ownerUid-only checks
 * (which predate real auth/workspaces and are too strict for a shared Premium canvas).
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;
    // Project 1's resume never reads this field - only fetch/include it
    // when the Character Bible client explicitly asks, so P1's canvas load
    // doesn't pay for an unused Firestore read and a larger payload.
    const includeCharacterMessages = req.nextUrl.searchParams.get("characterMessages") === "1";
    // Same reasoning, for the World Bible client (issue #38).
    const includeWorldMessages = req.nextUrl.searchParams.get("worldMessages") === "1";
    // Same reasoning, for the World Bible client's per-pillar canon status (issue #41).
    const includeWorldElements = req.nextUrl.searchParams.get("worldElements") === "1";

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    const [elements, messages, characterMessages, worldMessages, worldElements, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldMessages ? listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldElements ? listElements(canvasId, WORLD_ELEMENTS_COLLECTION) : Promise.resolve([]),
      listGuardrailFlags(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

    return NextResponse.json({
      story: { ...story, p3: normalizeP3(story.p3) },
      elements,
      messages,
      characterMessages,
      worldMessages,
      worldElements,
      guardrailFlags,
    });
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
