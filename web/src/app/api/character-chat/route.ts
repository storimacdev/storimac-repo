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
  CHARACTER_MESSAGES_COLLECTION,
  setP2State,
  type P2State,
  setP2PendingConflict,
  appendCharacterConflictLog,
  appendOutstandingQuestions,
  type StoredOutstandingQuestion,
  listOutstandingQuestions,
  appendCharacterBibleEntry,
} from "@/lib/canonEngine/storyStore";
import { applyStateDelta, listElements, getElement, CanonConflictError, CHARACTER_FACTS_COLLECTION, type ElementUpdate } from "@/lib/canonEngine/canonStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { computePriorityMatrix } from "@/lib/characterEngine/priorityMatrix";
import { getDepthLabel } from "@/lib/characterEngine/depthLabels";
import { isKnownFieldId, CHARACTER_RELATIONSHIPS_COLLECTION } from "@/lib/characterEngine/factRegistry";
import { resolveCharacterTurn, P2_STAGE_NAMES } from "@/lib/characterEngine/characterFsm";
import { processConflict, buildConflictContextMessage } from "@/lib/characterEngine/foundationConflict";
import {
  claimsTraceability,
  isTraceable,
  isAlreadyConfirmed,
  CHAIN_ENFORCED_FIELDS,
  CHAIN_ROOT_FIELDS,
  ENFORCED_TIERS,
} from "@/lib/characterEngine/causalChain";
import {
  CharacterTurnSchema,
  EMIT_CHARACTER_TURN_TOOL,
  type FactUpdateInput,
  type RelationshipUpdateInput,
} from "@/lib/characterEngine/characterTurnSchema";
import { compileCharacterBibleEntry } from "@/lib/characterEngine/characterBibleCompiler";
import { MAX_CHAR_ID_LENGTH, slugifyCharacterName } from "@/lib/characterEngine/characterId";

export const runtime = "nodejs";

// Bounds the replayed transcript so a long multi-character, multi-stage
// session can't grow the per-turn Anthropic call past the shared
// rate-limit gate's ITPM ceiling (unlike unbounded replay, which can
// eventually make every subsequent turn's estimate permanently exceed the
// ceiling with no in-app recovery). Matches the order of magnitude of
// Project 1's own short-transcript window (contextBudget.ts).
const CHARACTER_MESSAGE_WINDOW = 20;

// current_character is model-emitted free text, not a closed enum (unlike
// P1's element_id) - two turns naming the same character slightly
// differently ("Deva" vs "Deva Okonkwo-Price") would otherwise fragment
// that character's facts across two unrelated charIds. Resolve against the
// Story Foundation's cast list (already loaded in-route) as the source of
// truth: exact match first, then a unique prefix match either direction,
// falling back to raw slugify (logged) only when the cast list can't
// disambiguate - e.g. a character the model introduced that isn't in the
// Foundation yet.
function resolveCharId(currentCharacter: string, cast: { name: string }[], turnId: string): string {
  const normalized = currentCharacter.trim().toLowerCase();
  const exact = cast.find((m) => m.name.trim().toLowerCase() === normalized);
  if (exact) return slugifyCharacterName(exact.name);

  const prefixMatches = cast.filter((m) => {
    const castName = m.name.trim().toLowerCase();
    return castName.startsWith(normalized) || normalized.startsWith(castName);
  });
  if (prefixMatches.length === 1) return slugifyCharacterName(prefixMatches[0].name);

  console.warn(
    `[character-chat] current_character "${currentCharacter}" on turn ${turnId} didn't match a unique cast member (${prefixMatches.length} candidates) - falling back to raw slugify`
  );
  return slugifyCharacterName(currentCharacter);
}

function toFactUpdate(u: FactUpdateInput, charId: string): ElementUpdate {
  const patch: ElementUpdate["patch"] = {};
  if (u.value !== undefined) patch.value = u.value;
  if (u.state !== undefined) patch.status = u.state === "Deferred" ? "Parked" : u.state;
  if (u.rationale !== undefined) patch.rationale = u.rationale;
  if (u.depends_on !== undefined) patch.depends_on = u.depends_on.map((f) => `${charId}.${f}`);
  return { element_id: `${charId}.${u.field}`, patch };
}

