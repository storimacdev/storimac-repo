# P3 Canon Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each World Bible Pillar an explicit `Exploring / Working / Confirmed / Deferred` canon status, set only via an explicit author-controlled UI control, using the existing shared Canon Engine rather than any new state-machine code.

**Architecture:** Add a `WORLD_ELEMENTS_COLLECTION` constant so `canonStore.ts`'s already-generic functions can be reused for Project 3 (the same pattern Project 2 already uses for `CHARACTER_FACTS_COLLECTION`), add a deterministic pillar-name-to-element-id helper, add one new PATCH route that pre-validates the transition and always passes `allowConfirmedOverride: true` (every call is by construction an explicit author action), extend the existing canvases GET route with an opt-in `worldElements` fetch, and add a status badge + select control to each pillar row in the existing list editor.

**Tech Stack:** Next.js API routes, Firebase Admin/Firestore, React (client component). No new dependencies.

## Global Constraints

- No new state-machine code. `getElement`, `listElements`, `upsertElement`, `isValidTransition`, and the `CanonStatus` type are all reused as-is from the existing shared Canon Engine (`web/src/lib/canonEngine/`).
- Wire/UI vocabulary is `"Exploring" | "Working" | "Confirmed" | "Deferred"`. The shared `CanonStatus` type stays `"Exploring" | "Working" | "Confirmed" | "Parked"` — every boundary (the new route, the UI) translates `"Deferred" <-> "Parked"`, matching the exact convention already used in `character-chat/route.ts` (`u.state === "Deferred" ? "Parked" : u.state`).
- The new route always passes `allowConfirmedOverride: true` to `upsertElement` — but pre-validates with `isValidTransition` first and returns a 400 on an invalid transition, rather than letting a plain `Error` from deep inside `canonStore.ts` surface as an undifferentiated 500.
- No automated test framework exists in this repo. Verification for every task is `npm run lint` and `npm run build`, both run from the `web/` directory, plus a manual read-through (and, for the UI task, a manual dev-server check).
- A pillar's canon element ID is always `pillarElementId(name)` — a deterministic slug, never a random ID — computed identically on the client and (implicitly, since the client always sends the ID it computed) the server.

---

### Task 1: Foundational additions — pillar element ID helper and the shared collection name

**Files:**
- Create: `web/src/lib/worldEngine/pillarElementId.ts`
- Modify: `web/src/lib/canonEngine/canonStore.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function pillarElementId(name: string): string` and `export const WORLD_ELEMENTS_COLLECTION = "worldElements"`. Tasks 2, 3, and 4 all import one or both of these.

- [ ] **Step 1: Create the pillar element ID helper**

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

- [ ] **Step 2: Add the `WORLD_ELEMENTS_COLLECTION` constant**

`web/src/lib/canonEngine/canonStore.ts` currently has this block (lines 18-26):

```ts
/** Project 2's per-character fact subcollection name (issue #29) - a
 * sibling to Project 1's default "elements" collection, sharing the same
 * transactional store/status-transition logic via the `collection`
 * parameter added to every function below. */
export const CHARACTER_FACTS_COLLECTION = "characterFacts";

function elementsCollection(storyId: string, collection: string = "elements") {
  return getDb().collection("stories").doc(storyId).collection(collection);
}
```

Insert a new exported constant between the existing `CHARACTER_FACTS_COLLECTION` and the `elementsCollection` function, so the block reads:

```ts
/** Project 2's per-character fact subcollection name (issue #29) - a
 * sibling to Project 1's default "elements" collection, sharing the same
 * transactional store/status-transition logic via the `collection`
 * parameter added to every function below. */
export const CHARACTER_FACTS_COLLECTION = "characterFacts";

/** Project 3's canon-element subcollection name (issue #41) - a sibling
 * to CHARACTER_FACTS_COLLECTION, sharing the same store/transition logic
 * via the existing `collection` parameter on every function below. */
export const WORLD_ELEMENTS_COLLECTION = "worldElements";

function elementsCollection(storyId: string, collection: string = "elements") {
  return getDb().collection("stories").doc(storyId).collection(collection);
}
```

