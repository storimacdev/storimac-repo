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
  appendAuthorTypeAssessment,
  appendOutstandingQuestions,
  appendGuardrailFlag,
  listMessages,
  touchStory,
  setPendingConflict,
  setStage7Audit,
  type StoryPendingConflict,
  type StoredGuardrailFlag,
} from "@/lib/canonEngine/storyStore";
import { runStage7Audit, formatAuditSummary } from "@/lib/canonEngine/stage7Audit";
import { classifyAuthorType, shouldReassess, adjustDepthForAuthorType } from "@/lib/canonEngine/authorType";
import { getDefaultDepthMode } from "@/lib/canonEngine/stageFsm";
import { buildTurnContext } from "@/lib/canonEngine/contextBudget";
import { listElements, applyStateDelta, CanonConflictError, type ElementUpdate } from "@/lib/canonEngine/canonStore";
import type { CanonElement } from "@/lib/canonEngine/types";
import { checkStageGate, advanceStage, getStageDefinition, PROJECT1_STAGES, type OutstandingQuestion } from "@/lib/canonEngine/stageFsm";
import { detectConflict, buildConflictContextMessage, resolveConflict } from "@/lib/canonEngine/conflictResolution";
import { extractTurn, StateDeltaValidationError } from "@/lib/canonEngine/extractTurn";
import type { ElementUpdateInput } from "@/lib/canonEngine/stateDelta";
import { isValidFormatCode, retrieveTopFormats, getFormatByCode } from "@/lib/canonEngine/formatIndex";

export const runtime = "nodejs";

/**
 * The live interview turn — issue #89. Replaces the M1 (#4) stand-in that
 * called Claude with a raw client-side message array and nothing else.
 * Now: auth + workspace-membership gated, persists via storyStore, extracts
 * structured state via extractTurn/canonStore (#9/#6), gates stage
 * advancement via stageFsm (#7), and runs the conflict-resolution 3-way
 * choice via conflictResolution (#10) when a turn touches a Confirmed element.
 */

function toElementUpdate(u: ElementUpdateInput): ElementUpdate {
  const patch: ElementUpdate["patch"] = {};
  if (u.status !== undefined) patch.status = u.status;
  if (u.value !== undefined) patch.value = u.value;
  if (u.rationale !== undefined) patch.rationale = u.rationale;
  if (u.depends_on !== undefined) patch.depends_on = u.depends_on;
  if (u.stage !== undefined) patch.stage = u.stage;
  if (u.retrieval_code !== undefined) {
    patch.retrieval_code = normalizeRetrievalCode(u.retrieval_code, u.element_id);
  }
  return { element_id: u.element_id, patch };
}

/** Validates retrieval_code(s) against the real format index; logs and
 * drops anything that doesn't match a real code instead of persisting a
 * hallucinated one. Never surfaced to the author. */
function normalizeRetrievalCode(raw: unknown, elementId: string): string | string[] | null {
  const codes = Array.isArray(raw) ? raw : [raw];
  const valid = codes.filter((c): c is string => typeof c === "string" && isValidFormatCode(c));
  const invalid = codes.filter((c) => !(typeof c === "string" && isValidFormatCode(c)));
  if (invalid.length > 0) {
    console.warn(`[chat] element "${elementId}" cited invalid retrieval_code(s):`, invalid);
  }
  if (valid.length === 0) return null;
  return Array.isArray(raw) ? valid : valid[0];
}

/** Pulls Common Mistakes for the currently-Confirmed primary_format and
 * supporting_formats, fresh from the in-memory format index (issue #16).
 * The Common Mistakes *text* itself is never persisted and is always looked
 * up fresh from the format index, so the text can't go stale. The lookup
 * *key* (`retrieval_code`) IS persisted state on the element, and must be
 * kept in sync whenever the format changes via Conflict Resolution — see
 * the `newRetrievalCode` threading in resolveConflict/POST above. */
