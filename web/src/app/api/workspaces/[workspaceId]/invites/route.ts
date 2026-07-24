import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { createInvite, listInvites } from "@/lib/workspace/workspaceStore";
import type { MemberRole } from "@/lib/workspace/types";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]/invites">) {
  try {
    await requireUser();
    const { workspaceId } = await ctx.params;
    const invites = await listInvites(workspaceId);
    return NextResponse.json({ invites });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Admin-only (enforced in workspaceStore.createInvite) and tier-gated - Free tier rejects this outright. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]/invites">) {
  try {
    const user = await requireUser();
    const { workspaceId } = await ctx.params;
    const body = await req.json().catch(() => null);
    const email = body?.email;
    const role: MemberRole = body?.role ?? "Member";

    if (typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Request must include a valid `email`." }, { status: 400 });
    }

    const invite = await createInvite(workspaceId, user.uid, email, role);
    return NextResponse.json({ invite }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