Do not change anything else in this file — `getElement`, `listElements`, and `upsertElement` are already generic over the `collection` parameter and need no modification.

- [ ] **Step 3: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/worldEngine/pillarElementId.ts web/src/lib/canonEngine/canonStore.ts
git commit -m "feat: add pillar element-id helper and worldElements canon collection (#41)"
```

---

### Task 2: Add the canon-status PATCH route

**Files:**
- Create: `web/src/app/api/world-chat/canon-status/route.ts`

**Interfaces:**
- Consumes: `getStory` (from `@/lib/canonEngine/storyStore`); `getElement`, `upsertElement`, `WORLD_ELEMENTS_COLLECTION` (from `@/lib/canonEngine/canonStore`, the last one added in Task 1); `isValidTransition` (from `@/lib/canonEngine/transitions`); `type CanonStatus` (from `@/lib/canonEngine/types`); `requireUser`, `errorResponse`, `getMembership` (existing, same imports every other `world-chat` route already uses).
- Produces: `PATCH /api/world-chat/canon-status` — body `{ storyId: string, elementId: string, status: "Exploring" | "Working" | "Confirmed" | "Deferred" }`, response `{ elementId: string, status: "Exploring" | "Working" | "Confirmed" | "Deferred" }` on success. Consumed by `WorldInterview.tsx` in Task 4.

This route follows the exact same auth/validation/error shape as the sibling `web/src/app/api/world-chat/wcl/route.ts` and `web/src/app/api/world-chat/pillars/route.ts` routes, adapted for a status-transition body.

- [ ] **Step 1: Create the route file**

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
```

- [ ] **Step 2: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/world-chat/canon-status/route.ts
git commit -m "feat: add PATCH /api/world-chat/canon-status for explicit pillar canon-state changes (#41)"
```

---

### Task 3: Expose canon elements on Story Canvas resume

**Files:**
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`

**Interfaces:**
- Consumes: `WORLD_ELEMENTS_COLLECTION` (Task 1), `listElements` (already imported in this file).
- Produces: the resume response's JSON body now includes `worldElements: CanonElement[]` when the request includes `?worldElements=1`. Consumed by `WorldInterview.tsx` in Task 4.

This file's `GET` handler currently reads (in full, lines 26-72):