function collectCommonMistakes(elements: CanonElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.element_id, e]));
  const codes: string[] = [];

  const primary = byId.get("primary_format");
  if (primary?.status === "Confirmed" && typeof primary.retrieval_code === "string") {
    codes.push(primary.retrieval_code);
  }
  const supporting = byId.get("supporting_formats");
  if (supporting?.status === "Confirmed" && supporting.retrieval_code) {
    const supportingCodes = Array.isArray(supporting.retrieval_code)
      ? supporting.retrieval_code
      : [supporting.retrieval_code];
    codes.push(...supportingCodes);
  }

  const mistakes: string[] = [];
  for (const code of codes) {
    const format = getFormatByCode(code);
    if (format) mistakes.push(...format.commonMistakes);
  }
  return mistakes;
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

    const [elements, allMessages] = await Promise.all([
      listElements(storyId),
      listMessages(storyId),
    ]);

    // Context budget (issue #13): short transcripts replay a raw window;
    // long ones switch to a compact state summary + the last few raw turns.
    const { window: recentMessages, stateSummary } = buildTurnContext(story, elements, allMessages);

    // Author-type classification (issue #8, PRD §5.2): re-assess during the
    // first ~3 author messages and on any later large unprompted dump. Never
    // shown to the author — it only shapes internal depth defaults below.
    const authorMessageCount = allMessages.filter((m) => m.role === "user").length;
    let authorType = story.authorTypeHistory.at(-1)?.type ?? null;
    if (shouldReassess({ message, authorMessageCount })) {
      const assessment = classifyAuthorType({ message, authorMessageCount });
      await appendAuthorTypeAssessment(storyId, assessment);
      authorType = assessment.type;
    }

    let system = getSystemPrompt();
    if (stateSummary) {
      // Long transcript: the summary carries all Confirmed canon + stage.
      system += `\n\n${stateSummary}`;
    } else {
      const confirmedSnapshot = elements
        .filter((e) => e.status === "Confirmed")
        .map((e) => `- ${e.element_id}: ${JSON.stringify(e.value)}`)
        .join("\n");
      if (confirmedSnapshot) {
        system += `\n\n[Current Canon State — Confirmed elements only, for your grounding, never narrate this to the author]\n${confirmedSnapshot}`;
      }
    }

    // Depth defaults for the current stage, adjusted by author type (issue
    // #8). Internal guidance only — the classification itself is never
    // stated to the author, and an explicit author request for more/less
    // depth always overrides these defaults (the system prompt honors that).
    if (authorType) {
      const stageDef = getStageDefinition(story.currentStage);
      const depthLines = stageDef.requiredElementIds
        .map((id) => `- ${id}: ${adjustDepthForAuthorType(getDefaultDepthMode(story.currentStage, id), authorType)}`)
        .join("\n");
      if (depthLines) {
        system += `\n\n[Depth defaults for the current stage — internal guidance, never narrate depth modes or author-type labels to the author. An explicit author request for more or less depth always overrides these.]\n${depthLines}`;
      }
    }

    // Stage 2 format-diagnosis grounding (issue #15). Retrieve top
    // candidates from the 101 Story Formats index using Stage 1's answers,
    // never the full 100-record set, never on any other stage.
    if (story.currentStage === 2) {
      const byId = new Map(elements.map((e) => [e.element_id, e]));
      const stage1Text = ["concept", "inspiration", "target_audience", "emotional_engine"]
        .map((id) => byId.get(id)?.value)
        .filter((v) => v !== undefined && v !== null)
        .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join(" ");
      if (stage1Text) {
        const candidates = retrieveTopFormats(stage1Text, 10);
        const candidateLines = candidates
          .map(
            (f) =>
              `- ${f.code}: ${f.coreDefinition} | Dramatic Question: ${f.coreDramaticQuestion} | Plot Engine: ${f.engines.plot} | Story Engine: ${f.engines.story} | Theme Engine: ${f.engines.theme} | Common Mistakes: ${f.commonMistakes.join("; ")}`
          )
          .join("\n");
        system += `\n\n[Stage 2 format candidates — retrieved from the 101 Story Formats index, internal grounding only. Reason over these to diagnose 1 Primary Format + 0-2 Supporting Formats. Do NOT speak a format's name or code aloud in your conversational reply — only reference them internally and in the eventual Stage 8 document; discuss the story using its qualities (dramatic question, engines, common pitfalls), not its catalog label. Emit the diagnosed format(s)' codes via the retrieval_code field on your structured update.]\n${candidateLines}`;
      } else {
        console.warn(`[chat] Stage 2 reached with no usable Stage 1 answers for story ${storyId} - format retrieval skipped, no grounding injected this turn.`);
      }
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
        const resolvedUpdate = updates.find((u) => u.element_id === pendingConflict.element_id);
        await resolveConflict({
          storyId,
          conflict: pendingConflict,
          choice: delta.resolution,
          turnId,
          newValue: resolvedUpdate?.patch.value,
          newRetrievalCode: resolvedUpdate?.patch.retrieval_code,
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

    // Stage 7 gate (issue #17): the author's first message after seeing the
    // audit summary counts as their response and unlocks Stage 8.
    let stage7Responded = story.stage7Audit?.authorResponded ?? false;
    if (story.currentStage === 7 && story.stage7Audit && !stage7Responded) {
      stage7Responded = true;
      await setStage7Audit(storyId, { ...story.stage7Audit, authorResponded: true });
    }

    let currentStage = story.currentStage;
    let outstandingQuestions: OutstandingQuestion[] = [];
    let auditSummary: string | null = null;
    const isLastStage = story.currentStage >= PROJECT1_STAGES[PROJECT1_STAGES.length - 1].stage;
    const blockedByStage7 = story.currentStage === 7 && !stage7Responded;
    if (!nextPendingConflict && delta.stage_ready_to_advance && !isLastStage && !blockedByStage7) {
      const freshElements = await listElements(storyId);
      const gate = checkStageGate(story.currentStage, freshElements);
      if (gate.canAdvance) {
        const result = advanceStage(story.currentStage, freshElements);
        currentStage = result.nextStage;
        outstandingQuestions = result.outstandingQuestions;
        await touchStory(storyId, { currentStage });
        // Persist Parked-element questions for the Stage 8 compiler (#18).
        await appendOutstandingQuestions(storyId, outstandingQuestions);

        // Entering Stage 7 triggers the system-run Creative Audit (#17).
        if (currentStage === 7) {
          const commonMistakes = collectCommonMistakes(freshElements);
          const audit = runStage7Audit(freshElements, commonMistakes);
          await setStage7Audit(storyId, audit);
          auditSummary = formatAuditSummary(audit);
        }
      }
    }

    await appendMessage(storyId, { role: "assistant", content: delta.reply, ts: new Date().toISOString(), turnId });
    if (auditSummary) {
      await appendMessage(storyId, { role: "assistant", content: auditSummary, ts: new Date().toISOString(), turnId });
    }
    const heuristics = logTurnHeuristics(delta.reply, turnId);
    let guardrailFlag: StoredGuardrailFlag | null = null;
    if (heuristics.isQuestionnaireDump) {
      try {
        guardrailFlag = await appendGuardrailFlag(storyId, { turnId, questionCount: heuristics.questionCount });
      } catch (err) {
        console.error(`[chat] failed to persist guardrail flag for turn ${turnId}:`, err);
      }
    }

    // Post-write element state so the Canon side panel (issue #11) updates
    // after each turn without a second round-trip.
    const elementsAfter = await listElements(storyId);

    return NextResponse.json({
      reply: delta.reply,
      auditSummary,
      elements: elementsAfter,
      currentStage,
      currentStageName: getStageDefinition(currentStage).name,
      stageAdvanced: currentStage !== story.currentStage,
      outstandingQuestions,
      conflict: nextPendingConflict,
      guardrailFlag,
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
