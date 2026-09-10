import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import type { CanonElement } from "@/lib/canonEngine/types";
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
