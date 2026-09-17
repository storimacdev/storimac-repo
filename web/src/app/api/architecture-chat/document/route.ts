import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
import { compileScreenplayArchitectureDocument } from "@/lib/storyArchitectureEngine/compileArchitectureDocument";
import { runThematicAnchorAudit, type ThematicAnchorAuditResult } from "@/lib/storyArchitectureEngine/thematicAnchorAudit";
import { runPreCompilationAudit } from "@/lib/storyArchitectureEngine/preCompilationAudit";

export const runtime = "nodejs";

/** Compiles the current Screenplay Architecture Document on demand
 * (issue #111, Decision 3), gated by the Thematic Anchor Audit
 * (issue #65) - a synchronous confirm-then-retry gate, mirroring
 * world-chat/canon-status/route.ts's own Dependency Review
 * precedent (issue #48): a gap-found result blocks the FIRST call
 * with a 409 unless the caller passes `acknowledged: true`, at
 * which point compilation proceeds anyway (disclosure, not
 * prevention - matching the issue's own "surface it explicitly...
 * rather than silently compiling around it" wording, not a hard
 * block). No versioning/storage of either the audit or the document
 * itself yet, matching compileArchitectureDocument.ts's own current
 * on-demand, non-persisted shape. */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Server is not configured with an Anthropic API key." }, { status: 500 });
    }
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const acknowledged = body?.acknowledged === true;
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

    const units = story.p4Units ?? [];
    // Issue #91: fully deterministic, computed unconditionally on
    // every call (including the acknowledged retry) - unlike
    // thematicAnchorAudit's model call, there's no cost concern and
    // no risk of a nondeterministic contradiction, so recomputing it
    // fresh always reflects the story's real current state.
    const preCompilationAudit = runPreCompilationAudit(units);
    let thematicAnchorAudit: ThematicAnchorAuditResult;
    if (acknowledged) {
      // Final whole-branch review finding I2: re-running the audit here
      // (including its model consistency call) would spend a second,
      // independent, nondeterministic model call and could contradict
      // the very finding the author just acknowledged - e.g. returning
      // a clean pass immediately after "Compile anyway," or a different
      // complaint than the one they actually saw. The author has
      // already made their choice; nothing further needs checking on
      // this request.
      thematicAnchorAudit = {
        findings: [
          {
            id: "acknowledged-by-author",
            status: "flag",
            detail: "Compiled despite an earlier Thematic Anchor Audit gap - the author chose to proceed anyway.",
          },
        ],
        gapFound: true,
        generatedAt: new Date().toISOString(),
      };
    } else {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      try {
        thematicAnchorAudit = await runThematicAnchorAudit(anthropic, units);
      } catch (auditErr) {
        console.warn(`[architecture-chat/document] Thematic Anchor Audit failed for story ${storyId}:`, auditErr);
        thematicAnchorAudit = {
          findings: [
            {
              id: "consistency-unavailable",
              status: "flag",
              detail: "The Thematic Anchor Audit's consistency check couldn't complete - please try again before compiling.",
            },
          ],
          gapFound: true,
          generatedAt: new Date().toISOString(),
        };
      }
    }

    const gapFound = thematicAnchorAudit.gapFound || preCompilationAudit.failed;
    if (gapFound && !acknowledged) {
      return NextResponse.json({ needsAcknowledgment: true, thematicAnchorAudit, preCompilationAudit }, { status: 409 });
    }

    const canon = await ingestCanon(storyId);
    const compiled = compileScreenplayArchitectureDocument(storyId, canon, units);
    return NextResponse.json({ ...compiled, thematicAnchorAudit, preCompilationAudit });
  } catch (err) {
    return errorResponse(err);
  }
}
