import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, appendMessage, listMessages, WORLD_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/worldEngine/ingestFoundation";
import { WorldTurnSchema, EMIT_WORLD_TURN_TOOL } from "@/lib/worldEngine/worldTurnSchema";

export const runtime = "nodejs";

// Bounds the replayed transcript so a long session can't grow the per-turn
// Anthropic call past the shared rate-limit gate's ITPM ceiling - same
// reasoning and same order of magnitude as character-chat/route.ts's own
// CHARACTER_MESSAGE_WINDOW.
const WORLD_MESSAGE_WINDOW = 20;

function listOrDash(items: unknown[]): string {
  if (!items.length) return "(not set)";
  return items.map((i) => (typeof i === "string" ? i : JSON.stringify(i))).join("; ");
}

/**
 * The live World Bible interview turn - GitHub issue #38, reference:
 * web/src/app/api/character-chat/route.ts (Project 2's own turn handler).
 * Deliberately minimal: no canon-state updates, no stage clamping, no
 * guardrails or conflict detection yet - those are Phase 1/3 issues
 * (#41, #46, #47) still to come. This issue only needs a working Stage 1
 * "Understand" conversation.
 */
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to web/.env.local and restart the dev server." },
      { status: 500 }
    );
  }

  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const message: unknown = body?.message;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `message`." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const foundationResult = await ingestFoundation(storyId);
    if (foundationResult.status === "missing") {
      return NextResponse.json(
        { error: "Generate a Story Foundation Document in Project 1 before starting the World Bible." },
        { status: 400 }
      );
    }
    if (foundationResult.status === "error") {
      return NextResponse.json(
        { error: "Couldn't load this Story's Foundation Document. Please try again." },
        { status: 500 }
      );
    }
    const foundation = foundationResult.foundation;

    const turnId = randomUUID();
    const now = new Date().toISOString();
    await appendMessage(
      storyId,
      { role: "user", content: message.trim(), ts: now, turnId },
      WORLD_MESSAGES_COLLECTION
    );

    const recentMessages = await listMessages(storyId, WORLD_MESSAGE_WINDOW, WORLD_MESSAGES_COLLECTION);

    let system = getSystemPrompt("sp03-wdc-systemprompt.md");
    system += `\n\n[Story Foundation grounding - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author.]\nWorking Title: ${foundation.workingTitle || "(not set)"}\nGenre: ${foundation.genreTone.genre || "(not set)"}\nSubgenre: ${foundation.genreTone.subgenre || "(not set)"}\nTone: ${foundation.genreTone.tone || "(not set)"}\nStyle: ${foundation.genreTone.style || "(not set)"}\nScale: ${foundation.genreTone.scale || "(not set)"}\nPremise: ${foundation.premise || "(not set)"}\nTime Period: ${foundation.worldFoundation.time_period || "(not set)"}\nPrimary Settings: ${listOrDash(foundation.worldFoundation.primary_settings)}\nNature of World: ${foundation.worldFoundation.nature_of_world || "(not set)"}\nPremise Assumptions: ${listOrDash(foundation.worldFoundation.premise_assumptions)}\nEnvironmental Rules: ${listOrDash(foundation.worldFoundation.environmental_rules)}`;

    if (foundationResult.status === "incomplete") {
      system += `\n\n[Story Foundation is incomplete: ${foundationResult.reason} Proceed with what's available; note gaps to the author naturally if relevant, don't block the interview on it.]`;
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = recentMessages.map((m) => ({
      role: m.role,
      content: m.context ? `${m.content}\n\n[Your internal reasoning for that turn]\n${m.context}` : m.content,
    }));

    let delta;
    try {
      delta = await extractTurn({
        anthropic,
        model: "claude-sonnet-5",
        system,
        messages,
        tool: EMIT_WORLD_TURN_TOOL,
        schema: WorldTurnSchema,
      });
    } catch (err) {
      if (err instanceof RateLimitTimeoutError) {
        console.warn("Anthropic rate-limit gate timed out:", err);
        return NextResponse.json(
          { error: "StoriMac is handling a lot of requests right now — please try again in a moment." },
          { status: 503 }
        );
      }
      if (err instanceof TurnValidationError) {
        console.error("World turn extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_stage: delta.current_stage,
      },
      WORLD_MESSAGES_COLLECTION
    );

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_stage: delta.current_stage,
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error:", err);
      return NextResponse.json(
        { error: "The interview couldn't reach the model. Please try again." },
        { status: 502 }
      );
    }
    return errorResponse(err);
  }
}
