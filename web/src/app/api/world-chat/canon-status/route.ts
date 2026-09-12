import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory } from "@/lib/canonEngine/storyStore";
import { getElement, upsertElement, listDependents, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonStatus } from "@/lib/canonEngine/types";
import { pillarElementId } from "@/lib/worldEngine/pillarElementId";
import { ingestFoundation as characterIngestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { checkCharacterBibleComplete } from "@/lib/worldEngine/characterBibleGate";

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
    const acknowledged = body?.acknowledged === true;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (typeof elementId !== "string" || !elementId) {
      return NextResponse.json({ error: "Request must include `elementId`." }, { status: 400 });
    }
    if (!/^pillar-[a-z0-9-]+$/.test(elementId)) {
      return NextResponse.json({ error: "`elementId` must be a valid pillar element id." }, { status: 400 });
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

    const characterFoundation = await characterIngestFoundation(storyId);
    if (characterFoundation.status === "ok" || characterFoundation.status === "incomplete") {
      const gate = checkCharacterBibleComplete(characterFoundation.foundation.cast, story.p2);
      if (!gate.complete) {
        return NextResponse.json(
          {
            error: `Finish your Character Bible before continuing the World Bible. Still in progress: ${gate.incompleteNames.join(", ")}.`,
          },
          { status: 400 }
        );
      }
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

    // Dependency Review gate (issue #48, PRD §4.4) - a Confirmed pillar
    // changing status must not commit silently if something else
    // Confirmed depends on it. Unlike issue #47's chat-turn Conflict
    // Resolution protocol, this is a synchronous confirm-then-retry gate,
    // not a model-turn-based one - every call here is already an explicit
    // author button-click (see this file's own long-standing comment
    // above), so there's no model turn to negotiate a choice through.
    if (currentStatus === "Confirmed" && nextStatus !== currentStatus && !acknowledged) {
      const dependents = await listDependents(storyId, elementId, WORLD_ELEMENTS_COLLECTION);
      // No pillar CanonElement ever gets a `value` written (this route and
      // Task 4's dependency writer only ever patch `status`/`depends_on`),
      // so a dependent's display name has to be reconstructed rather than
      // read off `e.value`. pillarElementId is a deterministic function of
      // a pillar's name, so build a reverse (element id -> name) lookup
      // from story.p3's own name lists - `pillars` (author-adopted) and
      // `proposedPillars` (model-proposed) - instead. A dependent whose
      // name isn't in either list (e.g. renamed since, per
      // pillarElementId.ts's documented "renaming orphans the old
      // element" limitation) falls back to its raw element id.
      const knownPillarNames = [...(story.p3?.pillars ?? []), ...(story.p3?.proposedPillars ?? [])];
      const pillarNameById = new Map(knownPillarNames.map((name) => [pillarElementId(name), name]));
      const dependencyReview = dependents
        .filter((e) => e.status === "Confirmed")
        .map((e) => ({ entryId: e.element_id, name: pillarNameById.get(e.element_id) ?? e.element_id }));
      if (dependencyReview.length > 0) {
        return NextResponse.json({ needsAcknowledgment: true, dependencyReview }, { status: 409 });
      }
    }

    const element = await upsertElement(
      storyId,
      elementId,
      { status: nextStatus },
      randomUUID(),
      /* allowConfirmedOverride */ true,
      WORLD_ELEMENTS_COLLECTION
    );

    return NextResponse.json({
      elementId: element.element_id,
      status: element.status === "Parked" ? "Deferred" : element.status,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
