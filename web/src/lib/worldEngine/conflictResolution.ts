import { getElement, listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { appendOutstandingQuestions, appendP3ConflictLog, type P3PendingConflict } from "@/lib/canonEngine/storyStore";
import type { WorldEntryValue } from "./worldEntry";

/**
 * Project 3's Conflict Resolution Protocol (issue #47) - a fresh,
 * P3-local module, not a call-through to canonEngine/conflictResolution.ts
 * (issue #10's reference implementation). Investigated first: Project 2
 * doesn't call that module either - it forked its own
 * (characterEngine/foundationConflict.ts) because Foundation-prose
 * contradiction has no deterministic detection, and P1's version is
 * hardcoded to the "elements" collection anyway. This module follows
 * P2's precedent (a bespoke fork, P3's own vocabulary) rather than P1's
 * literal functions. See the design doc
 * (docs/superpowers/specs/2026-09-11-p3-conflict-resolution-design.md)
 * for the full reasoning, including why "Revise" means something
 * different for each of the two conflict kinds (the Foundation is
 * immutable; a Confirmed World Entry is not).
 */

export function buildConflictContextMessage(conflict: P3PendingConflict): string {
  const description =
    conflict.kind === "confirmed_entry"
      ? `The proposed change to "${conflict.entryName}" contradicts its Confirmed canon.`
      : conflict.description;
  const revisePhrase =
    conflict.kind === "confirmed_entry"
      ? "Revise the existing canon to match the new idea (this may affect other entries that depend on it)"
      : "Accept the new idea as the working position going forward";
  return `\n\n[CONFLICT DETECTED - internal grounding only, never narrate this raw data to the author. ${description} Present the author with exactly three choices in your reply, in your own words: (A) Revert the new idea and keep things as they are, (B) ${revisePhrase}, (C) Defer the decision for now and note it as an outstanding question. Once the author clearly picks one, set resolution to "revert", "revise", or "defer" on your next structured output - do not act on any Stage 3 proposal until this is resolved.]`;
}

/**
 * Every Confirmed World Entry whose depends_on includes entryId - AC-(B)'s
 * Dependency Review. A direct, P3-scoped in-memory filter over
 * listElements(WORLD_ENTRIES_COLLECTION), not the shared
 * canonStore.ts#listDependents (hardcoded to the "elements" collection;
 * generalizing that is issue #48's job, tracked separately - see the
 * design doc's Global Constraints).
 */
export async function computeCascadeReview(
  storyId: string,
  entryId: string
): Promise<{ entryId: string; name: string }[]> {
  const allEntries = await listElements(storyId, WORLD_ENTRIES_COLLECTION);
  return allEntries
    .filter((e) => e.status === "Confirmed" && (e.depends_on ?? []).includes(entryId))
    .map((e) => ({ entryId: e.element_id, name: (e.value as WorldEntryValue | undefined)?.name ?? e.element_id }));
}

export interface ResolveP3ConflictParams {
  storyId: string;
  conflict: P3PendingConflict;
  resolution: "revert" | "revise" | "defer";
  turnId: string;
  resolvedBy: string;
}

export interface ResolveP3ConflictResult {
  cascadeReview: { entryId: string; name: string }[] | null;
}

export async function resolveP3Conflict(params: ResolveP3ConflictParams): Promise<ResolveP3ConflictResult> {
  const { storyId, conflict, resolution, turnId, resolvedBy } = params;
  let cascadeReview: { entryId: string; name: string }[] | null = null;

  if (resolution === "revise" && conflict.kind === "confirmed_entry") {
    // The entry IS mutable canon - write the proposed new value directly
    // via upsertElement (bypassing updateWorldEntry's guard entirely,
    // which is exactly what that guard's own comment reserves this flow
    // for), keeping status Confirmed, then show what else depends on it.
    await upsertElement(
      storyId,
      conflict.entryId,
      { value: conflict.newValue as WorldEntryValue, status: "Confirmed" },
      turnId,
      true,
      WORLD_ENTRIES_COLLECTION
    );
    cascadeReview = await computeCascadeReview(storyId, conflict.entryId);
  } else if (resolution === "defer" && conflict.kind === "confirmed_entry") {
    const existing = await getElement(storyId, conflict.entryId, WORLD_ENTRIES_COLLECTION);
    if (existing) {
      const currentValue = existing.value as WorldEntryValue;
      const updatedValue: WorldEntryValue = {
        ...currentValue,
        outstandingQuestions: [
          ...(currentValue.outstandingQuestions ?? []),
          {
            item: "Conflicting idea deferred",
            notes: `A proposed change to "${conflict.entryName}" was deferred rather than applied - see the conflict log for the original proposal.`,
          },
        ],
      };
      await upsertElement(storyId, conflict.entryId, { value: updatedValue }, turnId, true, WORLD_ENTRIES_COLLECTION);
    }
  } else if (resolution === "defer" && conflict.kind === "foundation") {
    await appendOutstandingQuestions(storyId, [
      { item: conflict.description, defer_to: null, notes: "Deferred via the Conflict Resolution Protocol." },
    ]);
  } else if (resolution === "revise" && conflict.kind === "foundation") {
    // The Foundation itself can't be rewritten (see this module's header
    // comment) - "Revise" here means the new idea proceeds as the World
    // Bible's working position. Without some durable record of that,
    // the unchanged Story Foundation grounding block would keep
    // asserting the contradicted premise on every future turn, and the
    // model (correctly following its own instructions) would eventually
    // re-flag the same already-accepted idea as a fresh conflict (final
    // whole-branch review finding I2). This doesn't fully prevent that
    // (the model isn't shown outstanding questions in its prompt today),
    // but it gives the author a real, visible record of the decision -
    // full re-trigger prevention would need the grounding block itself
    // to carry prior resolutions, tracked as a follow-up.
    await appendOutstandingQuestions(storyId, [
      {
        item: `Accepted despite Foundation tension: ${conflict.description}`,
        defer_to: null,
        notes: "Resolved via the Conflict Resolution Protocol (Revise) - the Story Foundation document itself is unchanged, but this idea is the World Bible's working position going forward.",
      },
    ]);
  }
  // "revert" (either kind) needs no additional write beyond the log below
  // - it keeps existing state untouched by definition.

  await appendP3ConflictLog(storyId, {
    kind: conflict.kind,
    description: conflict.kind === "confirmed_entry" ? `Confirmed entry "${conflict.entryName}"` : conflict.description,
    // Firestore rejects an explicit `undefined` field value unless
    // ignoreUndefinedProperties is set (it isn't, repo-wide) - a
    // conditional spread, not `entryId: ... : undefined`, is required
    // here (final whole-branch review finding C1: the old code threw on
    // every foundation-kind resolution, permanently halting the story).
    ...(conflict.kind === "confirmed_entry"
      ? { entryId: conflict.entryId, oldValue: conflict.oldValue, newValue: conflict.newValue }
      : {}),
    resolution,
    resolvedBy,
    ts: new Date().toISOString(),
    turnId,
  });

  return { cascadeReview };
}
