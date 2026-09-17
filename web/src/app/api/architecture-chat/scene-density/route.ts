import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP4SceneDensityDismissal } from "@/lib/canonEngine/storyStore";
import {
  computeSceneDensity,
  applySceneDensityDismissal,
  DEFAULT_SCENE_DENSITY_DISMISSAL,
} from "@/lib/storyArchitectureEngine/sceneDensity";

export const runtime = "nodejs";

/**
 * Dismisses one direction of Project 4's Scene Density & Pacing Monitor
 * alert (issue #56) - an explicit author button-click, not a chat turn,
 * same shape as the sibling world-chat/canon-status/route.ts PATCH.
 * Only ever SETS a direction to `true`; architecture-chat/route.ts's
 * own nextSceneDensityDismissal is the only thing that ever clears one,
 * once that direction's condition is no longer true.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const direction: unknown = body?.direction;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (direction !== "under" && direction !== "over") {
      return NextResponse.json({ error: '`direction` must be "under" or "over".' }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const dismissalBefore = story.p4SceneDensityDismissal ?? DEFAULT_SCENE_DENSITY_DISMISSAL;
    const dismissal = { ...dismissalBefore, [direction]: true };
    await setP4SceneDensityDismissal(storyId, dismissal);

    const reading = computeSceneDensity(story.p4Units ?? []);
    return NextResponse.json({ sceneDensity: applySceneDensityDismissal(reading, dismissal) });
  } catch (err) {
    return errorResponse(err);
  }
}
