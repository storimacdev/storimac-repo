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
  setP5ContinuityMatrix,
  normalizeP5ContinuityMatrix,
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
  setDraftText,
  setPendingMatrixUpdate,
  canOpenAssignmentGate,
  determineActiveSceneNumber,
  type SceneRecord,
} from "@/lib/screenplayEngine/sceneLedger";
import { validateSceneDraft, type SceneDraftingValidation } from "@/lib/screenplayEngine/sceneDrafting";
import { checkContinuityBeforeDraft, type ContinuityViolation } from "@/lib/screenplayEngine/continuityMatrix";
import { validateSpecialProcessingPaths } from "@/lib/screenplayEngine/specialProcessingPaths";
import { buildComplianceReport, formatScreenplayDelivery } from "@/lib/screenplayEngine/qaDelivery";
import { validateRevisionClassification, canonizeScene } from "@/lib/screenplayEngine/revisionCanonization";

export const runtime = "nodejs";

const SCREENPLAY_MESSAGE_WINDOW = 20;

/**
 * The live P5 Screenwriter/Dramaturg turn handler — GitHub issues #93
 * (Phase 1, Assignment Confirmation Gate), #94 (Phase 2, Scene
 * Drafting), #95 (Phase 3, QA & Delivery), and #96 (Phase 4, Revision
 * & Canonization). Follows architecture-chat/route.ts's exact shape
 * (auth/story lookup -> transcript persistence -> system-prompt
 * assembly with grounding blocks -> one extractTurn call ->
 * deterministic post-processing -> state persistence -> response).
 * Phases 1-4 are wired so far; issue #98 (Conflict Intercept) extends
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
    let continuityMatrix = normalizeP5ContinuityMatrix(story.p5ContinuityMatrix);

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
    } else if (readiness.ready && existingScene?.signedOff && existingScene.status === "Working") {
      // Phase 4 (issue #96): already drafted - this turn is either a
      // revision or an approval, not a first draft.
      system += `\n\n[Phase 4 - Revision & Canonization - internal grounding only. Scene ${existingScene.sceneNumber} has a draft awaiting the author's revision notes or approval. If the author requests a change, re-report the full draft_text with the edit applied at the smallest necessary scope (Line -> Action Paragraph -> Full Scene - never a full rewrite unless the author explicitly asked for one, in which case set full_rewrite_requested true), plus revision_classification (feedback_type: Visuals/Dialogue/Pacing/Subtext/Continuity/Structure, scope, and a description of what changed). If the author explicitly approves this scene's current text, set scene_approved true and report nothing else about this scene's content this turn - approval freezes the current draft_text as immutable canon exactly as it stands. Never report scene_approved true unless the author's message is genuinely explicit approval.]`;
    } else if (readiness.ready && existingScene?.signedOff && existingScene.status !== "Confirmed") {
      // Phase 2 (issue #94): the gate has passed - draft now. Surfaces
      // the live Continuity Matrix state so the model's draft itself
      // avoids an obvious contradiction, on top of the deterministic
      // post-check below (issue #97 AC5).
      const openLoopLines = continuityMatrix.openLoops
        .filter((l) => l.status === "open")
        .map((l) => `- [${l.id}] (${l.kind}) planted scene ${l.plantedSceneNumber}: ${l.description}`);
      system += `\n\n[Phase 2 - Scene Drafting - internal grounding only. Scene ${existingScene.sceneNumber} is signed off. Draft it now in strict industry screenplay format per Sections 3-4: Strict Visual Discipline, active present tense, Lean Action Paragraphs, Performable Dialogue & Subtext, Enter Late/Leave Early, and the Conflict Mandate. Report draft_text, conflict_mandate, enter_late_leave_early, dialogue_voice_audit, continuity_outcomes (every fact/physical-state this scene newly establishes, for the Continuity Matrix once Confirmed), and continuity_requirements (every fact/physical-state this draft relies on) together this turn. Once accepted, the app composes the Phase 3 split delivery (THE SCREENPLAY / COMPLIANCE REPORT) automatically - do not draft that split yourself. If this scene uses a flashback or montage (Section 6), use BEGIN FLASHBACK:/END FLASHBACK. or BEGIN MONTAGE:/END MONTAGE. formatting and report special_processing (flashback justification, per-shot montage evolution, any newly planted Open Loops via loops_opened, and any Open Loop ids this scene pays off via loops_to_close - a loop can only be closed if it was planted in an earlier Confirmed scene). Never alter a structural fact from the Project 4 blueprint (scene count, turning point, cast) without reporting structural_deviation - that halts drafting for the Conflict Intercept protocol rather than silently reinterpreting the blueprint.${
        openLoopLines.length > 0 ? `\nOpen Loops currently tracked:\n${openLoopLines.join("\n")}` : ""
      }]`;
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
    let continuityViolations: ContinuityViolation[] | null = null;
    let draftValidation: SceneDraftingValidation | null = null;
    let structuralDeviation: { deviates: boolean; explanation: string } | null = null;
    let delivery: string | null = null;

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

      // Issue #96: a draft_text report on a scene that was ALREADY
      // Working before this turn is a revision, not the initial draft
      // - requires a Phase 4 revision classification (AC1/AC2), unlike
      // the first draft which has nothing yet to classify a change
      // against.
      const wasAlreadyDrafted = base.status === "Working";

      // Phase 2 (issue #94) / Phase 4 revision (issue #96): only ever
      // advances a scene to Working - a model-requested "Confirmed" is
      // intentionally not honored via draft_text. Confirming happens
      // only through the explicit scene_approved gate below.
      if (delta.draft_text && effectiveScene && effectiveScene.signedOff && effectiveScene.status !== "Confirmed") {
        const continuityCheck = checkContinuityBeforeDraft(continuityMatrix, effectiveScene.sceneNumber, {
          requiredKnowledge: (delta.continuity_requirements?.required_knowledge ?? []).map((k) => ({
            characterId: k.character_id,
            fact: k.fact,
          })),
          referencedSubjects: (delta.continuity_requirements?.referenced_physical ?? []).map((p) => ({
            subject: p.subject,
            kind: p.kind,
            expectedDetail: p.expected_detail,
          })),
        });

        if (!continuityCheck.ok) {
          continuityViolations = continuityCheck.violations;
        } else if (delta.structural_deviation?.deviates) {
          structuralDeviation = delta.structural_deviation;
        } else {
          const validation = validateSceneDraft(delta.draft_text, {
            conflictMandate: {
              present: delta.conflict_mandate?.present ?? false,
              oppositionDescription: delta.conflict_mandate?.opposition_description ?? "",
              permanentShiftDescription: delta.conflict_mandate?.permanent_shift_description ?? "",
            },
            enterLateLeaveEarly: {
              enteredLate: delta.enter_late_leave_early?.entered_late ?? false,
              leftEarly: delta.enter_late_leave_early?.left_early ?? false,
              reason: delta.enter_late_leave_early?.reason ?? "",
            },
          });
          const specialProcessing = validateSpecialProcessingPaths(delta.draft_text, continuityMatrix, {
            flashback: delta.special_processing?.flashback
              ? {
                  present: delta.special_processing.flashback.present,
                  justification: delta.special_processing.flashback.justification,
                }
              : null,
            montage: delta.special_processing?.montage
              ? {
                  present: delta.special_processing.montage.present,
                  shots: delta.special_processing.montage.shots.map((s) => ({
                    description: s.description,
                    evolutionDescription: s.evolution_description,
                  })),
                }
              : null,
            loopsToClose: delta.special_processing?.loops_to_close ?? [],
          });

          const revisionCheck = wasAlreadyDrafted
            ? validateRevisionClassification(
                {
                  feedbackType: delta.revision_classification?.feedback_type ?? "Structure",
                  scope: delta.revision_classification?.scope ?? "Full Scene",
                  description: delta.revision_classification?.description ?? "",
                },
                delta.full_rewrite_requested
              )
            : { ok: true, reason: "" };

          draftValidation = {
            ok: validation.ok && specialProcessing.ok && revisionCheck.ok,
            blockingReasons: [
              ...validation.blockingReasons,
              ...specialProcessing.blockingReasons,
              ...(revisionCheck.ok ? [] : [revisionCheck.reason]),
            ],
            advisoryFindings: validation.advisoryFindings,
          };
          if (draftValidation.ok) {
            const drafted = setPendingMatrixUpdate(setDraftText(effectiveScene, delta.draft_text), {
              knowledgeGained: (delta.continuity_outcomes?.knowledge_gained ?? []).map((k) => ({
                characterId: k.character_id,
                characterName: k.character_name,
                fact: k.fact,
                state: k.state,
              })),
              physicalChanges: (delta.continuity_outcomes?.physical_changes ?? []).map((p) => ({
                subject: p.subject,
                kind: p.kind,
                detail: p.detail,
              })),
              loopsOpened: (delta.special_processing?.loops_opened ?? []).map((l) => ({
                id: l.id,
                description: l.description,
                kind: l.kind,
                payoffSceneNumber: l.payoff_scene_number,
              })),
              loopsClosed: delta.special_processing?.loops_to_close ?? [],
            });
            scenes = upsertScene(scenes, drafted);
            effectiveScene = drafted;

            // Phase 3 (issue #95): split delivery, composed
            // deterministically from the checks already run above plus
            // the model's Dialogue & Voice Audit self-report - never
            // re-derives validateSceneDraft's judgment, just renders it.
            const compliance = buildComplianceReport({
              visualDisciplineFindings: validation.advisoryFindings.visualDiscipline,
              leanParagraphFindings: validation.advisoryFindings.leanParagraphs,
              dialogueVoiceAudit: {
                subtextPresent: delta.dialogue_voice_audit?.subtext_present ?? false,
                notes: delta.dialogue_voice_audit?.notes ?? "",
              },
              matrix: continuityMatrix,
              sceneNumber: effectiveScene.sceneNumber,
            });
            delivery = formatScreenplayDelivery(delta.draft_text, compliance);
          }
        }
      }

      // Phase 4 (issue #96) AC3/AC4: the only path that ever freezes a
      // scene as Confirmed canon - gated entirely on explicit
      // scene_approved, independent of whether draft_text was also
      // reported this same turn (an author may approve on a later,
      // separate turn with no new draft text at all).
      const candidateForApproval = findScene(scenes, sceneNumber) ?? effectiveScene;
      if (
        delta.scene_approved &&
        candidateForApproval &&
        candidateForApproval.status === "Working" &&
        candidateForApproval.draftText
      ) {
        const canonized = canonizeScene({
          scene: candidateForApproval,
          finalText: candidateForApproval.draftText,
          matrix: continuityMatrix,
          explicitApproval: true,
        });
        if (canonized.ok && canonized.scene && canonized.matrix) {
          scenes = upsertScene(scenes, canonized.scene);
          continuityMatrix = canonized.matrix;
          effectiveScene = canonized.scene;
          await setP5ContinuityMatrix(storyId, continuityMatrix);
        }
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
      continuityViolations,
      draftValidation,
      structuralDeviation,
      delivery,
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
