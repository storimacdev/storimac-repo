import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { getDocumentVersion } from "@/lib/canonEngine/foundationDoc";

export const runtime = "nodejs";

/** Fetch one stored document version — prior versions remain downloadable (issue #19). */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]/document/[version]">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId, version } = await ctx.params;

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }
    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    const n = Number.parseInt(version, 10);
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json({ error: "Invalid version number." }, { status: 400 });
    }
    const doc = await getDocumentVersion(canvasId, n);
    if (!doc) {
      return NextResponse.json({ error: `Version ${n} not found.` }, { status: 404 });
    }
    return NextResponse.json({
      version: doc.version,
      date: doc.date,
      summary_of_changes: doc.summary_of_changes,
      markdown: doc.markdown,
      json: doc.json,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
