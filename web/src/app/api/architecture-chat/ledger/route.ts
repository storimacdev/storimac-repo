import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listP4ContinuityLedger } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Reads Project 4's Dependency & Continuity Ledger (issue #72) - the
 * AC's "queryable/viewable by the author, not just an internal log"
 * requirement. Read-only; the ledger is written exclusively from
 * architecture-chat/route.ts (ordinary Confirmed transitions) and
 * storyArchitectureEngine/canonRevision.ts's resolveP4Conflict (Canon
 * Revision decisions, plus any Confirmed transition they produce).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const storyId = req.nextUrl.searchParams.get("storyId");

    if (!storyId) {
      return NextResponse.json({ error: "Request must include a `storyId` query parameter." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const entries = await listP4ContinuityLedger(storyId);
    return NextResponse.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}
