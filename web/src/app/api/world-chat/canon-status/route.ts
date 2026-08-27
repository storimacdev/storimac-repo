import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { getElement, upsertElement, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonStatus } from "@/lib/canonEngine/types";

export const runtime = "nodejs";

/**
 * Sets a World Bible canon element's status - GitHub issue #41. A
 * discrete, non-conversational state mutation (no model call), the same
 * shape as the sibling wcl/route.ts and pillars/route.ts PATCHes.
 * `allowConfirmedOverride` is always true: every call here is by
 * construction an explicit author button-click, which is exactly what
 * that flag exists to permit (it guards against a model silently
 * rewriting a Confirmed element, not against the author's own deliberate
 * action). The shared transition table in transitions.ts still applies
 * underneath regardless: a Confirmed element's only valid next status is
 * Parked/Deferred, checked below before ever calling into the store, so
 * a client bug still can't produce a nonsensical transition.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const elementId: unknown = body?.elementId;
    const status: unknown = body?.status;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof elementId !== "string" || !elementId) {
      return NextResponse.json({ error: "Request must include `elementId`." }, { status: 400 });
    }
    if (status !== "Exploring" && status !== "Working" && status !== "Confirmed" && status !== "Deferred") {
      return NextResponse.json(
        { error: "`status` must be Exploring, Working, Confirmed, or Deferred." },
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

    const nextStatus: CanonStatus = status === "Deferred" ? "Parked" : status;
    const existing = await getElement(storyId, elementId, WORLD_ELEMENTS_COLLECTION);
    const currentStatus: CanonStatus = existing?.status ?? "Exploring";

    if (!isValidTransition(currentStatus, nextStatus)) {
      const currentLabel = currentStatus === "Parked" ? "Deferred" : currentStatus;
      return NextResponse.json(
        { error: `Can't change status from ${currentLabel} to ${status}.` },
        { status: 400 }
      );
    }

    const element = await upsertElement(
      storyId,
      elementId,
      { status: nextStatus },
      randomUUID(),
      /* allowConfirmedOverride */ true
    );

    return NextResponse.json({
      elementId: element.element_id,
      status: element.status === "Parked" ? "Deferred" : element.status,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
