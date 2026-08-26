import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP3Pillars, normalizeP3, type P3State } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Adopts or edits Project 3's working Pillar list - GitHub issue #40. A
 * discrete, non-conversational state mutation (no model call), the same
 * shape as the sibling wcl/route.ts PATCH. Always replaces the whole
 * array: the author's list editor is the single owner of this field, so
 * there's no concurrent-multi-writer case to design around, unlike the
 * proposed/confirmed WCL split.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const pillarsInput: unknown = body?.pillars;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (
      !Array.isArray(pillarsInput) ||
      pillarsInput.some((p) => typeof p !== "string" || !p.trim())
    ) {
      return NextResponse.json(
        { error: "`pillars` must be an array of non-empty strings." },
        { status: 400 }
      );
    }
    const pillars = pillarsInput.map((p) => (p as string).trim());

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const nextP3: P3State = { ...normalizeP3(story.p3), pillars };
    // Dotted-field-path update (same disjointness pattern as
    // setP3ConfirmedLevel) - only `pillars` is ever written here, so
    // this can never clobber `proposedPillars` written concurrently by
    // a turn's own setP3ProposedPillars call.
    await setP3Pillars(storyId, pillars);

    return NextResponse.json({ p3: nextP3 });
  } catch (err) {
    return errorResponse(err);
  }
}
