import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { getElement, listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonElement, CanonStatus } from "@/lib/canonEngine/types";
import { deriveEntryId } from "@/lib/worldEngine/worldEntryId";
import {
  checkImportanceDepthMismatch,
  type EntryImportance,
  type EntryDepth,
  type WorldEntryValue,
} from "@/lib/worldEngine/worldEntry";

export const runtime = "nodejs";

const VALID_IMPORTANCE: EntryImportance[] = ["Critical", "Major", "Supporting", "Minor", "Incidental"];
const VALID_DEPTH: EntryDepth[] = [1, 2, 3, 4, 5];

/**
 * The Universal World Entry Model's CRUD surface - GitHub issue #42.
 * Entries are plain CanonElement records in WORLD_ENTRIES_COLLECTION
 * (a sibling to WORLD_ELEMENTS_COLLECTION, which stays pillar-status
 * only). Matches canon-status/route.ts's exact conventions: requireUser
 * + getMembership on every call, body-param addressing (no dynamic
 * route segments), Parked/Deferred translation at the API boundary.
 */
function toApiEntry(element: CanonElement) {
  return {
    entryId: element.element_id,
    status: element.status === "Parked" ? "Deferred" : element.status,
    value: element.value as WorldEntryValue,
    dependsOn: element.depends_on,
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const name: unknown = body?.name;
    const category: unknown = body?.category;
    const narrativeRole: unknown = body?.narrativeRole;
    const importance: unknown = body?.importance;
    const depth: unknown = body?.depth;
    const functionalDescription: unknown = body?.functionalDescription;
    const governingRules: unknown = body?.governingRules;
    const dependsOn: unknown = body?.dependsOn;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `name`." }, { status: 400 });
    }
    if (typeof category !== "string" || !category.trim()) {
      return NextResponse.json({ error: "Request must include a non-empty `category`." }, { status: 400 });
    }
    if (!VALID_IMPORTANCE.includes(importance as EntryImportance)) {
      return NextResponse.json(
        { error: `\`importance\` must be one of: ${VALID_IMPORTANCE.join(", ")}.` },
        { status: 400 }
      );
    }
    if (!VALID_DEPTH.includes(depth as EntryDepth)) {
      return NextResponse.json({ error: "`depth` must be an integer 1-5." }, { status: 400 });
    }
    if (dependsOn !== undefined && (!Array.isArray(dependsOn) || !dependsOn.every((d) => typeof d === "string"))) {
      return NextResponse.json({ error: "`dependsOn`, if provided, must be an array of strings." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const existing = await listElements(storyId, WORLD_ENTRIES_COLLECTION);
    const existingIds = new Set(existing.map((e) => e.element_id));
    const entryId = deriveEntryId(name, existingIds);

    const value: WorldEntryValue = {
      name: name.trim(),
      category: category.trim(),
      narrativeRole: typeof narrativeRole === "string" ? narrativeRole : "",
      importance: importance as EntryImportance,
      depth: depth as EntryDepth,
      functionalDescription: typeof functionalDescription === "string" ? functionalDescription : "",
      governingRules: typeof governingRules === "string" ? governingRules : "",
      outstandingQuestions: [],
    };

    const element = await upsertElement(
      storyId,
      entryId,
      {
        status: "Exploring",
        value,
        depends_on: Array.isArray(dependsOn) ? (dependsOn as string[]) : [],
      },
      randomUUID(),
      false,
      WORLD_ENTRIES_COLLECTION
    );

    const mismatch = checkImportanceDepthMismatch(value.importance, value.depth);

    return NextResponse.json({ entry: toApiEntry(element), warning: mismatch });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const storyId = req.nextUrl.searchParams.get("storyId");

    if (!storyId) {
      return NextResponse.json({ error: "Request must include a `storyId` query parameter." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const elements = await listElements(storyId, WORLD_ENTRIES_COLLECTION);
    return NextResponse.json({ entries: elements.map(toApiEntry) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Patches an entry's value fields, `dependsOn`, and/or `status`.
 * Status changes go through `isValidTransition` exactly like
 * canon-status/route.ts does for pillars - `allowConfirmedOverride:
 * true` because every call here is an explicit author/API action, not
 * a model turn, but the transition table still runs first so a client
 * bug can't produce a nonsensical transition.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const entryId: unknown = body?.entryId;
    const status: unknown = body?.status;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof entryId !== "string" || !entryId) {
      return NextResponse.json({ error: "Request must include `entryId`." }, { status: 400 });
    }
    if (
      status !== undefined &&
      status !== "Exploring" &&
      status !== "Working" &&
      status !== "Confirmed" &&
      status !== "Deferred"
    ) {
      return NextResponse.json(
        { error: "`status`, if provided, must be Exploring, Working, Confirmed, or Deferred." },
        { status: 400 }
      );
    }
    if (
      body?.importance !== undefined &&
      !["Critical", "Major", "Supporting", "Minor", "Incidental"].includes(body.importance)
    ) {
      return NextResponse.json({ error: "`importance`, if provided, must be a valid importance value." }, { status: 400 });
    }
    if (body?.depth !== undefined && ![1, 2, 3, 4, 5].includes(body.depth)) {
      return NextResponse.json({ error: "`depth`, if provided, must be an integer 1-5." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const existing = await getElement(storyId, entryId, WORLD_ENTRIES_COLLECTION);
    if (!existing) {
      return NextResponse.json({ error: "World Entry not found." }, { status: 404 });
    }

    const currentValue = existing.value as WorldEntryValue;
    const nextValue: WorldEntryValue = {
      ...currentValue,
      ...(typeof body?.name === "string" ? { name: body.name } : {}),
      ...(typeof body?.category === "string" ? { category: body.category } : {}),
      ...(typeof body?.narrativeRole === "string" ? { narrativeRole: body.narrativeRole } : {}),
      ...(body?.importance !== undefined ? { importance: body.importance as EntryImportance } : {}),
      ...(body?.depth !== undefined ? { depth: body.depth as EntryDepth } : {}),
      ...(typeof body?.functionalDescription === "string" ? { functionalDescription: body.functionalDescription } : {}),
      ...(typeof body?.governingRules === "string" ? { governingRules: body.governingRules } : {}),
    };

    const patch: { value: WorldEntryValue; depends_on?: string[]; status?: CanonStatus } = { value: nextValue };

    if (Array.isArray(body?.dependsOn) && body.dependsOn.every((d: unknown) => typeof d === "string")) {
      patch.depends_on = body.dependsOn;
    }

    if (status !== undefined) {
      const nextStatus: CanonStatus = status === "Deferred" ? "Parked" : status;
      if (!isValidTransition(existing.status, nextStatus)) {
        const currentLabel = existing.status === "Parked" ? "Deferred" : existing.status;
        return NextResponse.json(
          { error: `Can't change status from ${currentLabel} to ${status}.` },
          { status: 400 }
        );
      }
      patch.status = nextStatus;
    }

    const element = await upsertElement(storyId, entryId, patch, randomUUID(), true, WORLD_ENTRIES_COLLECTION);

    const mismatch = checkImportanceDepthMismatch(nextValue.importance, nextValue.depth);

    return NextResponse.json({ entry: toApiEntry(element), warning: mismatch });
  } catch (err) {
    return errorResponse(err);
  }
}
