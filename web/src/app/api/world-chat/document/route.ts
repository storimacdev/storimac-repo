import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listWorldBibleVersions } from "@/lib/canonEngine/storyStore";
import { generateWorldBibleDocument } from "@/lib/worldEngine/worldBibleCompiler";
import { TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";

export const runtime = "nodejs";

/** Lists World Bible versions for a story (issue #50 - prior versions stay retrievable, same guarantee as issue #19's P1 equivalent). */
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
    const versions = await listWorldBibleVersions(storyId);
    return NextResponse.json({ versions });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Compiles the next World Bible version (issue #50). Gated on the Stage 4 System Integration Audit's explicit approval (issue #49) - the real precondition for Stage 5, not a raw stage-number check (Project 3 tracks its own stage per-message, not on Story.currentStage). */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
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
    if (!story.p3Stage4Audit?.authorApproved) {
      return NextResponse.json(
        { error: "The World Bible compiles after you approve the Stage 4 System Integration Audit summary." },
        { status: 409 }
      );
    }

    const version = await generateWorldBibleDocument(storyId);
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
    if (err instanceof RateLimitTimeoutError) {
      console.warn("Anthropic rate-limit gate timed out:", err);
      return NextResponse.json(
        { error: "StoriMac is handling a lot of requests right now — please try again in a moment." },
        { status: 503 }
      );
    }
    if (err instanceof TurnValidationError) {
      console.error("World Bible compile extraction failed:", err);
      return NextResponse.json(
        { error: "The World Bible compile couldn't produce a valid result. Please try again." },
        { status: 502 }
      );
    }
    return errorResponse(err);
  }
}
