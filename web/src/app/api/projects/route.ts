import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { listWorkspacesForUser } from "@/lib/workspace/workspaceStore";
import { listStories } from "@/lib/canonEngine/storyStore";
import { getStageDefinition } from "@/lib/canonEngine/stageDefinitions";

export const runtime = "nodejs";

/**
 * Lists every Story ("Project") the caller owns, across every workspace
 * they belong to — issue #22's dashboard. `listStories` is already
 * ownerUid-scoped and sorted by updatedAt desc; workspace names are joined
 * in here purely for display.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const [workspaces, stories] = await Promise.all([
      listWorkspacesForUser(user.uid),
      listStories(user.uid),
    ]);
    const workspaceNames = new Map(workspaces.map((w) => [w.id, w.name]));

    const projects = stories.map((story) => ({
      id: story.id,
      workspaceId: story.workspaceId,
      workspaceName: workspaceNames.get(story.workspaceId) ?? "Unknown workspace",
      title: story.title,
      stageName: getStageDefinition(story.currentStage).name,
      currentStage: story.currentStage,
      updatedAt: story.updatedAt,
    }));

    return NextResponse.json({ projects });
  } catch (err) {
    return errorResponse(err);
  }
}
