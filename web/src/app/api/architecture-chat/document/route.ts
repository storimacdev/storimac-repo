import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
import { compileScreenplayArchitectureDocument } from "@/lib/storyArchitectureEngine/compileArchitectureDocument";

export const runtime = "nodejs";

/** Compiles the current Screenplay Architecture Document on demand (issue #111, Decision 3) - no versioning/storage yet, matching compileArchitectureDocument.ts's own current on-demand, non-persisted shape. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    if (typeof storyId !== "string" || !storyId) {
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

    const canon = await ingestCanon(storyId);
    const compiled = compileScreenplayArchitectureDocument(storyId, canon, story.p4Units ?? []);
    return NextResponse.json(compiled);
  } catch (err) {
    return errorResponse(err);
  }
}