```ts
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/workspaces/[workspaceId]/canvases/[canvasId]">
) {
  try {
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;
    // Project 1's resume never reads this field - only fetch/include it
    // when the Character Bible client explicitly asks, so P1's canvas load
    // doesn't pay for an unused Firestore read and a larger payload.
    const includeCharacterMessages = req.nextUrl.searchParams.get("characterMessages") === "1";
    // Same reasoning, for the World Bible client (issue #38).
    const includeWorldMessages = req.nextUrl.searchParams.get("worldMessages") === "1";

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    const [elements, messages, characterMessages, worldMessages, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldMessages ? listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION) : Promise.resolve([]),
      listGuardrailFlags(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

    return NextResponse.json({
      story: { ...story, p3: normalizeP3(story.p3) },
      elements,
      messages,
      characterMessages,
      worldMessages,
      guardrailFlags,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 1: Add the `WORLD_ELEMENTS_COLLECTION` import**

Change:

```ts
import { listElements } from "@/lib/canonEngine/canonStore";
```

to:

```ts
import { listElements, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
```

- [ ] **Step 2: Add the `includeWorldElements` flag, fetch, and response field**

Replace the `GET` handler's body (everything between the opening `try {` and the closing `} catch (err) {`) with:

```ts
    const user = await requireUser();
    const { workspaceId, canvasId } = await ctx.params;
    // Project 1's resume never reads this field - only fetch/include it
    // when the Character Bible client explicitly asks, so P1's canvas load
    // doesn't pay for an unused Firestore read and a larger payload.
    const includeCharacterMessages = req.nextUrl.searchParams.get("characterMessages") === "1";
    // Same reasoning, for the World Bible client (issue #38).
    const includeWorldMessages = req.nextUrl.searchParams.get("worldMessages") === "1";
    // Same reasoning, for the World Bible client's per-pillar canon status (issue #41).
    const includeWorldElements = req.nextUrl.searchParams.get("worldElements") === "1";

    const membership = await getMembership(workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const story = await getStory(canvasId);
    if (!story || story.workspaceId !== workspaceId) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }

    const [elements, messages, characterMessages, worldMessages, worldElements, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldMessages ? listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldElements ? listElements(canvasId, WORLD_ELEMENTS_COLLECTION) : Promise.resolve([]),
      listGuardrailFlags(canvasId),
    ]);

    // Track last-visited so "/" and bare "/interview" resume here (issue #90).
    await setLastVisited(user.uid, workspaceId, canvasId);

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

Leave the `PATCH` and `DELETE` handlers in this same file completely unchanged.

- [ ] **Step 3: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts
git commit -m "feat: expose worldElements on Story Canvas resume behind an opt-in flag (#41)"
```

---

### Task 4: Add per-pillar canon-status controls to the World Bible UI

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `pillarElementId` (Task 1), `PATCH /api/world-chat/canon-status` (Task 2), `worldElements` in the resume response (Task 3), `isValidTransition` and `type CanonStatus` (existing shared engine).
- Produces: nothing consumed by a later task — this is the final task.

The current file was read directly from source. The relevant anchors:
- The top-level imports and module-level constants (before the component function).
- State declarations (after `const [newPillarInput, setNewPillarInput] = useState("");`).
- The resume `useEffect` (the one fetching `/api/workspaces/.../canvases/...`).
- The `confirmPillarDraft` function, after which the new status-mutation functions are added.
- The pillar list's `<ul>` inside the pillars panel, specifically the `{pillarDraft.map((name, i) => ( ... ))}` block.

- [ ] **Step 1: Add imports and module-level status helpers**

Find this import line:

```tsx
import { WCL_LABELS, WCL_LEVELS, type WclLevel } from "@/lib/worldEngine/wcl";
```

Add immediately after it:

```tsx
import { pillarElementId } from "@/lib/worldEngine/pillarElementId";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonStatus } from "@/lib/canonEngine/types";
```

Find the `BORDER_GRADIENT` constant:

```tsx
const BORDER_GRADIENT =
  "linear-gradient(135deg, #f87171, #dc2626, #ea580c, #a855f7, #6366f1)";
```

Add immediately after it:

```tsx

type PillarStatus = "Exploring" | "Working" | "Confirmed" | "Deferred";

const PILLAR_STATUSES: PillarStatus[] = ["Exploring", "Working", "Confirmed", "Deferred"];

const STATUS_BADGE_STYLES: Record<PillarStatus, string> = {
  Exploring: "bg-neutral-700 text-neutral-300",
  Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  Deferred: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
};

// The shared Canon Engine's status type uses "Parked"; every P3 boundary
// (this UI, the canon-status route) speaks "Deferred" instead, matching
// the same translation convention already used by character-chat/route.ts.
function toCanonStatus(status: PillarStatus): CanonStatus {
  return status === "Deferred" ? "Parked" : status;
}

function toPillarStatus(status: CanonStatus): PillarStatus {
  return status === "Parked" ? "Deferred" : status;
}
```

- [ ] **Step 2: Add state**

Find this line:

```tsx
  const [newPillarInput, setNewPillarInput] = useState("");
```

Add immediately after it:

```tsx
  const [elementStatuses, setElementStatuses] = useState<Record<string, PillarStatus>>({});
  const [elementStatusUpdating, setElementStatusUpdating] = useState(false);
