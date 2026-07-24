import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { createWorkspace, listWorkspacesForUser } from "@/lib/workspace/workspaceStore";
import type { Tier, WorkspaceType } from "@/lib/workspace/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const workspaces = await listWorkspacesForUser(user.uid);
    return NextResponse.json({ workspaces });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const name = body?.name;
    const type: WorkspaceType = body?.type ?? "StoryWorkspace";
    const tier: Tier = body?.tier ?? "free";

    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `name`." }, { status: 400 });
    }

    const workspace = await createWorkspace(user.uid, user.email, name.trim(), type, tier);
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
