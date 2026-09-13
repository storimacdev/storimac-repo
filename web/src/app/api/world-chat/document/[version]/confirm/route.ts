import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, getWorldBibleVersion, confirmWorldBibleVersion } from "@/lib/canonEngine/storyStore";
import { lintWorldBibleDocument, lintWorldBibleMarkdown } from "@/lib/worldEngine/worldBibleLint";

export const runtime = "nodejs";

/** Marks a compiled World Bible version Confirmed, gated on the structure-lint (issue #51, PRD §2.3). Never mutates on a lint failure. */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/world-chat/document/[version]/confirm">
) {
  try {
    const user = await requireUser();
    const { version: versionParam } = await ctx.params;
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "Invalid version number." }, { status: 400 });
    }
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

    const stored = await getWorldBibleVersion(storyId, version);
    if (!stored) {
      return NextResponse.json({ error: `World Bible version ${version} not found.` }, { status: 404 });
    }

    const jsonLint = lintWorldBibleDocument(stored.json);
    const markdownLint = lintWorldBibleMarkdown(stored.markdown);
    const errors = [...jsonLint.errors, ...markdownLint.errors];
    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 422 });
    }

    const updated = await confirmWorldBibleVersion(storyId, version);
    return NextResponse.json({
      version: updated.version,
      date: updated.date,
      summary_of_changes: updated.summary_of_changes,
      markdown: updated.markdown,
      json: updated.json,
      confirmed: updated.confirmed,
      confirmedAt: updated.confirmedAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
