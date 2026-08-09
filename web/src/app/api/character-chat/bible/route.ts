import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listCharacterBibleEntries } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Read-only export of Project 2's compiled Character Bible entries -
 * GitHub issue #35. Returns the raw CharacterBibleEntry[] as JSON; both
 * Markdown and .docx rendering happen client-side from this same payload
 * (characterBibleMarkdown.ts / characterBibleDocx.ts), so the two export
 * formats can never disagree on content. Mirrors character-chat/route.ts's
 * auth pattern exactly (requireUser -> getStory -> getMembership).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
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

    const entries = await listCharacterBibleEntries(storyId);
    return NextResponse.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}
