import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import {
  getStory,
  appendMessage,
  listMessages,
  appendOutstandingQuestions,
  setP5Scenes,
  SCREENPLAY_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { ScreenplayTurnSchema, EMIT_SCREENPLAY_TURN_TOOL } from "@/lib/screenplayEngine/screenplayTurnSchema";
import { ingestScreenplayCanon } from "@/lib/screenplayEngine/ingestCanon";
import {
  checkAssignmentGateReadiness,
  buildAssignmentGateGroundingMessage,
  validateAssignmentSummaryFormat,
} from "@/lib/screenplayEngine/assignmentGate";
import {
  findScene,
  upsertScene,
  createSceneRecord,
  setAssignmentSummary,
  signOffAssignment,
  canOpenAssignmentGate,
  determineActiveSceneNumber,
  type SceneRecord,
} from "@/lib/screenplayEngine/sceneLedger";

export const runtime = "nodejs";

const SCREENPLAY_MESSAGE_WINDOW = 20;

/**
 * The live P5 Screenwriter/Dramaturg turn handler — GitHub issue #93
 * (Phase 1, Assignment Confirmation Gate). Follows architecture-chat/
 * route.ts's exact shape (auth/story lookup -> transcript persistence ->
 * system-prompt assembly with grounding blocks -> one extractTurn call
 * -> deterministic post-processing -> state persistence -> response).
 * Only Phase 1 is wired so far; later issues (#94 drafting, #95 QA/
 * delivery, #96 revision/canonization, #98 conflict intercept) extend
 * this same route rather than adding a second one, matching how
 * architecture-chat/route.ts itself grew across P4's issues.
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Server is not configured with an Anthropic API key." }, { status: 500 });
    }
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
    await appendMessage(
      storyId,
      { role: "user", content: message, ts: new Date().toISOString(), turnId },
      SCREENPLAY_MESSAGES_COLLECTION
    );
    const recentMessages = await listMessages(storyId, SCREENPLAY_MESSAGE_WINDOW, SCREENPLAY_MESSAGES_COLLECTION);
    const isFirstTurn = recentMessages.filter((m) => m.role === "assistant").length === 0;

    const canon = await ingestScreenplayCanon(storyId);
    let scenes = story.p5Scenes ?? [];

    let system = getSystemPrompt("sp05-se-systemprompt.md");

    if (isFirstTurn) {
      system += `\n\n[Canon Ingestion Acknowledgment - internal grounding only, never narrate this raw data to the author. Present this in your own words per Section 9 (Operational Response Directive): ${canon.acknowledgment}${
        canon.gaps.length > 0
          ? ` Flag these gaps explicitly and ask the author how to proceed: ${canon.gaps.map((g) => `${g.project} ${g.field} - ${g.reason}`).join("; ")}.`
          : ""
      }]`;
    }

    // The active scene pointer is always server-derived from `scenes`
    // (never from the raw transcript) before the model call, so the
    // grounding below tells the model which scene is in play rather
    // than asking it to infer one - the model's own `scene_number`
    // report is only trusted afterward, when choosing which scene to
    // write this turn's result into (see below).
    const activeSceneNumber = determineActiveSceneNumber(scenes, null);
    const existingScene = findScene(scenes, activeSceneNumber);

    const gateOpenCheck = canOpenAssignmentGate(scenes, activeSceneNumber);
    const readiness = checkAssignmentGateReadiness(canon.p4, activeSceneNumber);

    if (scenes.length > 0) {
      const sceneLines = scenes.map(
        (s) => `- Scene ${s.sceneNumber}: status ${s.status}, phase ${s.phase}, signedOff: ${s.signedOff}`
      );
      system += `\n\n[Scenes So Far - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author.]\n${sceneLines.join("\n")}`;
    }

    system += `\n\n[Active Scene - computed by the app, trust this over re-deriving it. Internal grounding only. The scene currently in play is Scene ${activeSceneNumber}. Report scene_number as ${activeSceneNumber} this turn unless the author explicitly asks to revisit a different, already-resolved scene.]`;

    if (!gateOpenCheck.ok) {
      system += `\n\n[Gate Blocked - internal grounding only, never narrate this raw data verbatim, but convey its substance: ${gateOpenCheck.reason}]`;
    } else if (!readiness.ready) {
      system += `\n\n[Scene Register Gap - internal grounding only. ${readiness.reason} Tell the author this scene cannot be gated yet and ask how to proceed - never invent a Scene Register entry.]`;
    } else if (readiness.entry && !existingScene?.signedOff) {
      system += buildAssignmentGateGroundingMessage(readiness.entry);
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = recentMessages.map((m) => ({
      role: m.role,
      content: m.context ? `${m.content}\n\n[Your internal reasoning for that turn: ${m.context}]` : m.content,
    }));

    const delta = await extractTurn({
      anthropic,
      model: "claude-sonnet-5",
      system,
      messages,
      tool: EMIT_SCREENPLAY_TURN_TOOL,
      schema: ScreenplayTurnSchema,
      maxTokens: 8192,
    });

    let effectiveScene: SceneRecord | null = existingScene;
    let summaryFormatIssue: string | null = null;

    try {
      const sceneNumber = delta.scene_number ?? activeSceneNumber;
      const base = findScene(scenes, sceneNumber) ?? createSceneRecord(sceneNumber);

      if (delta.proposed_assignment_summary) {
        const validation = validateAssignmentSummaryFormat(delta.proposed_assignment_summary);
        if (validation.ok) {
          const withSummary = setAssignmentSummary(base, delta.proposed_assignment_summary);
          scenes = upsertScene(scenes, withSummary);
          effectiveScene = withSummary;
        } else {
          summaryFormatIssue = validation.reason;
          effectiveScene = base;
        }
      } else {
        effectiveScene = base;
      }

      if (delta.assignment_sign_off && effectiveScene?.assignmentSummary && !effectiveScene.signedOff) {
        const signed = signOffAssignment(effectiveScene);
        scenes = upsertScene(scenes, signed);
        effectiveScene = signed;
      }

      await setP5Scenes(storyId, scenes);
    } catch (stateErr) {
      console.warn(`[screenplay-chat] state update failed for turn ${turnId}:`, stateErr);
    }

    await appendMessage(
      storyId,
      { role: "assistant", content: delta.reply, context: delta.context, ts: new Date().toISOString(), turnId },
      SCREENPLAY_MESSAGES_COLLECTION
    );

    if (delta.deferred_items.length > 0) {
      try {
        await appendOutstandingQuestions(
          storyId,
          delta.deferred_items.map((d) => ({ item: d.item, defer_to: d.defer_to_project, notes: d.notes }))
        );
      } catch (deferredErr) {
        console.warn(`[screenplay-chat] deferred-item logging failed for turn ${turnId}:`, deferredErr);
      }
    }

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      sceneNumber: delta.scene_number ?? activeSceneNumber,
      phase: delta.phase,
      scene: effectiveScene,
      summaryFormatIssue,
      gaps: canon.gaps,
      deferredItems: delta.deferred_items,
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
      console.error("Screenplay turn extraction failed:", err);
      return NextResponse.json(
        { error: "The conversation couldn't produce a valid response. Please try again." },
        { status: 502 }
      );
    }
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error:", err);
      return NextResponse.json(
        { error: "The Screenwriter couldn't reach the model. Please try again." },
        { status: 502 }
      );
    }
    return errorResponse(err);
  }
}
