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
  setP4ActiveStepNumber,
  setP4Units,
  setP4PendingConflict,
  setP4SceneDensityDismissal,
  appendMessage,
  listMessages,
  appendOutstandingQuestions,
  ARCHITECTURE_MESSAGES_COLLECTION,
  type P4PendingConflict,
} from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import {
  buildP4ConflictContextMessage,
  resolveP4Conflict,
  type P4CascadeReviewEntry,
} from "@/lib/storyArchitectureEngine/canonRevision";
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
  setCausalTag,
  setUnitStepNumber,
  type StructuralUnit,
} from "@/lib/storyArchitectureEngine/stateLedger";
import {
  attemptStatusTransition,
  checkPlacementDeviation,
  switchRoute,
  evaluateCausalGate,
  checkSceneRegisterFormat,
  checkStepNumberRequirement,
  type StatusTransitionAttempt,
} from "@/lib/storyArchitectureEngine/developmentLoop";
import {
  computeSceneDensity,
  applySceneDensityDismissal,
  nextSceneDensityDismissal,
  DEFAULT_SCENE_DENSITY_DISMISSAL,
  type SceneDensityResult,
} from "@/lib/storyArchitectureEngine/sceneDensity";

export const runtime = "nodejs";

const ARCHITECTURE_MESSAGE_WINDOW = 20;

