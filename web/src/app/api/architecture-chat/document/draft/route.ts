import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { generatePartialScreenplayArchitectureDraft } from "@/lib/storyArchitectureEngine/screenplayArchitectureCompiler";
import { STRUCTURAL_ACTS, type ActId } from "@/lib/storyArchitectureEngine/structuralFramework";

export const runtime = "nodejs";

/**
 * Issue #71: compiles ONE named Act as a versioned DRAFT, never final
 * canon - a sibling of (not an overload of) the full compile route at
 * ../route.ts. Deliberately skips the Pre-Compilation Audit and the
 * Thematic Anchor Audit entirely - no 409/`acknowledged` gate exists
 * on this route. See
 * docs/superpowers/specs/2026-10-16-p4-partial-compile-design.md §5:
 * both audits exist to protect FINAL-canon integrity ("all 75-150
 * scenes," "all 10 Critical Beats tagged") - questions that aren't
 * well-formed for a single Act, which will almost always be short of
 * both by construction. Gating a draft on whole-document completeness
 * checks would make "compile a subset before it's done" (this issue's
 * entire point) impossible.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const actId: unknown = body?.actId;
    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof actId !== "string" || !STRUCTURAL_ACTS.some((a) => a.id === actId)) {
      return NextResponse.json(
        { error: `\`actId\` must be one of: ${STRUCTURAL_ACTS.map((a) => a.id).join(", ")}.` },
        { status: 400 }
      );
    }
    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const units = story.p4Units ?? [];
    const draft = await generatePartialScreenplayArchitectureDraft({ storyId, units, actId: actId as ActId });

    return NextResponse.json({
      draftId: draft.draftId,
      scopeKey: draft.scopeKey,
      scope: draft.scope,
      draftVersion: draft.draftVersion,
      date: draft.date,
      summary_of_changes: draft.summaryOfChanges,
      markdown: draft.markdown,
      json: draft.json,
      outstandingCount: draft.json["7_outstanding_decisions_version_history"].outstanding.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