```

- [ ] **Step 3: Fetch and populate canon statuses on resume**

Find this line inside the resume `useEffect`:

```tsx
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}?worldMessages=1`);
```

Change it to:

```tsx
        const res = await fetch(`/api/workspaces/${workspaceId}/canvases/${canvasId}?worldMessages=1&worldElements=1`);
```

Find this line, later in the same effect:

```tsx
        setWclState((data.story?.p3 as P3State | undefined) ?? null);
```

Add immediately after it:

```tsx
        const rawElements = (data.worldElements ?? []) as { element_id: string; status: CanonStatus }[];
        setElementStatuses(
          Object.fromEntries(rawElements.map((e) => [e.element_id, toPillarStatus(e.status)]))
        );
```

- [ ] **Step 4: Add the status-mutation functions**

Find the `confirmPillarDraft` function:

```tsx
  function confirmPillarDraft() {
    applyPillars(pillarDraft);
  }
```

Add immediately after it:

```tsx

  async function changeElementStatus(elementId: string, nextStatus: PillarStatus) {
    if (!canvasId || elementStatusUpdating) return;
    setElementStatusUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/world-chat/canon-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, elementId, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update that pillar's status.");
        return;
      }
      setElementStatuses((prev) => ({ ...prev, [elementId]: data.status as PillarStatus }));
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setElementStatusUpdating(false);
    }
  }

  function handleElementStatusChange(elementId: string, currentStatus: PillarStatus, nextStatus: PillarStatus) {
    if (currentStatus === "Confirmed" && nextStatus !== currentStatus) {
      const confirmed = window.confirm(
        "This pillar is Confirmed. Deferring it moves it out of active canon. Continue?"
      );
      if (!confirmed) return;
    }
    changeElementStatus(elementId, nextStatus);
  }
```

- [ ] **Step 5: Add the status badge and control to each pillar row**

Find this block:

```tsx
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {pillarDraft.map((name, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 rounded-lg bg-neutral-900/60 px-3 py-1.5 text-[13px] text-neutral-200"
                        >
                          <span className="flex-1">
                            {i + 1}. {name}
                          </span>
                          <button
                            onClick={() => movePillar(i, -1)}
                            disabled={pillarsUpdating || loading || i === 0}
                            className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                            aria-label={`Move ${name} up`}
                          >
                            ▲
                          </button>
                          <button
                            onClick={() => movePillar(i, 1)}
                            disabled={pillarsUpdating || loading || i === pillarDraft.length - 1}
                            className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                            aria-label={`Move ${name} down`}
                          >
                            ▼
                          </button>
                          <button
                            onClick={() => removePillar(i)}
                            disabled={pillarsUpdating || loading}
                            className="rounded px-1.5 text-red-400 hover:text-red-300 disabled:opacity-30"
                            aria-label={`Remove ${name}`}
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                      {pillarDraft.length === 0 && (
                        <li className="text-[13px] text-neutral-500">No pillars yet — add one below.</li>
                      )}
                    </ul>
```

Replace it with:

