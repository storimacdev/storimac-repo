import { randomUUID } from "crypto";
import { getElement, listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonElement, CanonStatus } from "@/lib/canonEngine/types";
import { deriveEntryId } from "./worldEntryId";
import {
  checkImportanceDepthMismatch,
  type EntryImportance,
  type EntryDepth,
  type WorldEntryValue,
  type OutstandingQuestion,
  type ImportanceDepthCheck,
} from "./worldEntry";

/**
 * The Universal World Entry Model's store-layer logic - extracted from
 * entries/route.ts (issue #42) so issue #43's chat-turn handler can call
 * the exact same create/update logic (including the Confirmed-value
 * guard) a direct API call gets. The Character Bible gate stays at the
 * caller level (route.ts / world-chat/route.ts), not here - it needs
 * `story.p2`, already available to both callers before this point.
 */

export function toApiEntry(element: CanonElement) {
  return {
    entryId: element.element_id,
    status: element.status === "Parked" ? "Deferred" : element.status,
    value: element.value as WorldEntryValue,
    dependsOn: element.depends_on,
  };
}

export interface CreateWorldEntryInput {
  name: string;
  category: string;
  narrativeRole: string;
  importance: EntryImportance;
  depth: EntryDepth;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions?: OutstandingQuestion[];
  dependsOn?: string[];
}

export async function createWorldEntry(
  storyId: string,
  input: CreateWorldEntryInput
): Promise<{ element: CanonElement; warning: ImportanceDepthCheck }> {
  const existing = await listElements(storyId, WORLD_ENTRIES_COLLECTION);
  const existingIds = new Set(existing.map((e) => e.element_id));
  const entryId = deriveEntryId(input.name, existingIds);

  const value: WorldEntryValue = {
    name: input.name.trim(),
    category: input.category.trim(),
    narrativeRole: input.narrativeRole,
    importance: input.importance,
    depth: input.depth,
    functionalDescription: input.functionalDescription,
    governingRules: input.governingRules,
    outstandingQuestions: input.outstandingQuestions ?? [],
  };

  const element = await upsertElement(
    storyId,
    entryId,
    { status: "Exploring", value, depends_on: input.dependsOn ?? [] },
    randomUUID(),
    false,
    WORLD_ENTRIES_COLLECTION
  );

  return { element, warning: checkImportanceDepthMismatch(value.importance, value.depth) };
}

export interface UpdateWorldEntryInput {
  name?: string;
  category?: string;
  narrativeRole?: string;
  importance?: EntryImportance;
  depth?: EntryDepth;
  functionalDescription?: string;
  governingRules?: string;
  outstandingQuestions?: OutstandingQuestion[];
  dependsOn?: string[];
  status?: "Exploring" | "Working" | "Confirmed" | "Deferred";
}

export type UpdateWorldEntryResult =
  | { ok: true; element: CanonElement; warning: ImportanceDepthCheck }
  | { ok: false; error: string };

export async function updateWorldEntry(
  storyId: string,
  entryId: string,
  input: UpdateWorldEntryInput
): Promise<UpdateWorldEntryResult> {
  const existing = await getElement(storyId, entryId, WORLD_ENTRIES_COLLECTION);
  if (!existing) {
    return { ok: false, error: "World Entry not found." };
  }

  const valueFieldsPresent =
    input.name !== undefined ||
    input.category !== undefined ||
    input.narrativeRole !== undefined ||
    input.importance !== undefined ||
    input.depth !== undefined ||
    input.functionalDescription !== undefined ||
    input.governingRules !== undefined ||
    input.outstandingQuestions !== undefined;
  const leavingConfirmed = input.status !== undefined && input.status !== "Confirmed";
  if (existing.status === "Confirmed" && valueFieldsPresent && !leavingConfirmed) {
    return {
      ok: false,
      error:
        "This entry is Confirmed canon. Change its status away from Confirmed before editing its content (Conflict Resolution for Confirmed canon isn't available yet - issue #47).",
    };
  }

  const currentValue = existing.value as WorldEntryValue;
  const nextValue: WorldEntryValue = {
    ...currentValue,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.narrativeRole !== undefined ? { narrativeRole: input.narrativeRole } : {}),
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
    ...(input.depth !== undefined ? { depth: input.depth } : {}),
    ...(input.functionalDescription !== undefined ? { functionalDescription: input.functionalDescription } : {}),
    ...(input.governingRules !== undefined ? { governingRules: input.governingRules } : {}),
    ...(input.outstandingQuestions !== undefined ? { outstandingQuestions: input.outstandingQuestions } : {}),
  };

  const patch: { value: WorldEntryValue; depends_on?: string[]; status?: CanonStatus } = { value: nextValue };

  if (input.dependsOn !== undefined) {
    patch.depends_on = input.dependsOn;
  }

  if (input.status !== undefined) {
    const nextStatus: CanonStatus = input.status === "Deferred" ? "Parked" : input.status;
    if (!isValidTransition(existing.status, nextStatus)) {
      const currentLabel = existing.status === "Parked" ? "Deferred" : existing.status;
      return { ok: false, error: `Can't change status from ${currentLabel} to ${input.status}.` };
    }
    patch.status = nextStatus;
  }

  const element = await upsertElement(storyId, entryId, patch, randomUUID(), true, WORLD_ENTRIES_COLLECTION);

  return { ok: true, element, warning: checkImportanceDepthMismatch(nextValue.importance, nextValue.depth) };
}
