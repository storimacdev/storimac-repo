import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { generateFoundationDocument, listDocumentVersions } from "@/lib/canonEngine/foundationDoc";

export const runtime = "nodejs";

async function authorize(workspaceId: string, canvasId: string, uid: string) {
  const membership = await getMembership(workspaceId, uid);
  if (!membership) return { error: NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 }) };
  const story = await getStory(canvasId);
  if (!story || story.workspaceId !== workspaceId) {
    return { error: NextResponse.json({ error: "Story Canvas not found." }, { status: 404 }) };
  }
  return { story };
}

/** List document versions (issue #19 — priors stay retrievable). */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]/document">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;
    const auth = await authorize(workspaceId, canvasId, user.uid);
    if (auth.error) return auth.error;
    const versions = await listDocumentVersions(canvasId);
    return NextResponse.json({ versions });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Generate the next document version (issue #18). Requires Stage 8 — the Stage 7 gate has already been passed to get there. */
export async function POST(
  _req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]/document">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;
    const auth = await authorize(workspaceId, canvasId, user.uid);
    if (auth.error) return auth.error;

    if (auth.story.currentStage < 8) {
      return NextResponse.json(
        { error: "The Story Foundation Document is generated in Stage 8 — finish the interview (including the Stage 7 Creative Audit) first." },
        { status: 409 }
      );
    }

    const version = await generateFoundationDocument(canvasId);
    return NextResponse.json(
      {
        version: version.version,
        date: version.date,
        summary_of_changes: version.summary_of_changes,
        markdown: version.markdown,
        json: version.json,
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