```tsx
                    <ul className="mt-3 flex flex-col gap-1.5">
                      {pillarDraft.map((name, i) => {
                        const elementId = pillarElementId(name);
                        const status = elementStatuses[elementId] ?? "Exploring";
                        const statusOptions = PILLAR_STATUSES.filter(
                          (candidate) =>
                            candidate !== status &&
                            isValidTransition(toCanonStatus(status), toCanonStatus(candidate))
                        );
                        return (
                          <li
                            key={i}
                            className="flex items-center gap-2 rounded-lg bg-neutral-900/60 px-3 py-1.5 text-[13px] text-neutral-200"
                          >
                            <span className="flex-1">
                              {i + 1}. {name}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${STATUS_BADGE_STYLES[status]}`}
                            >
                              {status}
                            </span>
                            <select
                              value=""
                              disabled={
                                elementStatusUpdating || pillarsUpdating || loading || statusOptions.length === 0
                              }
                              onChange={(e) => {
                                const next = e.target.value as PillarStatus;
                                if (next) handleElementStatusChange(elementId, status, next);
                                e.target.value = "";
                              }}
                              className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-[10px] text-neutral-300 disabled:opacity-30"
                              aria-label={`Change status for ${name}`}
                            >
                              <option value="">→</option>
                              {statusOptions.map((candidate) => (
                                <option key={candidate} value={candidate}>
                                  {candidate}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => movePillar(i, -1)}
                              disabled={pillarsUpdating || loading || i === 0}
                              className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                              aria-label={`Move ${name} up`}
                            >
                              ▲
                            </button>
                            <button
                              onClick={() => movePillar(i, 1)}
                              disabled={pillarsUpdating || loading || i === pillarDraft.length - 1}
                              className="rounded px-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"
                              aria-label={`Move ${name} down`}
                            >
                              ▼
                            </button>
                            <button
                              onClick={() => removePillar(i)}
                              disabled={pillarsUpdating || loading}
                              className="rounded px-1.5 text-red-400 hover:text-red-300 disabled:opacity-30"
                              aria-label={`Remove ${name}`}
                            >
                              ✕
                            </button>
                          </li>
                        );
                      })}
                      {pillarDraft.length === 0 && (
                        <li className="text-[13px] text-neutral-500">No pillars yet — add one below.</li>
                      )}
                    </ul>
```

Leave everything else in this file (the WCL header controls, the Notes card, the `Bubble` component) unchanged.

- [ ] **Step 6: Verify with lint/build**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 7: Manual dev-server verification**

Run from `web/`: `npm run dev`, then in a browser open a World Bible session with at least one pillar already in its working list:
1. Confirm each pillar row shows an "Exploring" badge and a `→` select control.
2. Open the select for one pillar; confirm it offers exactly "Working," "Confirmed," and "Deferred" (all three, since Exploring can reach any of them).
3. Select "Confirmed"; confirm the badge updates to "Confirmed" with no warning dialog, and a PATCH to `/api/world-chat/canon-status` fires (check the network tab).
4. Open that same pillar's select again; confirm it now offers only "Deferred" (Working and Exploring are not offered, since a Confirmed element can only move to Parked/Deferred per `transitions.ts`).
5. Select "Deferred"; confirm a `window.confirm` warning appears before the PATCH fires; canceling leaves the badge on "Confirmed."
6. Confirming the dialog updates the badge to "Deferred."
7. Reload the page (resume the session); confirm every pillar's badge reflects its last-set status, and a pillar that was never touched still shows "Exploring" with no error.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: add per-pillar canon-status controls to the World Bible UI (#41)"
```

---

## Self-Review Notes

- **Spec coverage:** AC1 ("every world element... carries one of Exploring/Working/Confirmed/Deferred") — Tasks 1-4 wire this up for pillars, the only world elements that exist at this point in the build (confirmed scope decision). AC2 ("explicit author action only") — the route never accepts input from a chat turn; every write originates from a UI button/select in Task 4. AC3 ("no guardrail automation") — no conflict-resolution or dependency-graph code is touched or added; `allowConfirmedOverride: true` is a deliberate, documented choice for this exact reason.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `PillarStatus` (Task 4) matches the wire vocabulary the route (Task 2) accepts/returns exactly (`"Exploring" | "Working" | "Confirmed" | "Deferred"`). `pillarElementId` (Task 1) is called identically in Task 4's UI to derive the same IDs the route (Task 2) receives.
- **No new state-machine code**, confirmed: Tasks 1-3 only add a constant, a pure helper function, and wiring — every actual state-transition rule comes from the pre-existing `transitions.ts`/`canonStore.ts`.