// Issue #161 (same class of concern already tracked for character-chat/
// route.ts's Confirmed-facts block, issue #107): truncates one field's
// value to a fixed character budget so a large cast or pillar count
// can't grow this route's per-turn system-prompt token cost
// unboundedly. Mirrors #107's own truncateFactValue exactly (same
// 200-char budget) rather than inventing a different one.
function truncateGroundingValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

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
    // Issue #138: retry/dangling-turn recovery, mirroring world-chat/
    // route.ts's own retryLastTurn pattern (issue #108) - if a prior
    // turn's model call failed after the user's message was already
    // persisted, the resumed history ends in a user message with no
    // reply. A retry re-runs the turn against the already-persisted
    // history instead of appending a new user message.
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

    const turnId = randomUUID();
    if (retry) {
      const lastMessages = await listMessages(storyId, 1, ARCHITECTURE_MESSAGES_COLLECTION);
      if (lastMessages[0]?.role !== "user") {
        return NextResponse.json({ error: "Nothing to retry." }, { status: 409 });
      }
    } else {
      await appendMessage(
        storyId,
        { role: "user", content: userMessage, ts: new Date().toISOString(), turnId },
        ARCHITECTURE_MESSAGES_COLLECTION
      );
    }
    const recentMessages = await listMessages(storyId, ARCHITECTURE_MESSAGE_WINDOW, ARCHITECTURE_MESSAGES_COLLECTION);

    const p4 = normalizeP4(story.p4);
    // Issue #140: `story` was already fetched above - pass it through
    // instead of letting ingestCanon re-fetch the exact same Story doc.
    const canon = await ingestCanon(storyId, story);
    let units = story.p4Units ?? [];
    const pendingConflictBefore = story.p4PendingConflict ?? null;
    const sceneDensityDismissalBefore = story.p4SceneDensityDismissal ?? DEFAULT_SCENE_DENSITY_DISMISSAL;

    let system = getSystemPrompt("sp04-sae-systemprompt.md");

    system += `\n\n[Canon Ingestion Summary - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author.]\n${canon.structuralOverview}`;

    // Cross-project canon detail grounding (issue #64 final whole-branch
    // review finding I1) - computeStructuralOverview only ever gives
    // names/counts, never enough detail for the model to recognize a
    // contradiction (the issue's own test case, changing a Core Wound,
    // was undetectable without this) or for canon_contradiction's
    // contradicted_ref to ever match a real id the Project 3 cascade
    // path (canonRevision.ts's listDependents call) could query.
    if (canon.p2.characters.length > 0) {
      const characterLines = canon.p2.characters.map(
        (c) =>
          `- charId: ${c.charId} | name: ${c.name} | Want: ${truncateGroundingValue(c.want)} | Need: ${truncateGroundingValue(c.need)} | Core Flaw: ${truncateGroundingValue(c.coreFlaw)} | Core Wound: ${truncateGroundingValue(c.coreWound)}`
      );
      system += `\n\n[Signed-Off Character Psychology - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. If a unit's content contradicts one of these already-locked facts, report canon_contradiction with contradicted_ref set to the charId shown here and source_project "Project 2".]\n${characterLines.join("\n")}`;
    }
    if (canon.p3.pillars.length > 0) {
      const pillarLines = canon.p3.pillars.map(
        (p) => `- elementId: ${p.elementId} | name: ${p.name} | value: ${truncateGroundingValue(p.value)}`
      );
      system += `\n\n[Confirmed World Pillars - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. If a unit's content contradicts one of these already-locked facts, report canon_contradiction with contradicted_ref set to the elementId shown here and source_project "Project 3".]\n${pillarLines.join("\n")}`;
    }

    // Structural Units grounding (final whole-branch review finding I1,
    // round 2) - mirrors world-chat/route.ts's own "World Entries So
    // Far" block exactly: the model's only way to reference an existing
    // unit by id in proposed_unit.unit_id, without which unit_id can
    // only ever be null or hallucinated and every continuing/validating
    // turn would create a fresh duplicate unit instead of advancing the
    // one already drafted.
    if (units.length > 0) {
      const unitLines = units.map(
        (u) => `- unit_id: ${u.unitId} | type: ${u.type} | status: ${u.status}`
      );
      system += `\n\n[Structural Units So Far - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. When continuing, revising, or validating any unit listed here, set proposed_unit.unit_id to its id exactly as shown - never invent a new id and never leave unit_id null for a unit that already appears here, or you will create an unwanted duplicate.]\n${unitLines.join("\n")}`;
    }

    // Canon Revision Path grounding (issue #64) - only while a conflict
    // is genuinely open; cleared once resolved (Step 4 below). Shown
    // even while onboarding is incomplete would be impossible anyway -
    // a conflict can only ever be opened after onboarding completes,
    // since both triggers require delta.proposed_unit, which is
    // clamped until then.
    if (pendingConflictBefore) {
      system += buildP4ConflictContextMessage(pendingConflictBefore);
    }

    if (!p4.onboardingComplete) {
      const onboarding = buildOnboardingOutput(canon);
      const checklistLines = onboarding.milestoneChecklist
        .map((item) => `- Step ${item.stepNumber} (${item.title}): ${item.addressable ? "addressable" : "not yet addressable"} - ${item.reason}`)
        .join("\n");
      system += `\n\n[Onboarding Pending - internal grounding only, never narrate this raw data to the author. Present this in your own words per Section 7. Milestone checklist:\n${checklistLines}\nRouting prompt: ${onboarding.routingPrompt}\nDo not develop any structural content until routing_choice is set.]`;
    } else if (p4.routing) {
      system += `\n\n[Current Routing Choice - computed by the app, trust this over re-deriving it. Internal grounding only. The author's current routing choice is "${p4.routing.routingChoice}". Keep reporting this same value unless the author explicitly changes it.]`;
    }

    // Active-step Core Purpose grounding (issue #139 - one of the two
    // design-spec grounding blocks that never made it into the shipped
    // route) - the design spec's own Architecture section lists this as
    // "active-step Core Purpose block when active_step_number is set."
    // Section 2 already gives the model all 10 steps' Core Purpose text
    // verbatim, but this block narrows it to exactly the one step the
    // PRIOR turn reported as the current focus (p4.activeStepNumber,
    // persisted per issue #142), so the Core-Purpose Validation
    // instruction (Section 6) has a single, unambiguous target to check
    // the proposed content against on this turn, rather than requiring
    // the model to re-locate the right step inside Section 2's full
    // 10-step listing every turn.
    if (p4.activeStepNumber !== null) {
      const activeStep = STRUCTURAL_STEPS.find((s) => s.stepNumber === p4.activeStepNumber);
      if (activeStep) {
        system += `\n\n[Active Step Core Purpose - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. The current focus of discussion is Step ${activeStep.stepNumber} (${activeStep.title}). Its Core Purpose, exactly as written in Section 2, is: "${activeStep.corePurpose}" Check any proposed content against this exact Core Purpose before ever reporting validation_result "passed" for it.]`;
      }
    }

    // Issue #110/#139: closing reminder, always the LAST thing appended
    // to `system` on every turn - the second of the two design-spec
    // grounding blocks that never made it into the shipped route.
    // Targets any bracketed grounding block above, whatever it calls
    // itself, rather than enumerating today's block names or exact
    // phrasing, so it stays correct as new blocks are added later
    // without needing an update here. Identical convention to
    // world-chat/route.ts's and character-chat/route.ts's own blocks.
    system += `\n\n[Final reminder - applies to everything above: never name, quote, or describe the title of any bracketed section appended to this prompt at runtime, however it labels itself (for example "[... - computed by the app...]", "[... - internal grounding only...]", "[CANON REVISION PATH...]", or "[Onboarding Pending...]") - by its title or by any other means. Never reference internal framework or document names, issue numbers, FR/PRD identifiers, or other developer/product terminology - except the author-facing product names and on-screen controls this app itself shows the author (for example "Story Foundation Document", "Character Bible", "World Bible", "Project 4", the "Compile" button), which you should keep naming normally when guiding the author. Speak only in your own voice as the persona defined at the top of this prompt - an authoritative creative collaborator, never as a system narrating which of its own documented steps or internal mechanisms it is executing.]`;

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
      maxTokens: 8192,
    });

    let effectiveOnboardingComplete = p4.onboardingComplete;
    let effectiveRouting = p4.routing;
    let effectiveActiveStepNumber = p4.activeStepNumber;
    let effectiveUnit: StructuralUnit | null = null;
    let placementFlag: { flagged: boolean; message: string | null } = { flagged: false, message: null };
    // Never computed (stays null) when proposed_unit was null this turn or
    // was clamped by the pre-existing onboarding backstop below - final
    // whole-branch review finding I2, round 2: the response must be able
    // to distinguish "no status transition was attempted this turn" from
    // "one was attempted and accepted."
    let statusAttempt: StatusTransitionAttempt | null = null;
    let pendingConflictForResponse: P4PendingConflict | null = pendingConflictBefore;
    let cascadeReview: P4CascadeReviewEntry[] | null = null;
    // Defaults to a reading of the PRE-turn units/dismissal state, so a
    // thrown error inside the try block below (caught further down)
    // still leaves the response with the last-known-good reading instead
    // of an empty/zero one - same "effective* defaults to pre-turn state"
    // convention effectiveOnboardingComplete/effectiveRouting already
    // follow above.
    let sceneDensityForResponse: SceneDensityResult = applySceneDensityDismissal(
      computeSceneDensity(units),
      sceneDensityDismissalBefore
    );

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

      // Issue #142: active_step_number had no persisted field anywhere
      // (Story.p4 didn't track it) - a page reload mid-conversation
      // always reset it to null even with an active, ongoing structural
      // discussion. Mirrors the model's self-report verbatim every turn
      // it changes (including back to null), unlike routing/stepNumber,
      // since the author's focus can genuinely move off every step.
      if (delta.active_step_number !== effectiveActiveStepNumber) {
        await setP4ActiveStepNumber(storyId, delta.active_step_number);
        effectiveActiveStepNumber = delta.active_step_number;
      }

      // Structural unit + status transition: clamped to null entirely
      // until onboarding was ALREADY complete before this turn (Decision
      // 2's backstop). Deliberately checks the pre-turn p4.onboardingComplete,
      // not effectiveOnboardingComplete - an ordinary first reply that sets
      // routing_choice and proposes a unit in the same turn must still see
      // the unit clamped, or the author could skip onboarding entirely.
      if (p4.onboardingComplete) {
        // Issue #158 (precedent-consistent, not a new defect): there is
        // no independent check that the author actually made this
        // choice on THIS turn, as opposed to the model prematurely
        // reporting a resolution on the same turn it was only supposed
        // to present the three choices. Identical exposure to
        // world-chat/route.ts's own Conflict Resolution Protocol (issue
        // #47) - filed for visibility given P4's consequence here (unit
        // status/content changes, an outstanding-questions log entry) is
        // heavier than P3's, but not fixed here since the same class of
        // risk is already accepted elsewhere in this codebase.
        if (pendingConflictBefore && delta.resolution !== null) {
          const result = await resolveP4Conflict({
            storyId,
            conflict: pendingConflictBefore,
            resolution: delta.resolution,
            turnId,
            resolvedBy: user.uid,
            units,
            activeStepNumber: delta.active_step_number,
          });
          units = result.units;
          cascadeReview = result.cascadeReview;
          await setP4Units(storyId, units);
          // Persist the clear before updating the in-memory value, same
          // ordering worldEngine/conflictResolution.ts's own resolution
          // flow uses: if setP4PendingConflict throws, the outer catch's
          // console.warn still fires, but pendingConflictForResponse
          // stays at its pre-resolution value rather than telling this
          // turn's response the conflict is resolved while Firestore
          // still shows it open.
          //
          // Issue #157 (precedent-consistent, not a new defect): the
          // writes above (ledger + canon_revision_log, inside
          // resolveP4Conflict) and setP4Units already completed BEFORE
          // this call - if THIS call specifically throws, the ledger
          // keeps the applied change but the conflict stays open in
          // Firestore, so the author's next turn would resolve the same
          // conflict again, producing a duplicate log entry. Same
          // ordering and exposure as world-chat/route.ts's own Conflict
          // Resolution Protocol (issue #47) - tracked, not fixed here,
          // so it isn't silently repeated a third time uninvestigated if
          // a future project forks this pattern again.
          await setP4PendingConflict(storyId, null);
          pendingConflictForResponse = null;
          effectiveUnit = findUnit(units, pendingConflictBefore.unitId);
        } else if (!pendingConflictBefore && delta.proposed_unit) {
          const proposed = delta.proposed_unit;
          const existing = findUnit(units, proposed.unit_id);

          // Issue #154: isValidTransition(Confirmed, Confirmed) is true
          // (the from===to short-circuit), so re-proposing an existing
          // Confirmed unit with materially rewritten content but the
          // SAME requested_status ("Confirmed") previously skipped this
          // trigger entirely and landed in the ordinary-processing
          // branch below, where setUnitContent overwrites unconditionally
          // with no author checkpoint at all - canonEngine/canonStore.ts's
          // own precedent (applyStateDelta) guards changingValue OR
          // changingStatus for a Confirmed element; this only ever
          // guarded the status half. JSON.stringify comparison mirrors
          // that same precedent exactly (existing.content is `unknown` at
          // the type level, even though P4 only ever stores a string).
          const confirmedContentRewrite =
            existing != null &&
            existing.status === "Confirmed" &&
            proposed.requested_status === "Confirmed" &&
            JSON.stringify(existing.content) !== JSON.stringify(proposed.content);

          if (existing && (!isValidTransition(existing.status, proposed.requested_status) || confirmedContentRewrite)) {
            // Final whole-branch review finding M1: a turn can report
            // both a regression AND a canon_contradiction at once - the
            // regression conflict takes priority (it's the deterministic,
            // app-verified one), and the contradiction is dropped for
            // this turn rather than silently folded in. Disclosed, not
            // hidden: it will resurface on its own if the model reports
            // it again on a later turn, once this conflict is resolved.
            if (proposed.canon_contradiction) {
              console.warn(
                `[architecture-chat] unit ${proposed.unit_id} reported both a status regression and a canon_contradiction in turn ${turnId} - the regression conflict takes priority this turn.`
              );
            }
            const newConflict: P4PendingConflict = {
              kind: "unit_regression",
              unitId: existing.unitId,
              type: existing.type,
              requestedStatus: proposed.requested_status,
              requestedContent: proposed.content,
              requestedCanonRefs: proposed.canon_refs,
              ts: new Date().toISOString(),
            };
            await setP4PendingConflict(storyId, newConflict);
            pendingConflictForResponse = newConflict;
          } else if (proposed.canon_contradiction) {
            // Captured at detection time (final whole-branch review
            // finding I2) - see P4PendingConflict's own gatesPassed
            // doc comment in storyStore.ts for why. Includes the Scene
            // Register format check (issue #66's own task review) -
            // without it, a malformed scene (missing slugline, wrong
            // sentence count, fabricated beat tag) could still reach
            // Confirmed via accept_and_update, since that path bypasses
            // the ordinary-processing branch entirely and gatesPassed
            // is the only thing standing between it and Confirmed.
            // Issue #145/#149 (disclosed, not fixed here): this Step-1
            // exemption cross-checks one model-self-reported field
            // (causal_tag: null) against another model-self-reported
            // field (active_step_number === 1), not a value the app
            // independently derives - see evaluateCausalGate's own
            // docstring. A genuine independent check needs a persisted
            // per-unit step/position (issue #149), which doesn't exist
            // yet; bounded today because a misfire only ever surfaces as
            // causalTag "UNVALIDATED" in the compiled document, never as
            // a false "Therefore"/"But" certification.
            const causalGateAtDetection = evaluateCausalGate(
              proposed.requested_status,
              proposed.causal_tag,
              delta.active_step_number,
              proposed.causal_tag_reason
            );
            const formatCheckAtDetection = checkSceneRegisterFormat(proposed.content);
            const coreValidAtDetection = delta.validation_result === "passed";
            // Issue #169 gap 1: Confirmed must not be reachable with a
            // null stepNumber - the value that would actually be
            // written is delta.active_step_number when non-null,
            // otherwise whatever the existing unit already carries
            // (mirroring the ordinary-processing branch's own
            // withContent/setUnitStepNumber conditional below).
            const stepNumberCheckAtDetection = checkStepNumberRequirement(
              proposed.requested_status,
              delta.active_step_number ?? existing?.stepNumber ?? null
            );
            const newConflict: P4PendingConflict = {
              kind: "canon_contradiction",
              unitId: proposed.unit_id,
              type: proposed.type,
              sourceProject: proposed.canon_contradiction.source_project,
              contradictedRef: proposed.canon_contradiction.contradicted_ref,
              explanation: proposed.canon_contradiction.explanation,
              requestedStatus: proposed.requested_status,
              requestedContent: proposed.content,
              requestedCanonRefs: proposed.canon_refs,
              gatesPassed:
                coreValidAtDetection &&
                causalGateAtDetection.ok &&
                formatCheckAtDetection.ok &&
                stepNumberCheckAtDetection.ok,
              ts: new Date().toISOString(),
            };
            await setP4PendingConflict(storyId, newConflict);
            pendingConflictForResponse = newConflict;
          } else {
            const base = existing ?? createUnit(proposed.unit_id, proposed.type);
            const contentApplied = addCanonRefs(setUnitContent(base, proposed.content), proposed.canon_refs);
            // Issue #56: never overwritten with null - a turn with no
            // active step leaves a unit's existing stepNumber untouched,
            // same "never silently downgrade known state" rule
            // setCausalTag already follows for causalTag.
            const withContent =
              delta.active_step_number !== null
                ? setUnitStepNumber(contentApplied, delta.active_step_number)
                : contentApplied;

            const causalGate = evaluateCausalGate(
              proposed.requested_status,
              proposed.causal_tag,
              delta.active_step_number,
              proposed.causal_tag_reason
            );
            const formatCheck = checkSceneRegisterFormat(proposed.content);
            // Issue #169 gap 1: gates Confirmed on withContent's actual
            // stepNumber (the value that will really be written, after
            // the never-overwritten-with-null rule just above) - not
            // delta.active_step_number directly, so a unit that already
            // carries a real stepNumber from an earlier turn isn't
            // wrongly blocked just because THIS turn's active step is
            // null.
            const stepNumberCheck = checkStepNumberRequirement(proposed.requested_status, withContent.stepNumber);
            const coreValid = delta.validation_result === "passed";
            const combinedValid = coreValid && causalGate.ok && formatCheck.ok && stepNumberCheck.ok;
            const combinedReason = !coreValid
              ? delta.validation_reason
              : !causalGate.ok
                ? causalGate.reason
                : !formatCheck.ok
                  ? formatCheck.reason
                  : stepNumberCheck.reason;

            const attempt = attemptStatusTransition(withContent, proposed.requested_status, {
              valid: combinedValid,
              reason: combinedReason,
            });
            statusAttempt = attempt;

            // Causal tag persists independent of the combined gate's outcome -
            // same "update regardless of status outcome" convention
            // setUnitContent/addCanonRefs above already follow, so a unit
            // sitting at Working still records its current best causal read.
            // "And Then" is never persisted as a tag value. When the causal
            // gate itself rejects, the tag resets to "UNVALIDATED" rather
            // than being left untouched - final whole-branch review finding
            // I1: content is always overwritten above regardless of outcome
            // (pre-existing #111 behavior), so leaving a stale "Therefore"
            // from a PRIOR turn's accepted content in place would let this
            // turn's freshly-rejected, coincidence-driven content sit behind
            // an already-Confirmed unit's old causal certification.
            let finalUnit = attempt.unit;
            if (proposed.causal_tag === "Therefore" || proposed.causal_tag === "But") {
              finalUnit = setCausalTag(finalUnit, proposed.causal_tag);
            } else if (!causalGate.ok) {
              finalUnit = setCausalTag(finalUnit, "UNVALIDATED");
            }

            units = upsertUnit(units, finalUnit);
            await setP4Units(storyId, units);
            effectiveUnit = finalUnit;

            if (proposed.proposed_position_percent !== null) {
              const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === delta.active_step_number);
              if (step) {
                placementFlag = checkPlacementDeviation(step, proposed.proposed_position_percent);
              }
            }
          }
        }
      }

      // Issue #56, strictly advisory - computed from `units` in its final
      // state for this turn, after every branch above has had its chance
      // to change it. Never read by anything that gates a status
      // transition; this exists purely to inform the response and persist
      // dismissal-state resets.
      const sceneDensityReading = computeSceneDensity(units);
      const nextDismissal = nextSceneDensityDismissal(sceneDensityReading, sceneDensityDismissalBefore);
      if (
        nextDismissal.under !== sceneDensityDismissalBefore.under ||
        nextDismissal.over !== sceneDensityDismissalBefore.over
      ) {
        await setP4SceneDensityDismissal(storyId, nextDismissal);
      }
      sceneDensityForResponse = applySceneDensityDismissal(sceneDensityReading, nextDismissal);
    } catch (stateErr) {
      console.warn(`[architecture-chat] state update failed for turn ${turnId}:`, stateErr);
    }

    await appendMessage(
      storyId,
      { role: "assistant", content: delta.reply, context: delta.context, ts: new Date().toISOString(), turnId },
      ARCHITECTURE_MESSAGES_COLLECTION
    );

    // Deferred-item persistence (final whole-branch review finding I5,
    // round 2) - mirrors world-chat/route.ts's exact call site and
    // error-handling shape: fires right after the assistant message is
    // persisted, wrapped in its own try/catch that only console.warns on
    // failure, never blocks the response. No charId - P4 has no
    // per-character deferral concept, unlike P2's retrofit.
    if (delta.deferred_items.length > 0) {
      try {
        await appendOutstandingQuestions(
          storyId,
          delta.deferred_items.map((d) => ({
            item: d.item,
            defer_to: d.defer_to_project,
            notes: d.notes,
          }))
        );
      } catch (deferredErr) {
        console.warn(`[architecture-chat] deferred-item logging failed for turn ${turnId}:`, deferredErr);
      }
    }

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      routing_choice: effectiveRouting?.routingChoice ?? null,
      // effectiveActiveStepNumber (issue #142), not delta.active_step_number
      // directly - same "effective* defaults to last-known-good state"
      // convention effectiveOnboardingComplete/effectiveRouting already
      // follow, so a thrown error inside the try block above still
      // leaves the response consistent with what was actually persisted.
      active_step_number: effectiveActiveStepNumber,
      unit: effectiveUnit,
      placementFlag,
      deferredItems: delta.deferred_items,
      validationResult: delta.validation_result,
      // The combined gate's own reason (whichever check actually rejected
      // this turn's Confirmed attempt) - not always delta.validation_reason,
      // which only ever explains Core-Purpose specifically and would be
      // silently wrong when causality was the actual blocker instead.
      validationReason: statusAttempt?.reason ?? delta.validation_reason,
      statusAccepted: statusAttempt?.accepted ?? null,
      pendingConflict: pendingConflictForResponse,
      cascadeReview,
      sceneDensity: sceneDensityForResponse,
      structuralVectorOptions: delta.structural_vector_options,
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
    if (err instanceof Anthropic.APIError) {
      console.error("Anthropic API error:", err);
      return NextResponse.json(
        { error: "The Structural Architect couldn't reach the model. Please try again." },
        { status: 502 }
      );
    }
    return errorResponse(err);
  }
}