// Unlike toFactUpdate, value is always a complete { dynamic, trust_trajectory,
// power_dynamic } object - all three are schema-required together (issue
// #31's design decision: canonStore.ts replaces `value` wholesale, it
// doesn't deep-merge sub-fields, so a partial value here would silently
// drop whichever sub-fields weren't provided).
function toRelationshipUpdate(u: RelationshipUpdateInput, charId: string, withCharId: string): ElementUpdate {
  const patch: ElementUpdate["patch"] = {
    value: { dynamic: u.dynamic, trust_trajectory: u.trust_trajectory, power_dynamic: u.power_dynamic },
  };
  if (u.state !== undefined) patch.status = u.state === "Deferred" ? "Parked" : u.state;
  return { element_id: `${charId}.${withCharId}`, patch };
}

/**
 * The live Character Bible interview turn — issues #26/#27, reference:
 * web/src/app/api/chat/route.ts (Project 1's own turn handler). Issue #26
 * (design: docs/superpowers/specs/2026-08-07-p2-sequential-interview-engine-design.md)
 * added a hard app-level single-active-character lock and app-computed
 * stage clamping via characterFsm.ts's resolveCharacterTurn - still no
 * content-based (fact-completeness) stage-gating or conflict-resolution
 * machinery, since P2 doesn't have a defined required-field vocabulary
 * per stage yet (that's issue #28's job for Stage 2; #30 for conflict
 * resolution).
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
    const rawP2State: P2State = story.p2 ?? { activeCharacterId: null, characterProgress: {} };
    // Self-heals P2 state corrupted by the pre-fix current_character bug
    // above: any characterProgress key longer than a real charId could ever
    // be is dropped (Firestore already rejects writing it back, so leaving
    // it in place would fail every future turn for this Story the same
    // way), and activeCharacterId is cleared if it pointed at one of those
    // dropped entries - otherwise the interview would stay permanently
    // locked to a character that no longer exists in characterProgress.
    const rawCharacterProgress = rawP2State.characterProgress ?? {};
    const corruptedCharIds = Object.keys(rawCharacterProgress).filter((id) => id.length > MAX_CHAR_ID_LENGTH);
    const p2State: P2State =
      corruptedCharIds.length > 0
        ? {
            activeCharacterId: corruptedCharIds.includes(rawP2State.activeCharacterId ?? "")
              ? null
              : rawP2State.activeCharacterId,
            characterProgress: Object.fromEntries(
              Object.entries(rawCharacterProgress).filter(([id]) => !corruptedCharIds.includes(id))
            ),
          }
        : rawP2State;

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

    // Story Spine & Dramatic Engine grounding (issue #30) - the only Story
    // Foundation content the model can check a proposed fact against for
    // contradiction; without this it has nothing to compare to. Scoped to
    // exactly what ingestFoundation.ts already loads (see that file's own
    // scope note on deferred CDRM/prose ingestion).
    const spine = foundation.storySpine;
    const spineLines = [
      `Opening Image: ${spine.opening_image || "(not set)"}`,
      `Inciting Incident: ${spine.inciting_incident || "(not set)"}`,
      `First Turning Point: ${spine.first_turning_point || "(not set)"}`,
      `Midpoint: ${spine.midpoint || "(not set)"}`,
      `Second Turning Point: ${spine.second_turning_point || "(not set)"}`,
      `Climax: ${spine.climax || "(not set)"}`,
      `Closing Image: ${spine.closing_image || "(not set)"}`,
    ].join("\n");
    const engineLines = [
      `Protagonist: ${foundation.dramaticEngine?.protagonist || "(not set)"}`,
      `Antagonistic Force: ${foundation.dramaticEngine?.antagonistic_force || "(not set)"}`,
      `Central Conflict: ${foundation.dramaticEngine?.central_conflict || "(not set)"}`,
      `Primary Stakes: ${foundation.dramaticEngine?.primary_stakes || "(not set)"}`,
      `Transformation Arc: ${foundation.dramaticEngine?.transformation_arc || "(not set)"}`,
    ].join("\n");
    system += `\n\n[Story Foundation grounding (Story Spine + Dramatic Engine) - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Check every proposed Confirmed fact against this for contradiction (conflict_detected).]\nStory Spine:\n${spineLines}\n\nDramatic Engine:\n${engineLines}`;

    // Relationship-graph grounding for ripple-effect checks (issue #31) -
    // injected unconditionally every turn for every character with any
    // characterProgress entry (not just signed-off ones - post-review fix:
    // the character currently being interviewed is by definition
    // in_progress, and excluding them meant the model had no way to see
    // its own already-written relationship entries during Stage 4, risking
    // a silent overwrite with a drifted value recalled from the transcript
    // window instead). Also not conditional on "the character currently
    // being revised": the system prompt is built before the model reveals
    // current_character, so there's no reliable way to know in advance who
    // that will be. Matches this file's existing grounding philosophy
    // (Cast & Priority Matrix, Story Foundation) of injecting broadly and
    // trusting the model to use what's relevant.
    const relationshipGroundedIds = Object.keys(p2State.characterProgress);
    if (relationshipGroundedIds.length > 0) {
      const relationshipElements = await listElements(storyId, CHARACTER_RELATIONSHIPS_COLLECTION);
      const relationshipLines: string[] = [];
      for (const id of relationshipGroundedIds) {
        const progress = p2State.characterProgress[id];
        const entries = relationshipElements.filter((e) => e.element_id.startsWith(`${id}.`));
        const signedOffLabel = progress.status === "signed_off" ? " (signed off - consider ripple effects before revising)" : "";
        if (entries.length === 0) {
          if (progress.status !== "signed_off") continue;
          relationshipLines.push(`- ${progress.characterName}${signedOffLabel}: no relationships recorded yet.`);
          continue;
        }
        const entryLines = entries
          .map((e) => {
            const v = (e.value ?? {}) as { dynamic?: string; trust_trajectory?: string; power_dynamic?: string };
            const otherCharId = e.element_id.slice(id.length + 1);
            const otherName = p2State.characterProgress[otherCharId]?.characterName ?? otherCharId;
            return `  - with ${otherName}: ${v.dynamic ?? "?"} (trust: ${v.trust_trajectory ?? "?"}, power: ${v.power_dynamic ?? "?"})`;
          })
          .join("\n");
        relationshipLines.push(`- ${progress.characterName}${signedOffLabel}:\n${entryLines}`);
      }
      if (relationshipLines.length > 0) {
        system += `\n\n[Relationship Graph - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Consider ripple effects on these relationships before confirming a psychological change to a signed-off character.]\n${relationshipLines.join("\n")}`;
      }
    }

    // Confirmed-facts grounding (issue #36) - the model's only other
    // signal that a fact is already settled is the bounded
    // CHARACTER_MESSAGE_WINDOW replayed transcript, which falls out of
    // scope on a long interview or a resumed session (a fresh, short
    // window). Mirrors the Relationship Graph block immediately above:
    // unconditional injection for every character with a
    // characterProgress entry (reusing the same relationshipGroundedIds
    // array, not recomputed), since current_character isn't known until
    // after this turn's model call - inject broadly and trust the model
    // to use what's relevant. Only Confirmed facts appear; Working/
    // Exploring facts are still legitimately being explored.
    if (relationshipGroundedIds.length > 0) {
      const factElements = await listElements(storyId, CHARACTER_FACTS_COLLECTION);
      const factLines: string[] = [];
      for (const id of relationshipGroundedIds) {
        const progress = p2State.characterProgress[id];
        const confirmed = factElements.filter((e) => e.element_id.startsWith(`${id}.`) && e.status === "Confirmed");
        if (confirmed.length === 0) continue;
        const fieldLines = confirmed
          .map((e) => `  - ${e.element_id.slice(id.length + 1)}: ${typeof e.value === "string" ? e.value : JSON.stringify(e.value)}`)
          .join("\n");
        factLines.push(`- ${progress.characterName}:\n${fieldLines}`);
      }
      if (factLines.length > 0) {
        system += `\n\n[Confirmed Facts So Far - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Do not re-ask about any fact listed here as Confirmed - treat it as already settled and move the interview forward.]\n${factLines.join("\n")}`;
      }
    }

    if (story.p2PendingConflict) {
      system += `\n\n${buildConflictContextMessage(story.p2PendingConflict)}`;
    }

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

    const charId = resolveCharId(delta.current_character, foundation.cast, turnId);
    const wasSignedOffBefore = p2State.characterProgress[charId]?.status === "signed_off";
    const resolution = resolveCharacterTurn(
      p2State,
      charId,
      delta.current_character,
      delta.current_stage,
      delta.character_signed_off,
      delta.switch_override
    );

    if (!resolution.allowed) {
      console.warn(
        `[character-chat] blocked switch attempt to "${delta.current_character}" on turn ${turnId} - locked to "${resolution.activeProgress.characterName}" (no switch_override)`
      );

      const lastActiveMessage = [...recentMessages]
        .reverse()
        .find(
          (m) => m.role === "assistant" && m.current_character === resolution.activeProgress.characterName && m.context !== undefined
        );
      const repeatedQuestion =
        lastActiveMessage?.content ?? "What would you like to explore next for this character?";
      const redirectReply = `Let's finish ${resolution.activeProgress.characterName}'s profile first — we're at Stage ${resolution.activeProgress.stage} (${P2_STAGE_NAMES[resolution.activeProgress.stage]}).\n\n${repeatedQuestion}`;

      await appendMessage(
        storyId,
        {
          role: "assistant",
          content: redirectReply,
          ts: new Date().toISOString(),
          turnId,
          current_character: resolution.activeProgress.characterName,
          current_stage: resolution.activeProgress.stage,
        },
        CHARACTER_MESSAGES_COLLECTION
      );

      return NextResponse.json({
        reply: redirectReply,
        context: "",
        current_character: resolution.activeProgress.characterName,
        current_stage: resolution.activeProgress.stage,
        character_signed_off: false,
      });
    }

    const castIndex = foundation.cast.findIndex((m) => slugifyCharacterName(m.name) === charId);
    const tier = castIndex >= 0 ? matrix[castIndex].tier : null;

    // Roots being confirmed in this same turn's batch - a Firestore read for
    // isTraceable would always miss these (applyStateDelta hasn't persisted
    // the turn's transaction yet), so a correctly-chained same-turn proposal
    // (e.g. core_wound: Confirmed alongside core_flaw: Confirmed,
    // depends_on: ["core_wound"]) needs this to avoid a false downgrade.
    const rootsConfirmedThisTurn = new Set(
      delta.updates.filter((x) => CHAIN_ROOT_FIELDS.includes(x.field) && x.state === "Confirmed").map((x) => x.field)
    );

    const enforcedUpdates: FactUpdateInput[] = [];
    for (const u of delta.updates) {
      if (!isKnownFieldId(u.field)) {
        console.warn(
          `[character-chat] unknown field "${u.field}" on turn ${turnId} - not in the Project 2 canonical registry, writing as-is`
        );
      }

      const enforceChain =
        tier !== null &&
        ENFORCED_TIERS.includes(tier) &&
        CHAIN_ENFORCED_FIELDS.includes(u.field) &&
        u.state === "Confirmed";

      // Never re-litigate an already-settled fact: undoing a Confirmed fact
      // is the separate Conflict Resolution flow's job (#10/#30), not this
      // check's, and applyStateDelta rejects an already-Confirmed element's
      // status change without allowConfirmedOverride - attempting the
      // downgrade here would abort the whole turn's fact batch via the
      // CanonConflictError catch below.
      if (enforceChain && (await isAlreadyConfirmed(storyId, charId, u.field))) {
        enforcedUpdates.push(u);
        continue;
      }

      if (
        enforceChain &&
        !(claimsTraceability(u.depends_on) && (await isTraceable(storyId, charId, u.depends_on, rootsConfirmedThisTurn)))
      ) {
        console.warn(
          `[character-chat] ${u.field} for ${charId} not traceable to a Confirmed Wound/Belief on turn ${turnId} - downgraded Confirmed->Working`
        );
        enforcedUpdates.push({ ...u, state: "Working" });
      } else {
        enforcedUpdates.push(u);
      }
    }

    const alreadyConfirmedFields = new Set<string>();
    for (const u of delta.updates) {
      if (u.state === "Confirmed" && (await isAlreadyConfirmed(storyId, charId, u.field))) {
        alreadyConfirmedFields.add(u.field);
      }
    }

    const pendingConflictBefore = story.p2PendingConflict ?? null;
    const conflictResult = processConflict({
      enforcedUpdates,
      rawUpdates: delta.updates,
      pendingConflict: pendingConflictBefore,
      charId,
      characterName: delta.current_character,
      conflictDetected: delta.conflict_detected,
      conflictDescription: delta.conflict_description,
      resolution: delta.resolution,
      ts: new Date().toISOString(),
      alreadyConfirmedFields,
    });

    let resolvedEnforcedUpdates = conflictResult.enforcedUpdates;
    if (
      conflictResult.resolvedField &&
      tier !== null &&
      ENFORCED_TIERS.includes(tier) &&
      CHAIN_ENFORCED_FIELDS.includes(conflictResult.resolvedField)
    ) {
      const resolvedEntry = resolvedEnforcedUpdates.find((u) => u.field === conflictResult.resolvedField);
      if (
        resolvedEntry &&
        resolvedEntry.state === "Confirmed" &&
        !(claimsTraceability(resolvedEntry.depends_on) && (await isTraceable(storyId, charId, resolvedEntry.depends_on, rootsConfirmedThisTurn)))
      ) {
        console.warn(
          `[character-chat] resolved conflict field "${conflictResult.resolvedField}" for ${charId} still not traceable on turn ${turnId} - downgraded Confirmed->Working`
        );
        resolvedEnforcedUpdates = resolvedEnforcedUpdates.map((u) =>
          u.field === conflictResult.resolvedField ? { ...u, state: "Working" } : u
        );
      }
    }

    const factUpdates = resolvedEnforcedUpdates.map((u) => toFactUpdate(u, charId));
    if (factUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, factUpdates, turnId, CHARACTER_FACTS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying fact updates on turn ${turnId}:`, err.message);
      }
    }

    const relationshipUpdates: ElementUpdate[] = [];
    for (const u of delta.relationship_updates) {
      const withCharId = resolveCharId(u.with, foundation.cast, turnId);
      if (withCharId === charId) {
        console.warn(
          `[character-chat] relationship_updates entry on turn ${turnId} resolves "with" to the current character (${charId}) - skipping`
        );
        continue;
      }
      // Never re-litigate an already-Confirmed relationship: applyStateDelta
      // rejects an already-Confirmed element's status/value change without
      // allowConfirmedOverride, which would abort the whole turn's
      // relationship batch - the same lesson issue #28 already learned for
      // psych facts (see isAlreadyConfirmed above), reapplied here for the
      // relationships collection since that helper is hardcoded to
      // CHARACTER_FACTS_COLLECTION and this issue doesn't touch causalChain.ts.
      const existing = await getElement(storyId, `${charId}.${withCharId}`, CHARACTER_RELATIONSHIPS_COLLECTION);
      if (existing?.status === "Confirmed") {
        console.warn(
          `[character-chat] relationship ${charId}.${withCharId} already Confirmed on turn ${turnId} - skipping to avoid aborting the batch`
        );
        continue;
      }
      relationshipUpdates.push(toRelationshipUpdate(u, charId, withCharId));
    }
    if (relationshipUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, relationshipUpdates, turnId, CHARACTER_RELATIONSHIPS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying relationship updates on turn ${turnId}:`, err.message);
      }
    }

    // Out-of-scope deferrals (issue #32) - reuses Project 1's existing
    // outstanding_questions mechanism as-is (storyStore.ts), since
    // defer_to already supports "Project 3"/"Project 4"/"Project 5" and
    // the subcollection is shared across projects, not P1-specific.
    if (delta.deferred_items.length > 0) {
      const outstandingQuestions: Omit<StoredOutstandingQuestion, "ts">[] = delta.deferred_items.map((d) => ({
        item: d.item,
        defer_to: d.defer_to_project,
        notes: d.notes,
        charId,
      }));
      console.warn(
        `[character-chat] deferred ${outstandingQuestions.length} out-of-scope item(s) on turn ${turnId}: ${outstandingQuestions.map((q) => `${q.item} -> ${q.defer_to}`).join(", ")}`
      );
      await appendOutstandingQuestions(storyId, outstandingQuestions);
    }

    // Stage 6 sign-off compilation (issue #34) - only on a FRESH
    // transition to signed_off this turn (wasSignedOffBefore captured
    // from p2State, the pre-turn snapshot, before resolveCharacterTurn
    // ran). Runs after this turn's own fact/relationship/deferred-item
    // writes above, so a character who confirms their final fact on the
    // same turn they sign off (Stage 6 immediately follows Stage 5) gets
    // a complete entry.
    if (!wasSignedOffBefore && resolution.status === "signed_off") {
      const [characterFacts, characterRelationships, outstandingQuestionsForCompile] = await Promise.all([
        listElements(storyId, CHARACTER_FACTS_COLLECTION),
        listElements(storyId, CHARACTER_RELATIONSHIPS_COLLECTION),
        listOutstandingQuestions(storyId),
      ]);
      const characterNames: Record<string, string> = Object.fromEntries(
        Object.entries(p2State.characterProgress).map(([id, progress]) => [id, progress.characterName])
      );
      const compiled = compileCharacterBibleEntry({
        charId,
        characterName: foundation.cast[castIndex]?.name ?? delta.current_character,
        characterNames,
        storyRole: foundation.cast[castIndex]?.story_role ?? "",
        tier: tier ?? "",
        depthLabel: tier ? getDepthLabel(tier) : "",
        facts: characterFacts,
        relationships: characterRelationships,
        outstandingQuestions: outstandingQuestionsForCompile,
        signedOffAt: new Date().toISOString(),
      });
      const compileResult = await appendCharacterBibleEntry(storyId, compiled);
      if (compileResult.ok) {
        console.warn(`[character-chat] compiled Character Bible entry for ${charId} on turn ${turnId}`);
      } else {
        console.warn(
          `[character-chat] Character Bible entry for ${charId} already exists on turn ${turnId} - not overwritten`
        );
      }
    }

    if (conflictResult.logEntry) {
      console.warn(
        `[character-chat] Story Foundation conflict resolved (${conflictResult.logEntry.resolution}) for ${conflictResult.logEntry.field} on turn ${turnId}`
      );
      await appendCharacterConflictLog(storyId, {
        ...conflictResult.logEntry,
        resolvedBy: user.uid,
        ts: new Date().toISOString(),
        turnId,
      });
      await setP2PendingConflict(storyId, null);
    } else if (!pendingConflictBefore && conflictResult.nextPendingConflict) {
      console.warn(
        `[character-chat] Story Foundation conflict detected for ${conflictResult.nextPendingConflict.field} on turn ${turnId}: ${conflictResult.nextPendingConflict.conflictDescription}`
      );
      await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
    }

    await setP2State(storyId, resolution.nextP2State);

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_character: delta.current_character,
        current_stage: resolution.stage,
      },
      CHARACTER_MESSAGES_COLLECTION
    );
    logTurnHeuristics(delta.reply, delta.context, turnId);

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_character: delta.current_character,
      current_stage: resolution.stage,
      character_signed_off: resolution.status === "signed_off",
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
