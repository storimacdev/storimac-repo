import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import {
  getStory,
  normalizeP4,
  setP4OnboardingComplete,
  setP4Routing,
  setP4Units,
  appendMessage,
  listMessages,
  ARCHITECTURE_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { ArchitectureTurnSchema, EMIT_ARCHITECTURE_TURN_TOOL } from "@/lib/storyArchitectureEngine/architectureTurnSchema";
import { ingestCanon } from "@/lib/storyArchitectureEngine/ingestCanon";
import { buildOnboardingOutput } from "@/lib/storyArchitectureEngine/onboardingGate";
import { STRUCTURAL_STEPS } from "@/lib/storyArchitectureEngine/structuralFramework";
import {
  createUnit,
  findUnit,
  upsertUnit,
  setUnitContent,
  addCanonRefs,
  type StructuralUnit,
} from "@/lib/storyArchitectureEngine/stateLedger";
import { attemptStatusTransition, checkPlacementDeviation, switchRoute } from "@/lib/storyArchitectureEngine/developmentLoop";

export const runtime = "nodejs";

const ARCHITECTURE_MESSAGE_WINDOW = 20;

/**
 * The live P4 Screenplay Structural Architect turn handler - GitHub
 * issue #111, Task 4 of the P4 architecture chat agent plan. Follows
 * world-chat/route.ts's exact shape (auth/story lookup -> transcript
 * persistence -> system-prompt assembly with grounding blocks -> one
 * extractTurn call -> deterministic post-processing -> state persistence
 * -> response), adapted for P4's own state (onboarding gate, routing,
 * structural-unit ledger) rather than P3's (WCL, pillars, conflict
 * resolution).
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
      ARCHITECTURE_MESSAGES_COLLECTION
    );
    const recentMessages = await listMessages(storyId, ARCHITECTURE_MESSAGE_WINDOW, ARCHITECTURE_MESSAGES_COLLECTION);

    const p4 = normalizeP4(story.p4);
    const canon = await ingestCanon(storyId);

    let system = getSystemPrompt("sp04-sae-systemprompt.md");

    system += `\n\n[Canon Ingestion Summary - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author.]\n${canon.structuralOverview}`;

    if (!p4.onboardingComplete) {
      const onboarding = buildOnboardingOutput(canon);
      const checklistLines = onboarding.milestoneChecklist
        .map((item) => `- Step ${item.stepNumber} (${item.title}): ${item.addressable ? "addressable" : "not yet addressable"} - ${item.reason}`)
        .join("\n");
      system += `\n\n[Onboarding Pending - internal grounding only, never narrate this raw data to the author. Present this in your own words per Section 7. Milestone checklist:\n${checklistLines}\nRouting prompt: ${onboarding.routingPrompt}\nDo not develop any structural content until routing_choice is set.]`;
    } else if (p4.routing) {
      system += `\n\n[Current Routing Choice - computed by the app, trust this over re-deriving it. Internal grounding only. The author's current routing choice is "${p4.routing.routingChoice}". Keep reporting this same value unless the author explicitly changes it.]`;
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
      tool: EMIT_ARCHITECTURE_TURN_TOOL,
      schema: ArchitectureTurnSchema,
    });

    let effectiveOnboardingComplete = p4.onboardingComplete;
    let effectiveRouting = p4.routing;
    let effectiveUnit: StructuralUnit | null = null;
    let placementFlag: { flagged: boolean; message: string | null } = { flagged: false, message: null };
    let units = story.p4Units ?? [];

    try {
      // Onboarding gate: flips once, on the first non-null routing_choice
      // report (Decision 2). Never set back to false.
      if (!effectiveOnboardingComplete && delta.routing_choice) {
        await setP4OnboardingComplete(storyId, true);
        effectiveOnboardingComplete = true;
      }

      // Routing state: only meaningful once onboarding is genuinely done.
      // Only writes when the choice actually changes - sp04 instructs the
      // model to keep reporting the same value every subsequent turn, so
      // writing unconditionally would mean a Firestore write on every
      // single turn of an ordinary conversation for no behavioral reason.
      if (effectiveOnboardingComplete && delta.routing_choice) {
        const routingChanged = !effectiveRouting || effectiveRouting.routingChoice !== delta.routing_choice;
        if (routingChanged) {
          effectiveRouting = effectiveRouting
            ? switchRoute(effectiveRouting, delta.routing_choice)
            : { routingChoice: delta.routing_choice };
          await setP4Routing(storyId, effectiveRouting);
        }
      }

      // Structural unit + status transition: clamped to null entirely
      // until onboarding was ALREADY complete before this turn (Decision
      // 2's backstop). Deliberately checks the pre-turn p4.onboardingComplete,
      // not effectiveOnboardingComplete - an ordinary first reply that sets
      // routing_choice and proposes a unit in the same turn must still see
      // the unit clamped, or the author could skip onboarding entirely.
      if (p4.onboardingComplete && delta.proposed_unit) {
        const proposed = delta.proposed_unit;
        const existing = findUnit(units, proposed.unit_id);
        const base = existing ?? createUnit(proposed.unit_id, proposed.type);
        const withContent = addCanonRefs(setUnitContent(base, proposed.content), proposed.canon_refs);

        const attempt = attemptStatusTransition(withContent, proposed.requested_status, {
          valid: delta.validation_result === "passed",
          reason: delta.validation_reason,
        });

        units = upsertUnit(units, attempt.unit);
        await setP4Units(storyId, units);
        effectiveUnit = attempt.unit;

        if (proposed.proposed_position_percent !== null) {
          const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === delta.active_step_number);
          if (step) {
            placementFlag = checkPlacementDeviation(step, proposed.proposed_position_percent);
          }
        }
      }
    } catch (stateErr) {
      console.warn(`[architecture-chat] state update failed for turn ${turnId}:`, stateErr);
    }

    await appendMessage(
      storyId,
      { role: "assistant", content: delta.reply, context: delta.context, ts: new Date().toISOString(), turnId },
      ARCHITECTURE_MESSAGES_COLLECTION
    );

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      routing_choice: effectiveRouting?.routingChoice ?? null,
      active_step_number: delta.active_step_number,
      unit: effectiveUnit,
      placementFlag,
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
      console.error("Architecture turn extraction failed:", err);
      return NextResponse.json(
        { error: "The conversation couldn't produce a valid response. Please try again." },
        { status: 502 }
      );
    }
    return errorResponse(err);
  }
}
