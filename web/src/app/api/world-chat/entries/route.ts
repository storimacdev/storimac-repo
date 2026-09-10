import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, type Story } from "@/lib/canonEngine/storyStore";
import type { EntryImportance, EntryDepth, OutstandingQuestion } from "@/lib/worldEngine/worldEntry";
import { ingestFoundation as characterIngestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { checkCharacterBibleComplete } from "@/lib/worldEngine/characterBibleGate";
import { createWorldEntry, updateWorldEntry, toApiEntry } from "@/lib/worldEngine/worldEntryStore";
import { getElement, listElements, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";

export const runtime = "nodejs";

const VALID_IMPORTANCE: EntryImportance[] = ["Critical", "Major", "Supporting", "Minor", "Incidental"];
const VALID_DEPTH: EntryDepth[] = [1, 2, 3, 4, 5];

/**
 * The Universal World Entry Model's CRUD surface - GitHub issue #42.
 * Thin request-parsing wrapper around worldEngine/worldEntryStore.ts's
 * create/update logic (extracted in issue #43 so the chat-turn handler
 * can call the same functions) - this file owns only HTTP-shape
 * concerns: body validation, auth/membership/Character-Bible gating,
 * and translating store results to responses.
 */

async function characterBibleGateError(storyId: string, p2: Story["p2"]): Promise<string | null> {
  const characterFoundation = await characterIngestFoundation(storyId);
  if (characterFoundation.status === "ok" || characterFoundation.status === "incomplete") {
    const gate = checkCharacterBibleComplete(characterFoundation.foundation.cast, p2);
    if (!gate.complete) {
      return `Finish your Character Bible before continuing the World Bible. Still in progress: ${gate.incompleteNames.join(", ")}.`;
    }
  }
  return null;
}

function isValidOutstandingQuestions(value: unknown): value is OutstandingQuestion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (q) => q && typeof q === "object" && typeof (q as OutstandingQuestion).item === "string" && typeof (q as OutstandingQuestion).notes === "string"
    )
  );
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
    const outstandingQuestions: unknown = body?.outstandingQuestions;

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
    if (outstandingQuestions !== undefined && !isValidOutstandingQuestions(outstandingQuestions)) {
      return NextResponse.json(
        { error: "`outstandingQuestions`, if provided, must be an array of `{ item: string, notes: string }`." },
        { status: 400 }
      );
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const gateError = await characterBibleGateError(storyId, story.p2);
    if (gateError) {
      return NextResponse.json({ error: gateError }, { status: 400 });
    }

    const { element, warning } = await createWorldEntry(storyId, {
      name,
      category,
      narrativeRole: typeof narrativeRole === "string" ? narrativeRole : "",
      importance: importance as EntryImportance,
      depth: depth as EntryDepth,
      functionalDescription: typeof functionalDescription === "string" ? functionalDescription : "",
      governingRules: typeof governingRules === "string" ? governingRules : "",
      outstandingQuestions: isValidOutstandingQuestions(outstandingQuestions) ? outstandingQuestions : undefined,
      dependsOn: Array.isArray(dependsOn) ? (dependsOn as string[]) : undefined,
    });

    return NextResponse.json({ entry: toApiEntry(element), warning });
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
    if (body?.outstandingQuestions !== undefined && !isValidOutstandingQuestions(body.outstandingQuestions)) {
      return NextResponse.json(
        { error: "`outstandingQuestions`, if provided, must be an array of `{ item: string, notes: string }`." },
        { status: 400 }
      );
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const gateError = await characterBibleGateError(storyId, story.p2);
    if (gateError) {
      return NextResponse.json({ error: gateError }, { status: 400 });
    }

    const existsCheck = await getElement(storyId, entryId, WORLD_ENTRIES_COLLECTION);
    if (!existsCheck) {
      return NextResponse.json({ error: "World Entry not found." }, { status: 404 });
    }

    const result = await updateWorldEntry(storyId, entryId, {
      ...(typeof body?.name === "string" ? { name: body.name } : {}),
      ...(typeof body?.category === "string" ? { category: body.category } : {}),
      ...(typeof body?.narrativeRole === "string" ? { narrativeRole: body.narrativeRole } : {}),
      ...(body?.importance !== undefined ? { importance: body.importance as EntryImportance } : {}),
      ...(body?.depth !== undefined ? { depth: body.depth as EntryDepth } : {}),
      ...(typeof body?.functionalDescription === "string" ? { functionalDescription: body.functionalDescription } : {}),
      ...(typeof body?.governingRules === "string" ? { governingRules: body.governingRules } : {}),
      ...(isValidOutstandingQuestions(body?.outstandingQuestions) ? { outstandingQuestions: body.outstandingQuestions } : {}),
      ...(Array.isArray(body?.dependsOn) && body.dependsOn.every((d: unknown) => typeof d === "string")
        ? { dependsOn: body.dependsOn as string[] }
        : {}),
      ...(status !== undefined ? { status: status as "Exploring" | "Working" | "Confirmed" | "Deferred" } : {}),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ entry: toApiEntry(result.element), warning: result.warning });
  } catch (err) {
    return errorResponse(err);
  }
}
