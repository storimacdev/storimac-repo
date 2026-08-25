import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP3State, type P3State } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Confirms or changes Project 3's World Complexity Level - GitHub issue
 * #39. A discrete, non-conversational state mutation (no model call),
 * mirroring the existing canvases/[canvasId]/route.ts rename PATCH's
 * shape. The "warning on change" requirement is enforced client-side
 * (WorldInterview.tsx shows a confirm dialog before calling this when a
 * value is already set) - this route just writes what it's told.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const level: unknown = body?.level;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (level !== 1 && level !== 2 && level !== 3 && level !== 4) {
      return NextResponse.json({ error: "`level` must be 1, 2, 3, or 4." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const currentP3: P3State = story.p3 ?? { proposedWorldComplexityLevel: null, worldComplexityLevel: null };
    const nextP3: P3State = { ...currentP3, worldComplexityLevel: level };
    await setP3State(storyId, nextP3);

    return NextResponse.json({ p3: nextP3 });
  } catch (err) {
    return errorResponse(err);
  }
}
