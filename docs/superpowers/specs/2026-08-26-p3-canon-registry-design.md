# P3 Canon Registry — Data Model & State Machine — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-26

## Problem

GitHub issue #41 (P3 Phase 1). Acceptance criteria:
- Every world element and world-shaping decision carries one of: `Exploring`, `Working`, `Confirmed`, `Deferred`.
- State transitions happen only via explicit author action (button/command) — never inferred silently from conversational tone.
- No guardrail automation yet in this phase — state changes are manual, matching Phase 1 scope.

The issue's own architecture note (2026-07-23) directs implementing this by configuring the shared Canon Engine's `CanonElement` state machine and `StructuredDeltaExtractor` — not as an independent registry — the same way Project 2 configures it via its own Firestore subcollection.

## Decisions (confirmed during brainstorming, 2026-08-26)

1. **Scope: attach canon status to the existing Pillars from #40, not a standalone registry.** Right now Pillars (plain strings, `p3.pillars`) are the only "world elements" that exist anywhere in the app. Richer entries (Name, Category, Functional Description, Systemic Relationships, etc.) don't exist until #42 defines that schema, and #43 (a later phase) is what actually drives creating them through the chat interview. Building a separate, standalone "register an arbitrary named element" UI now would be speculative and likely reworked once #42 lands — confirmed with the user directly, choosing to wire the state machine to real, already-existing data instead.
2. **No new store logic.** `canonStore.ts`'s `getElement`/`listElements`/`upsertElement`/`applyStateDelta` are already generic over a `collection` parameter (this is exactly how Project 2 shares the same store for its `characterFacts` subcollection). Project 3 gets its own constant, `WORLD_ELEMENTS_COLLECTION = "worldElements"`, and calls the same functions — no new state-machine code.
3. **Elements are created lazily.** A pillar has no backing `CanonElement` document until the author explicitly sets its status for the first time. Until then, the UI treats it as an implicit `"Exploring"` default — the same `?? "Exploring"` fallback already used in `CanonPanel.tsx` (issue #11).
4. **A pillar's element ID is a deterministic slug of its name**, not a random ID: `pillarElementId(name)` → `"pillar-" + slug` (e.g. `"Geography"` → `"pillar-geography"`). This lets both the server and the client independently derive the same ID from a pillar name with no round trip, at the cost of an accepted, documented Phase-1 limitation: renaming a pillar orphans its old canon element (a fresh one starts at Exploring under the new slug). Two pillars whose names slugify to the same value would collide — also accepted as an unvalidated edge case for this phase, consistent with #40 not validating pillar name uniqueness either.
5. **Wire vocabulary uses "Deferred," translated to the shared type's internal `"Parked"` at the API boundary** — the exact convention already established between `character-chat/route.ts` and the shared store (`u.state === "Deferred" ? "Parked" : u.state`). `CanonStatus` itself (`"Exploring" | "Working" | "Confirmed" | "Parked"`) is untouched; no new status type is introduced.
6. **`allowConfirmedOverride: true` is passed unconditionally on every call from the new route.** That flag exists to prevent a model's structured turn output from silently rewriting a Confirmed element without going through Conflict Resolution — it is not meant to block the author's own deliberate action, and every call to this route is, by construction, exactly that (an explicit button click, never inferred). The shared transition table (`transitions.ts`) still applies underneath regardless of this flag: a Confirmed element's only valid next state is Parked/Deferred — Working/Exploring are structurally rejected by `isValidTransition` even with the override — so a client bug still cannot produce a nonsensical downgrade.
7. **The route pre-validates the transition itself** (fetch the current element, check `isValidTransition(current, next)`, return a clean 400 on failure) rather than letting `canonStore`'s internal `Error` throw surface through `errorResponse` as an undifferentiated 500. `errorResponse` has no case for `CanonConflictError` or a plain transition-error today; this route avoids ever needing one by checking first.
8. **The UI computes which next-statuses to even offer using the existing, pure `isValidTransition()`** (`web/src/lib/canonEngine/transitions.ts` — it imports only a type, no server-only code, so it's safe to import directly into a client component) rather than duplicating the transition table. A Confirmed pillar's control therefore only ever offers "Deferred," matching Decision 6's constraint automatically.
9. **Downgrading a Confirmed pillar to Deferred shows a `window.confirm` warning first**, mirroring the WCL control's already-established warning-on-change pattern from #39. No warning for any other transition.
10. **Read path**: extend the existing canvases GET route with `includeWorldElements`/`worldElements`, an exact parallel to the `includeWorldMessages` pattern from #38 (a gated, opt-in fetch, not the always-on `elements` field that route already returns for Project 1's own default collection).

## Architecture

### `web/src/lib/worldEngine/pillarElementId.ts` (new)

```ts
/** Deterministic Canon Element id for a Pillar, derived from its name -
 * lets both server and client compute the same id with no round trip.
 * Renaming a pillar orphans its old element (a fresh one starts at
 * Exploring under the new slug) - an accepted Phase-1 limitation, issue
 * #41. */
export function pillarElementId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `pillar-${slug || "unnamed"}`;
}
```

### `web/src/lib/canonEngine/canonStore.ts` (extended)

Add, alongside the existing `CHARACTER_FACTS_COLLECTION`:

```ts
/** Project 3's canon-element subcollection name (issue #41) - a sibling
 * to CHARACTER_FACTS_COLLECTION, sharing the same store/transition logic
 * via the existing `collection` parameter on every function below. */
export const WORLD_ELEMENTS_COLLECTION = "worldElements";
```

No other change to this file — `getElement`, `listElements`, and `upsertElement` are already generic over `collection`.

### `web/src/app/api/world-chat/canon-status/route.ts` (new, `PATCH`)

Same auth pattern as every other route (`requireUser` → `getStory` 404 → `getMembership` 403). Body: `{ storyId: string, elementId: string, status: "Exploring" | "Working" | "Confirmed" | "Deferred" }`.

```ts
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
```

### `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (extended)

Add `includeWorldElements`/`worldElements`, mirroring the existing `includeWorldMessages`/`worldMessages` pair exactly:

```ts
const includeWorldElements = req.nextUrl.searchParams.get("worldElements") === "1";
...
const [elements, messages, characterMessages, worldMessages, worldElements, guardrailFlags] = await Promise.all([
  listElements(canvasId),
  listMessages(canvasId),
  includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
  includeWorldMessages ? listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION) : Promise.resolve([]),
  includeWorldElements ? listElements(canvasId, WORLD_ELEMENTS_COLLECTION) : Promise.resolve([]),
  listGuardrailFlags(canvasId),
]);
...
return NextResponse.json({
  story: { ...story, p3: normalizeP3(story.p3) },
  elements,
  messages,
  characterMessages,
  worldMessages,
  worldElements,
  guardrailFlags,
});
```

`WorldInterview.tsx` requests `?worldElements=1` alongside its existing `?worldMessages=1`.

### `web/src/components/WorldInterview.tsx` (extended)

New state: `elementStatuses: Record<string, CanonStatus>` (keyed by `pillarElementId(name)`), populated from `worldElements` on resume and updated locally after each successful status-change PATCH. A new small `<select>` control renders next to each pillar row in the existing list-editor panel (from #40):

- Options are computed via `isValidTransition(currentStatus, candidate)` filtered over all four statuses (excluding the current one), so a Confirmed pillar's control only ever offers "Deferred."
- Selecting a new status PATCHes `/api/world-chat/canon-status` with `{ storyId, elementId: pillarElementId(name), status }`. If the current status is `"Confirmed"`, a `window.confirm` warning appears first (mirroring the WCL control), for any other transition it applies immediately.
- The control is disabled during `pillarsUpdating || loading`, consistent with every other control in this panel.
- A small status badge shows next to each pillar name at all times, not just while the select is open, using its own local color mapping (`Exploring`/`Working`/`Confirmed`/`Deferred`) defined directly in `WorldInterview.tsx` — not imported from `CanonPanel.tsx`, which is a P1-specific, read-only component with no exported style map and its own different status-display conventions (it shows the raw "Parked" label, not "Deferred").

## Error Handling

Every validation failure (missing/malformed body fields, an invalid transition) returns a clean 400 with a specific message — never a raw 500 from deep inside `canonStore`. Auth/membership/story-not-found follow the exact same pattern as every other route in this app. A failed PATCH reuses the existing shared error banner in `WorldInterview.tsx`.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A fresh pillar with no backing element shows an "Exploring" badge and offers Working/Confirmed/Deferred as its next-status options.
- Moving a pillar to Confirmed, then attempting to select a different status, offers only "Deferred."
- Selecting Deferred from Confirmed triggers the `window.confirm` warning; canceling leaves the status unchanged.
- Any other transition (e.g. Exploring → Working) applies immediately with no warning.
- A resumed session correctly shows each pillar's last-set status, including a pillar that was never touched (implicit Exploring, no Firestore doc).
- The route rejects a malformed `status` value and a structurally invalid transition (e.g. attempting `Confirmed → Working` directly via a raw request) with a 400, not a crash.
