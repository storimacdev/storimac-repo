import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, getWorldBibleVersion } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/** Fetches one prior World Bible version in full (issue #50, same guarantee as issue #19's P1 equivalent - prior versions remain downloadable). */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/world-chat/document/[version]">
) {
  try {
    const user = await requireUser();
    const { version: versionParam } = await ctx.params;
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "Invalid version number." }, { status: 400 });
    }
    const storyId = req.nextUrl.searchParams.get("storyId");
    if (!storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    const stored = await getWorldBibleVersion(storyId, version);
    if (!stored) {
      return NextResponse.json({ error: `World Bible version ${version} not found.` }, { status: 404 });
    }
    return NextResponse.json({
      version: stored.version,
      date: stored.date,
      summary_of_changes: stored.summary_of_changes,
      markdown: stored.markdown,
      json: stored.json,
      confirmed: stored.confirmed,
      confirmedAt: stored.confirmedAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
