import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, getWorldBibleVersion, confirmWorldBibleVersion, normalizeP3 } from "@/lib/canonEngine/storyStore";
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

    // Issue #131 - the structure-lint above only sees the document itself,
    // not the story's live adopted-pillar count, so it can't catch a
    // synthesis call that returned zero pillar entries despite pillars
    // having been adopted. Cross-check the two counts here as a semantic
    // (not purely structural) gate. Narrowly scoped to the exact failure
    // described in #131 (stored count is 0 while adopted pillars exist)
    // rather than any count mismatch, since the stored document is a
    // point-in-time snapshot (issue #50 Decision 5) and the author may have
    // legitimately adopted more pillars after this version was compiled.
    const adoptedPillarCount = normalizeP3(story.p3).pillars?.length ?? 0;
    const storedPillarCount = stored.json["4_master_world_pillars"].length;
    if (adoptedPillarCount > 0 && storedPillarCount === 0) {
      errors.push(
        `Master World Pillars: this version lists 0 pillars, but the story has ${adoptedPillarCount} adopted pillar(s). Recompile the World Bible before confirming.`
      );
    }

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
