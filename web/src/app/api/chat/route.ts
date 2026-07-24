import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { logTurnHeuristics } from "@/lib/turnGuardrails";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import {
  getStory,
  appendMessage,
  listMessages,
  touchStory,
  setPendingConflict,
  type StoryPendingConflict,
} from "@/lib/canonEngine/storyStore";
import { listElements, applyStateDelta, CanonConflictError, type ElementUpdate } from "@/lib/canonEngine/canonStore";
import { checkStageGate, advanceStage, getStageDefinition, PROJECT1_STAGES, type OutstandingQuestion } from "@/lib/canonEngine/stageFsm";
import { detectConflict, buildConflictContextMessage, resolveConflict } from "@/lib/canonEngine/conflictResolution";
import { extractTurn, StateDeltaValidationError } from "@/lib/canonEngine/extractTurn";
import type { ElementUpdateInput } from "@/lib/canonEngine/stateDelta";

export const runtime = "nodejs";

/**
 * The live interview turn — issue #89. Replaces the M1 (#4) stand-in that
 * called Claude with a raw client-side message array and nothing else.
 * Now: auth + workspace-membership gated, persists via storyStore, extracts
 * structured state via extractTurn/canonStore (#9/#6), gates stage
 * advancement via stageFsm (#7), and runs the conflict-resolution 3-way
 * choice via conflictResolution (#10) when a turn touches a Confirmed element.
 */

const CONTEXT_MESSAGE_LIMIT = 20;

function toElementUpdate(u: ElementUpdateInput): ElementUpdate {
  const patch: ElementUpdate["patch"] = {};
  if (u.status !== undefined) patch.status = u.status;
  if (u.value !== undefined) patch.value = u.value;
  if (u.rationale !== undefined) patch.rationale = u.rationale;
  if (u.depends_on !== undefined) patch.depends_on = u.depends_on;
  if (u.stage !== undefined) patch.stage = u.stage;
  return { element_id: u.element_id, patch };
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set. Add it to web/.env.local and restart the dev server.",
      },
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

    const turnId = randomUUID();
    const now = new Date().toISOString();
    await appendMessage(storyId, { role: "user", content: message.trim(), ts: now, turnId });

    const [elements, recentMessages] = await Promise.all([
      listElements(storyId),
      listMessages(storyId, CONTEXT_MESSAGE_LIMIT),
    ]);

    const confirmedSnapshot = elements
      .filter((e) => e.status === "Confirmed")
      .map((e) => `- ${e.element_id}: ${JSON.stringify(e.value)}`)
      .join("\n");

    let system = getSystemPrompt();
    if (confirmedSnapshot) {
      system += `\n\n[Current Canon State — Confirmed elements only, for your grounding, never narrate this to the author]\n${confirmedSnapshot}`;
    }
    const pendingConflict = story.pendingConflict ?? null;
    if (pendingConflict) {
      system += `\n\n${buildConflictContextMessage(pendingConflict)}`;
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let delta;
    try {
      delta = await extractTurn({
        anthropic,
        model: "claude-sonnet-5",
        system,
        messages,
      });
    } catch (err) {
      if (err instanceof StateDeltaValidationError) {
        console.error("State delta extraction failed:", err);
        return NextResponse.json(
          { error: "The interview couldn't produce a valid response. Please try again." },
          { status: 502 }
        );
      }
      throw err;
    }

    const updates = delta.updates.map(toElementUpdate);
    let nextPendingConflict: StoryPendingConflict | null = pendingConflict;

    if (pendingConflict) {
      if (delta.resolution) {
        const resolvedUpdate = delta.updates.find((u) => u.element_id === pendingConflict.element_id);
        await resolveConflict({
          storyId,
          conflict: pendingConflict,
          choice: delta.resolution,
          turnId,
          newValue: resolvedUpdate?.value,
        });
        nextPendingConflict = null;
        await setPendingConflict(storyId, null);

        const remainingUpdates = updates.filter((u) => u.element_id !== pendingConflict.element_id);
        if (remainingUpdates.length > 0) {
          try {
            await applyStateDelta(storyId, remainingUpdates, turnId);
          } catch (err) {
            if (!(err instanceof CanonConflictError)) throw err;
            console.warn(`[chat] unexpected conflict applying remaining updates on turn ${turnId}:`, err.message);
          }
        }
      }
      // else: still awaiting the author's A/B/C pick — apply nothing this turn.
    } else if (updates.length > 0) {
      const conflict = await detectConflict(storyId, updates);
      if (conflict) {
        nextPendingConflict = conflict;
        await setPendingConflict(storyId, conflict);
      } else {
        try {
          await applyStateDelta(storyId, updates, turnId);
        } catch (err) {
          if (!(err instanceof CanonConflictError)) throw err;
          console.warn(`[chat] applyStateDelta hit an unscreened conflict on turn ${turnId}:`, err.message);
          nextPendingConflict = null;
        }
      }
    }

    let currentStage = story.currentStage;
    let outstandingQuestions: OutstandingQuestion[] = [];
    const isLastStage = story.currentStage >= PROJECT1_STAGES[PROJECT1_STAGES.length - 1].stage;
    if (!nextPendingConflict && delta.stage_ready_to_advance && !isLastStage) {
      const freshElements = await listElements(storyId);
      const gate = checkStageGate(story.currentStage, freshElements);
      if (gate.canAdvance) {
        const result = advanceStage(story.currentStage, freshElements);
        currentStage = result.nextStage;
        outstandingQuestions = result.outstandingQuestions;
        await touchStory(storyId, { currentStage });
      }
    }

    await appendMessage(storyId, { role: "assistant", content: delta.reply, ts: new Date().toISOString(), turnId });
    logTurnHeuristics(delta.reply, turnId);

    return NextResponse.json({
      reply: delta.reply,
      currentStage,
      currentStageName: getStageDefinition(currentStage).name,
      stageAdvanced: currentStage !== story.currentStage,
      outstandingQuestions,
      conflict: nextPendingConflict,
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
