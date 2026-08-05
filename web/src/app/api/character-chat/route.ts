import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { logTurnHeuristics } from "@/lib/turnGuardrails";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, appendMessage, listMessages, CHARACTER_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
import { applyStateDelta, CanonConflictError, CHARACTER_FACTS_COLLECTION, type ElementUpdate } from "@/lib/canonEngine/canonStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { computePriorityMatrix } from "@/lib/characterEngine/priorityMatrix";
import { getDepthLabel } from "@/lib/characterEngine/depthLabels";
import { isKnownFieldId } from "@/lib/characterEngine/factRegistry";
import {
  CharacterTurnSchema,
  EMIT_CHARACTER_TURN_TOOL,
  type FactUpdateInput,
} from "@/lib/characterEngine/characterTurnSchema";

export const runtime = "nodejs";

// Bounds the replayed transcript so a long multi-character, multi-stage
// session can't grow the per-turn Anthropic call past the shared
// rate-limit gate's ITPM ceiling (unlike unbounded replay, which can
// eventually make every subsequent turn's estimate permanently exceed the
// ceiling with no in-app recovery). Matches the order of magnitude of
// Project 1's own short-transcript window (contextBudget.ts).
const CHARACTER_MESSAGE_WINDOW = 20;

/**
 * The live Character Bible interview turn — issues #26/#27, reference:
 * web/src/app/api/chat/route.ts (Project 1's own turn handler). Deliberately
 * lighter: no stage-gate/canon-element/conflict-resolution/Stage-7-audit
 * machinery, since none of that exists for Project 2 yet (see
 * docs/superpowers/specs/2026-08-01-p2-interview-engine-design.md) - just
 * sequential-character enforcement (prompt-driven) and the reply/context
 * turn contract already proven on Project 1.
 */
function slugifyCharacterName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toFactUpdate(u: FactUpdateInput, charId: string): ElementUpdate {
  const patch: ElementUpdate["patch"] = {};
  if (u.value !== undefined) patch.value = u.value;
  if (u.state !== undefined) patch.status = u.state === "Deferred" ? "Parked" : u.state;
  if (u.rationale !== undefined) patch.rationale = u.rationale;
  if (u.depends_on !== undefined) patch.depends_on = u.depends_on.map((f) => `${charId}.${f}`);
  return { element_id: `${charId}.${u.field}`, patch };
}

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
        { error: "Generate a Story Foundation Document in Project 1 before starting the Character Bible." },
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
      CHARACTER_MESSAGES_COLLECTION
    );

    const recentMessages = await listMessages(storyId, CHARACTER_MESSAGE_WINDOW, CHARACTER_MESSAGES_COLLECTION);

    // Cast & priority matrix grounding (issues #26/#27) - recomputed every
    // turn (cheap: one Firestore read + pure functions) so the model always
    // has cast/tier context regardless of which character is currently
    // under discussion, not just on the session's first turn.
    const matrix = computePriorityMatrix(foundation);
    const castLines = foundation.cast
      .map((member, i) => {
        const entry = matrix[i];
        return `- ${member.name} (${member.story_role || "role not specified"}): ${entry.tier} tier, ${getDepthLabel(entry.tier)} depth. ${entry.justification}`;
      })
      .join("\n");

    let system = getSystemPrompt("sp02-cdc-systemprompt.md");
    system += `\n\n[Cast & Priority Matrix - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author - synthesize it into your own evaluation.]\n${castLines}`;
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
        tool: EMIT_CHARACTER_TURN_TOOL,
        schema: CharacterTurnSchema,
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
        console.error("Character turn extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }

    const charId = slugifyCharacterName(delta.current_character);
    const factUpdates = delta.updates.map((u) => toFactUpdate(u, charId));
    for (const update of factUpdates) {
      const field = update.element_id.slice(charId.length + 1);
      if (!isKnownFieldId(field)) {
        console.warn(
          `[character-chat] unknown field "${field}" on turn ${turnId} - not in the Project 2 canonical registry, writing as-is`
        );
      }
    }
    if (factUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, factUpdates, turnId, CHARACTER_FACTS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying fact updates on turn ${turnId}:`, err.message);
      }
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_character: delta.current_character,
        current_stage: delta.current_stage,
      },
      CHARACTER_MESSAGES_COLLECTION
    );
    logTurnHeuristics(delta.reply, delta.context, turnId);

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_character: delta.current_character,
      current_stage: delta.current_stage,
      character_signed_off: delta.character_signed_off,
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
