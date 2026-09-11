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
  setP3ProposedLevel,
  setP3ProposedPillars,
  setP3ActivePillar,
  normalizeP3,
  type P3State,
  WORLD_MESSAGES_COLLECTION,
  appendOutstandingQuestions,
  setP3PendingConflict,
  type P3PendingConflict,
} from "@/lib/canonEngine/storyStore";
import { createWorldEntry, updateWorldEntry } from "@/lib/worldEngine/worldEntryStore";
import { buildConflictContextMessage, resolveP3Conflict } from "@/lib/worldEngine/conflictResolution";
import { listElements, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import type { ImportanceDepthCheck } from "@/lib/worldEngine/worldEntry";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/worldEngine/ingestFoundation";
import { ingestFoundation as characterIngestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { checkCharacterBibleComplete } from "@/lib/worldEngine/characterBibleGate";
import { WorldTurnSchema, EMIT_WORLD_TURN_TOOL } from "@/lib/worldEngine/worldTurnSchema";
import { detectProseGeneration, buildScopeRedirectNote } from "@/lib/worldEngine/scopeGuardrail";

export const runtime = "nodejs";

// Bounds the replayed transcript so a long session can't grow the per-turn
// Anthropic call past the shared rate-limit gate's ITPM ceiling - same
// reasoning and same order of magnitude as character-chat/route.ts's own
// CHARACTER_MESSAGE_WINDOW.
const WORLD_MESSAGE_WINDOW = 20;

function listOrDash(items?: unknown[]): string {
  if (!items?.length) return "(not set)";
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
    const retry = body?.retry === true;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    let userMessage = "";
    if (!retry) {
      if (typeof message !== "string" || !message.trim()) {
        return NextResponse.json({ error: "Request must include a non-empty `message`." }, { status: 400 });
      }
      userMessage = message.trim();
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    // Character Bible completion gate - authoritative check, independent
    // of the UI's own resume-time check (canvases/[canvasId]/route.ts).
    // Rejects before this route's own worldEngine ingestFoundation call
    // below, so a blocked request doesn't pay that fetch cost. A missing
    // or malformed character Foundation is treated as "nothing to gate
    // on yet" - the worldEngine ingestFoundation call below independently
    // handles its own missing/error Foundation cases unchanged.
    const characterFoundation = await characterIngestFoundation(storyId);
    if (characterFoundation.status === "ok" || characterFoundation.status === "incomplete") {
      const gate = checkCharacterBibleComplete(characterFoundation.foundation.cast, story.p2);
      if (!gate.complete) {
        return NextResponse.json(
          {
            error: `Finish your Character Bible before starting the World Bible. Still in progress: ${
              gate.incompleteNames.length > 5
                ? `${gate.incompleteNames.slice(0, 5).join(", ")}, and ${gate.incompleteNames.length - 5} more`
                : gate.incompleteNames.join(", ")
            }.`,
          },
          { status: 400 }
        );
      }
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
    if (retry) {
      const lastMessages = await listMessages(storyId, 1, WORLD_MESSAGES_COLLECTION);
      if (lastMessages[0]?.role !== "user") {
        return NextResponse.json({ error: "Nothing to retry." }, { status: 409 });
      }
    } else {
      await appendMessage(
        storyId,
        { role: "user", content: userMessage, ts: now, turnId },
        WORLD_MESSAGES_COLLECTION
      );
    }

    const recentMessages = await listMessages(storyId, WORLD_MESSAGE_WINDOW, WORLD_MESSAGES_COLLECTION);

    let system = getSystemPrompt("sp03-wdc-systemprompt.md");
    system += `\n\n[Story Foundation grounding - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author.]\nWorking Title: ${foundation.workingTitle || "(not set)"}\nGenre: ${foundation.genreTone.genre || "(not set)"}\nSubgenre: ${foundation.genreTone.subgenre || "(not set)"}\nTone: ${foundation.genreTone.tone || "(not set)"}\nStyle: ${foundation.genreTone.style || "(not set)"}\nScale: ${foundation.genreTone.scale || "(not set)"}\nPremise: ${foundation.premise || "(not set)"}\nTime Period: ${foundation.worldFoundation.time_period || "(not set)"}\nPrimary Settings: ${listOrDash(foundation.worldFoundation.primary_settings)}\nNature of World: ${foundation.worldFoundation.nature_of_world || "(not set)"}\nPremise Assumptions: ${listOrDash(foundation.worldFoundation.premise_assumptions)}\nEnvironmental Rules: ${listOrDash(foundation.worldFoundation.environmental_rules)}`;

    if (foundationResult.status === "incomplete") {
      system += `\n\n[Story Foundation is incomplete: ${foundationResult.reason} Proceed with what's available; note gaps to the author naturally if relevant, don't block the interview on it.]`;
    }

    // World Entries grounding for the Discover/Develop/Validate cycle
    // (issue #43, final whole-branch review finding I1) - the model's
    // only way to reference an existing entry by id in
    // proposed_entry.entry_id; without this, entry_id can only ever be
    // null or hallucinated, and every Develop/Validate turn creates a
    // fresh duplicate entry instead of continuing the one already
    // drafted. Lists every entry regardless of status, not just
    // Confirmed ones (unlike issue #36's Confirmed Facts block) - a
    // Working/Exploring entry from an earlier turn must remain
    // addressable by id too. Kept to compact identifying fields only (no
    // free-text value content) since the model already sees recent
    // content via the replayed transcript window.
    const existingEntries = await listElements(storyId, WORLD_ENTRIES_COLLECTION);
    if (existingEntries.length > 0) {
      const entryLines = existingEntries.map((e) => {
        const v = (e.value ?? {}) as { name?: string; category?: string; importance?: string; depth?: number };
        const status = e.status === "Parked" ? "Deferred" : e.status;
        return `- entry_id: ${e.element_id} | name: ${v.name ?? "?"} | category: ${v.category ?? "?"} | status: ${status} | importance: ${v.importance ?? "?"} | depth: ${v.depth ?? "?"}`;
      });
      system += `\n\n[World Entries So Far - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. When continuing, revising, or validating any entry listed here, set proposed_entry.entry_id to its id exactly as shown - never invent a new id and never leave entry_id null for an entry that already appears here, or you will create an unwanted duplicate.]\n${entryLines.join("\n")}`;
    }

    // Conflict Resolution Protocol grounding (issue #47) - only while a
    // conflict is genuinely open; cleared once resolved (Step 5 below).
    const pendingConflictBefore = story.p3PendingConflict ?? null;
    if (pendingConflictBefore) {
      system += buildConflictContextMessage(pendingConflictBefore);
    }

    // Issue #110: closing reminder, always the LAST thing appended to
    // `system` on every turn - targets any bracketed grounding block
    // above, whatever it calls itself, rather than enumerating today's
    // block names or exact phrasing, so it stays correct as new blocks
    // are added later without needing an update here.
    system += `\n\n[Final reminder - applies to everything above: never name, quote, or describe the title of any bracketed section appended to this prompt at runtime, however it labels itself (for example "[... - computed by the app...]", "[... - internal grounding only...]", "[CONFLICT DETECTED...]", or "[Story Foundation is incomplete...]") - by its title or by any other means. Never reference internal framework or document names, issue numbers, FR/PRD identifiers, or other developer/product terminology - except the author-facing product names and on-screen controls this app itself shows the author (for example "Story Foundation Document", "Character Bible", "World Bible", "Project 2", "Project 3", the "Generate document" button, or "Continue to Character Development"), which you should keep naming normally when guiding the author. Speak only in your own voice as the persona defined at the top of this prompt - an authoritative creative collaborator, never as a system narrating which of its own documented steps or internal mechanisms it is executing.]`;

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

    // Scope-boundary guardrail (issue #46) - Layer 1 (model self-report
    // via deferred_items) and Layer 2 (rules-based prose/dialogue
    // detection, Project 5 only - see the design doc for why only P5
    // gets a rules-based check) both run BEFORE the reply is persisted
    // or returned, so neither a leaked prose draft nor an unflagged
    // deferral topic ever enters the transcript the next turn's
    // replayed-message window would re-surface. logTurnHeuristics below
    // still scans the model's real, unmodified reply/context (never
    // finalReply/finalContext) - it exists specifically to catch leaks
    // in the model's actual output, independent of what the guardrail
    // decided to show the author (final whole-branch review finding I2).
    const proseDetected = detectProseGeneration(delta.reply);
    const deferredItems = [...delta.deferred_items];
    if (proseDetected && !deferredItems.some((d) => d.defer_to_project === "Project 5")) {
      deferredItems.push({
        item: "Drafted narrative prose or dialogue",
        defer_to_project: "Project 5",
        notes: "Blocked automatically by the scope-boundary guardrail before being shown to the author.",
      });
    }

    let finalReply = delta.reply;
    let finalContext = delta.context;
    if (proseDetected) {
      // Layer 2 fired: genuine off-scope content was generated. Per the
      // AC ("offer to log it... instead of executing the work"), the
      // drafted prose must never reach the author - full replace, the
      // one place this feature discards model output. context is
      // scrubbed too (final whole-branch review finding I1) - the
      // model's internal reasoning could restate or summarize the same
      // blocked content, and it's both shown to the author as a Notes
      // card and replayed into the next turn's prompt.
      finalReply = buildScopeRedirectNote(deferredItems);
      finalContext = "Scope-boundary guardrail: this turn's content was redirected (see above).";
    } else if (deferredItems.length > 0) {
      // Layer 1 only: the model already recognized the topic and, per
      // prompt instruction, is expected to have already steered the
      // conversation in its own reply - append a deterministic note as
      // a consistency guarantee rather than discarding the turn's
      // otherwise-legitimate content.
      finalReply = `${delta.reply}\n\n${buildScopeRedirectNote(deferredItems)}`;
    }

    if (deferredItems.length > 0) {
      console.warn(
        `[world-chat] scope-guardrail fired for turn ${turnId}: proseDetected=${proseDetected}, ${deferredItems.length} deferred item(s) (${deferredItems.map((d) => d.defer_to_project).join(", ")})`
      );
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: finalReply,
        ts: new Date().toISOString(),
        turnId,
        context: finalContext,
        current_stage: delta.current_stage,
      },
      WORLD_MESSAGES_COLLECTION
    );
    logTurnHeuristics(delta.reply, delta.context, turnId);

    if (deferredItems.length > 0) {
      try {
        await appendOutstandingQuestions(
          storyId,
          deferredItems.map((d) => ({
            item: d.item,
            defer_to: d.defer_to_project,
            notes: d.notes,
          }))
        );
      } catch (guardrailErr) {
        console.warn(`[world-chat] scope-guardrail deferred-item logging failed for turn ${turnId}:`, guardrailErr);
      }
    }

    // World Complexity Level and Pillar proposal tracking (issues #39,
    // #40, final-review fix pattern) - only the proposed fields are ever
    // written here, via dotted-field-path updates, so this can never
    // clobber a value an author confirmed concurrently via
    // PATCH /api/world-chat/wcl or PATCH /api/world-chat/pillars while
    // this turn's model call was in flight.
    let p3ForResponse: P3State = normalizeP3(story.p3);
    if (delta.proposed_wcl !== null) {
      await setP3ProposedLevel(storyId, delta.proposed_wcl);
      p3ForResponse = { ...p3ForResponse, proposedWorldComplexityLevel: delta.proposed_wcl };
    }
    if (delta.proposed_pillars !== null) {
      await setP3ProposedPillars(storyId, delta.proposed_pillars);
      p3ForResponse = { ...p3ForResponse, proposedPillars: delta.proposed_pillars };
    }

    // Conflict Resolution Protocol (issue #47) - resolves an already-open
    // conflict if the author just picked a choice, or opens a new
    // Foundation-level one if the model self-reported a contradiction
    // this turn. Runs before Stage 3 below so that block can check
    // whether a conflict is still open and, if so, skip all Stage 3
    // writes this turn (halts forward progress per the AC).
    let pendingConflictForResponse: P3PendingConflict | null = pendingConflictBefore;
    let cascadeReview: { entryId: string; name: string }[] | null = null;
    try {
      if (pendingConflictBefore && delta.resolution !== null) {
        const result = await resolveP3Conflict({
          storyId,
          conflict: pendingConflictBefore,
          resolution: delta.resolution,
          turnId,
          resolvedBy: user.uid,
        });
        cascadeReview = result.cascadeReview;
        // Persist the clear before updating the in-memory value (final
        // review, Task 5): if setP3PendingConflict throws, the outer
        // catch's console.warn still fires, but pendingConflictForResponse
        // stays at its pre-resolution value - the same safe "leave it
        // pending" fallback already used when resolveP3Conflict itself
        // throws - rather than telling this turn's Stage 3 block the
        // conflict is resolved while Firestore still shows it open.
        await setP3PendingConflict(storyId, null);
        pendingConflictForResponse = null;
      } else if (!pendingConflictBefore && delta.conflict_detected) {
        const newConflict: P3PendingConflict = {
          kind: "foundation",
          description: delta.conflict_description ?? "The model flagged a contradiction but gave no description.",
          ts: new Date().toISOString(),
        };
        pendingConflictForResponse = newConflict;
        await setP3PendingConflict(storyId, newConflict);
      }
    } catch (conflictErr) {
      console.warn(`[world-chat] conflict resolution failed for turn ${turnId}:`, conflictErr);
    }

    // Stage 3 Discover/Develop/Validate cycle (issue #43) - the model's
    // active_pillar/proposed_entry/validated_status are always advisory;
    // the app only ever persists them through the same validated store
    // functions (and their existing Confirmed-value guard, isValidTransition
    // check) the direct entries API already enforces. Both an explicit
    // {ok:false} rejection AND a thrown exception (a Firestore transaction
    // error, a stale-by-commit-time race in applyStateDelta) degrade
    // gracefully - logged, never a hard error to the author. The
    // assistant's reply/context for this turn were already persisted
    // above; an uncaught throw here would 500 the whole response after
    // the turn already exists in the transcript, stranding the author
    // (a retry would immediately 409 "Nothing to retry") - the try/catch
    // below exists specifically to prevent that.
    let entryWarning: ImportanceDepthCheck | null = null;
    try {
      if (pendingConflictForResponse) {
        // A conflict is still open (either just detected this turn, or
        // still awaiting the author's choice from an earlier turn) -
        // halt Stage 3 forward progress entirely this turn, matching
        // Project 1/2's existing single-pending-conflict convention.
      } else if (delta.active_pillar !== p3ForResponse.activePillar) {
        await setP3ActivePillar(storyId, delta.active_pillar);
        p3ForResponse = { ...p3ForResponse, activePillar: delta.active_pillar };
      }

      if (!pendingConflictForResponse && delta.proposed_entry) {
        const entryInput = {
          name: delta.proposed_entry.name,
          category: delta.proposed_entry.category,
          narrativeRole: delta.proposed_entry.narrative_role,
          importance: delta.proposed_entry.importance,
          depth: delta.proposed_entry.depth,
          functionalDescription: delta.proposed_entry.functional_description,
          governingRules: delta.proposed_entry.governing_rules,
        };
        if (delta.proposed_entry.entry_id === null) {
          const { element, warning } = await createWorldEntry(storyId, entryInput);
          entryWarning = warning;
          if (delta.validated_status !== null) {
            const validation = await updateWorldEntry(storyId, element.element_id, {
              status: delta.validated_status,
            });
            if (validation.ok) {
              entryWarning = validation.warning;
            } else {
              console.warn(`[world-chat] validated_status rejected for turn ${turnId}: ${validation.error}`);
            }
          }
        } else {
          const result = await updateWorldEntry(storyId, delta.proposed_entry.entry_id, entryInput);
          if (result.ok) {
            entryWarning = result.warning;
          } else if (result.reason === "confirmed_conflict" && result.conflict) {
            const newConflict: P3PendingConflict = {
              kind: "confirmed_entry",
              entryId: result.conflict.entryId,
              entryName: result.conflict.entryName,
              oldValue: result.conflict.oldValue,
              newValue: result.conflict.newValue,
              ts: new Date().toISOString(),
            };
            pendingConflictForResponse = newConflict;
            await setP3PendingConflict(storyId, newConflict);
          } else {
            console.warn(`[world-chat] proposed_entry update rejected for turn ${turnId}: ${result.error}`);
          }
          if (result.ok && delta.validated_status !== null) {
            const validation = await updateWorldEntry(storyId, delta.proposed_entry.entry_id, {
              status: delta.validated_status,
            });
            if (validation.ok) {
              entryWarning = validation.warning;
            } else {
              console.warn(`[world-chat] validated_status rejected for turn ${turnId}: ${validation.error}`);
            }
          }
        }
      }
    } catch (stage3Err) {
      console.warn(`[world-chat] Stage 3 lock/entry persistence failed for turn ${turnId}:`, stage3Err);
    }

    return NextResponse.json({
      reply: finalReply,
      context: finalContext,
      current_stage: delta.current_stage,
      p3: p3ForResponse,
      entryWarning,
      pendingConflict: pendingConflictForResponse,
      cascadeReview,
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
