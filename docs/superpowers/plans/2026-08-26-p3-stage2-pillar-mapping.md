# P3 Stage 2 — Assess & Pillar Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the World Development Consultant propose an ordered list of relevant World Pillars from the Story Foundation, and let the author add, remove, or reorder them via an explicit list-editor UI before Stage 3 begins.

**Architecture:** Extend the existing World Bible turn schema with a `proposed_pillars` field (mirroring `proposed_wcl`'s shape exactly), extend `P3State` with a proposal/working-list field split (mirroring the WCL proposal/confirmation split from issue #39), add a disjoint dotted-field-path PATCH route for author edits, and build a list-editor panel in `WorldInterview.tsx` with a pre-adoption local draft phase and a post-adoption live-PATCH-on-every-edit phase.

**Tech Stack:** Next.js API routes, Firebase Admin/Firestore, Zod, `@anthropic-ai/sdk`, React (client component).

## Global Constraints

- No automated test framework exists in this repo. Verification for every task is `npm run lint` and `npm run build`, both run from the `web/` directory, plus a manual read-through (and, for the UI task, a manual dev-server check). Do not invent a test framework or test files.
- Every Firestore write to a `p3` sub-field must use a dotted-field-path `.update()` call touching exactly that one sub-field (e.g. `{ "p3.pillars": pillars }`) — never a whole-object `p3` replace. This is the disjointness pattern that fixed a real race condition in issue #39; it must be preserved and extended, not weakened.
- `P3State.pillars: string[] | null` — `null` means "the author hasn't adopted a working list yet" (only a model proposal may exist); `[]` is a distinct, valid, deliberate "author cleared the list" state. Code must never treat these as equivalent.
- Pillar order is encoded purely by array position. Do not add a separate `priority`/`order` numeric field.
- Do not add a per-pillar `status`/canon-state field. That belongs to a later issue (the Canon Registry).
- Do not modify `web/system-prompts/sp03-wdc-systemprompt.md`. The tool-schema field description alone carries the instruction to the model, matching how `proposed_wcl` is already documented.
- The model string used in `world-chat/route.ts` (`"claude-sonnet-5"`) does not change.

---

### Task 1: Add `proposed_pillars` to the World Bible turn schema

**Files:**
- Modify: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WorldTurnSchema` now includes `proposed_pillars: string[] | null` on its inferred `WorldTurn` type. `EMIT_WORLD_TURN_TOOL`'s JSON schema requires a matching `proposed_pillars` property. Task 3 reads `delta.proposed_pillars` from this type.

This file currently reads (in full):

```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

export const WORLD_STAGE_NAMES: Record<number, string> = {
  1: "Understand",
  2: "Assess & Pillar Mapping",
  3: "Prioritize & Deep Dive",
  4: "System Integration Audit",
  5: "Compile",
};

export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
  proposed_wcl: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
});

export type WorldTurn = z.infer<typeof WorldTurnSchema>;

export const EMIT_WORLD_TURN_TOOL: Anthropic.Tool = {
  name: "emit_world_turn",
  description:
    "Emit your natural-language reply to the author together with your current interview position for this turn. Call this exactly once per turn.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description:
          "The chat-facing reply: your structural assessment, proposed World Complexity Level, and/or discovery questions, as natural conversational prose. Never narrate internal stage bookkeeping here.",
      },
      context: {
        type: "string",
        description:
          "Your internal reasoning for this turn - why you assessed things the way you did, what you noticed, anything relevant to the next turn. Shown to the author separately from chat, never inside reply. Required every turn, even if brief.",
      },
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-5) currently in progress: 1 Understand, 2 Assess & Pillar Mapping, 3 Prioritize & Deep Dive, 4 System Integration Audit, 5 Compile.",
      },
      proposed_wcl: {
        type: ["number", "null"],
        enum: [1, 2, 3, 4, null],
        description:
          "The World Complexity Level (1-4: Minimal/Moderate/Rich/Extensive) you calculated this turn per the Adaptive World Complexity framework, so the app can offer it to the author as a real proposal to confirm or override. Report the level again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't assessed a level yet this turn (e.g. still gathering the Stage 1 basics).",
      },
    },
    required: ["reply", "context", "current_stage", "proposed_wcl"],
  },
};
```

- [ ] **Step 1: Add `proposed_pillars` to `WorldTurnSchema`**

Change:

```ts
export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
  proposed_wcl: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
});
```

to:

```ts
export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
  proposed_wcl: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  proposed_pillars: z.array(z.string().min(1)).nullable(),
});
```

- [ ] **Step 2: Add the matching `proposed_pillars` property to `EMIT_WORLD_TURN_TOOL`**

Change the tool's `properties` object from:

```ts
      proposed_wcl: {
        type: ["number", "null"],
        enum: [1, 2, 3, 4, null],
        description:
          "The World Complexity Level (1-4: Minimal/Moderate/Rich/Extensive) you calculated this turn per the Adaptive World Complexity framework, so the app can offer it to the author as a real proposal to confirm or override. Report the level again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't assessed a level yet this turn (e.g. still gathering the Stage 1 basics).",
      },
    },
    required: ["reply", "context", "current_stage", "proposed_wcl"],
```

to:

```ts
      proposed_wcl: {
        type: ["number", "null"],
        enum: [1, 2, 3, 4, null],
        description:
          "The World Complexity Level (1-4: Minimal/Moderate/Rich/Extensive) you calculated this turn per the Adaptive World Complexity framework, so the app can offer it to the author as a real proposal to confirm or override. Report the level again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't assessed a level yet this turn (e.g. still gathering the Stage 1 basics).",
      },
      proposed_pillars: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "The ordered list of relevant World Pillars you've identified for this world (e.g. Technology, Government & Bureaucracy, Economy, Culture, Geography, Underworld, History), most important first, so the app can offer it to the author as a starting list to confirm, edit, or reorder. Report the list again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't identified a pillar list yet this turn.",
      },
    },
    required: ["reply", "context", "current_stage", "proposed_wcl", "proposed_pillars"],
```

- [ ] **Step 3: Verify**

Run from `web/`: `npm run lint`
Expected: no new errors. `WorldTurn` now infers `proposed_pillars: string[] | null`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add proposed_pillars to the World Bible turn schema (#40)"
```

---

### Task 2: Extend `P3State` with the pillar proposal/working-list split

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `P3State` now includes `proposedPillars: string[] | null` and `pillars: string[] | null`.
  - `export function normalizeP3(p3: P3State | null | undefined): P3State` — returns `p3` with every sub-field defaulted to `null` if absent. Tasks 3 and 4 use this everywhere a route needs "the current p3 state, safe to spread or read."
  - `export async function setP3ProposedPillars(storyId: string, pillars: string[]): Promise<void>` — writes only `"p3.proposedPillars"`.
  - `export async function setP3Pillars(storyId: string, pillars: string[]): Promise<void>` — writes only `"p3.pillars"`.

The current `P3State` interface and its doc comment (lines 63-72) read:

```ts
/** Project 3's World Complexity Level state (issue #39) - a single
 * author-confirmed value per project, not part of the 4-state canon
 * machinery. `proposedWorldComplexityLevel` updates from any turn where
 * the model states a calculated level; `worldComplexityLevel` only
 * changes via the explicit UI confirm/change action
 * (POST /api/world-chat/wcl), never from a turn response directly. */
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
}
```

The existing WCL writer functions (lines 297-320) read:

```ts
/** Updates only Project 3's model-proposed World Complexity Level (issue
 * #39 final-review fix) - a dotted-field-path update so this write and
 * setP3ConfirmedLevel below touch disjoint Firestore fields. A whole-
 * object read-modify-write here previously let a turn's stale `story.p3`
 * snapshot (held across a 10-45s model call) silently overwrite an
 * author's confirmed level if they clicked Confirm while that turn was
 * still in flight - this write can never touch worldComplexityLevel, so
 * it can no longer clobber it no matter how stale the caller's own read
 * was. */
export async function setP3ProposedLevel(storyId: string, level: 1 | 2 | 3 | 4): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.proposedWorldComplexityLevel": level, updatedAt: new Date().toISOString() });
}

/** Updates only Project 3's author-confirmed World Complexity Level
 * (issue #39 final-review fix) - the counterpart to setP3ProposedLevel
 * above, keeping the two writers' fields disjoint so neither can clobber
 * the other regardless of which one reads a stale snapshot first. */
export async function setP3ConfirmedLevel(storyId: string, level: 1 | 2 | 3 | 4): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.worldComplexityLevel": level, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 1: Extend `P3State` and its doc comment**

Replace the block quoted above (interface + doc comment) with:

```ts
/** Project 3's World Complexity Level and Pillar list state (issues #39,
 * #40) - not part of the 4-state canon machinery. `proposedWorldComplexityLevel`
 * and `proposedPillars` update from any turn where the model reports a
 * value; `worldComplexityLevel` and `pillars` only change via an explicit
 * author action (PATCH /api/world-chat/wcl, PATCH /api/world-chat/pillars),
 * never from a turn response directly. `pillars: null` means the author
 * hasn't adopted a working list yet; `pillars: []` is a distinct,
 * deliberate "cleared it out" state - never conflate the two. */
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  proposedPillars: string[] | null;
  pillars: string[] | null;
}

/** Fills in `null` defaults for any P3 sub-field missing from a Story
 * doc written before that sub-field existed (Firestore has no schema, so
 * an old doc simply lacks the key rather than storing it as null) -
 * every route that needs "the current p3 state, safe to read or spread"
 * should go through this rather than hand-writing a defaults literal. */
export function normalizeP3(p3: P3State | null | undefined): P3State {
  return {
    proposedWorldComplexityLevel: null,
    worldComplexityLevel: null,
    proposedPillars: null,
    pillars: null,
    ...p3,
  };
}
```

- [ ] **Step 2: Add the two pillar writer functions**

Immediately after `setP3ConfirmedLevel` (the block quoted above), add:

```ts

/** Updates only Project 3's model-proposed pillar list (issue #40) - a
 * dotted-field-path update, same disjointness reasoning as
 * setP3ProposedLevel: this write can never touch `pillars`, so it can't
 * clobber an author's already-adopted working list no matter how stale
 * this call's own read of `story.p3` was. */
export async function setP3ProposedPillars(storyId: string, pillars: string[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.proposedPillars": pillars, updatedAt: new Date().toISOString() });
}

/** Updates only Project 3's author-adopted pillar list (issue #40) - the
 * counterpart to setP3ProposedPillars above, keeping the two writers'
 * fields disjoint. */
export async function setP3Pillars(storyId: string, pillars: string[]): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.pillars": pillars, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 3: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: the build will show type errors in `web/src/app/api/world-chat/wcl/route.ts` and `web/src/app/api/world-chat/route.ts` — both construct a `P3State` default literal that's now missing `proposedPillars`/`pillars`. This is expected; Task 3 fixes both. Confirm the errors are exactly those two call sites and nothing else in this file.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: extend P3State with pillar proposal/working-list fields (#40)"
```

---

### Task 3: Wire pillar proposals into the turn pipeline; fix legacy-default construction in both existing P3 routes

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`
- Modify: `web/src/app/api/world-chat/wcl/route.ts`

**Interfaces:**
- Consumes: `WorldTurn.proposed_pillars` (Task 1), `setP3ProposedPillars`, `normalizeP3` (Task 2).
- Produces: the turn response's `p3` object now includes `proposedPillars`/`pillars`, consumed by `WorldInterview.tsx` in Task 5.

`web/src/app/api/world-chat/route.ts` currently imports (lines 8-15):

```ts
import {
  getStory,
  appendMessage,
  listMessages,
  setP3ProposedLevel,
  type P3State,
  WORLD_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
```

and its WCL-tracking block (lines 151-163) currently reads:

```ts
    // World Complexity Level proposal tracking (issue #39, final-review
    // fix) - only the proposed field is ever written here, via a
    // dotted-field-path update (setP3ProposedLevel) so this write can
    // never clobber a confirmed value set concurrently by
    // PATCH /api/world-chat/wcl while this turn's model call was in
    // flight. proposed_wcl is now typed as the literal union 1|2|3|4|null
    // directly by WorldTurnSchema (a Zod union of literals, not a ranged
    // .number()), so no cast is needed here.
    let p3ForResponse: P3State = story.p3 ?? { proposedWorldComplexityLevel: null, worldComplexityLevel: null };
    if (delta.proposed_wcl !== null) {
      await setP3ProposedLevel(storyId, delta.proposed_wcl);
      p3ForResponse = { ...p3ForResponse, proposedWorldComplexityLevel: delta.proposed_wcl };
    }
```

`web/src/app/api/world-chat/wcl/route.ts` currently reads in full (52 lines) as shown in this task's Step 3 below.

- [ ] **Step 1: Add the new imports to `world-chat/route.ts`**

Change the import block quoted above to:

```ts
import {
  getStory,
  appendMessage,
  listMessages,
  setP3ProposedLevel,
  setP3ProposedPillars,
  normalizeP3,
  type P3State,
  WORLD_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
```

- [ ] **Step 2: Use `normalizeP3` and add the pillar-proposal write**

Replace the block quoted above (the comment plus the three lines of code) with:

```ts
    // World Complexity Level and Pillar proposal tracking (issues #39,
    // #40, final-review fix pattern) - only the proposed fields are ever
    // written here, via dotted-field-path updates, so this can never
    // clobber a value an author confirmed concurrently via
    // PATCH /api/world-chat/wcl or PATCH /api/world-chat/pillars while
    // this turn's model call was in flight.
    let p3ForResponse: P3State = normalizeP3(story.p3);
    if (delta.proposed_wcl !== null) {
      await setP3ProposedLevel(storyId, delta.proposed_wcl);
      p3ForResponse = { ...p3ForResponse, proposedWorldComplexityLevel: delta.proposed_wcl };
    }
    if (delta.proposed_pillars !== null) {
      await setP3ProposedPillars(storyId, delta.proposed_pillars);
      p3ForResponse = { ...p3ForResponse, proposedPillars: delta.proposed_pillars };
    }
```

- [ ] **Step 3: Fix `wcl/route.ts`'s default-construction to use `normalizeP3`**

This file currently reads in full:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP3ConfirmedLevel, type P3State } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Confirms or changes Project 3's World Complexity Level - GitHub issue
 * #39. A discrete, non-conversational state mutation (no model call),
 * mirroring the existing canvases/[canvasId]/route.ts rename PATCH's
 * shape. The "warning on change" requirement is enforced client-side
 * (WorldInterview.tsx shows a confirm dialog before calling this when a
 * value is already set) - this route just writes what it's told.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const level: unknown = body?.level;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (level !== 1 && level !== 2 && level !== 3 && level !== 4) {
      return NextResponse.json({ error: "`level` must be 1, 2, 3, or 4." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const currentP3: P3State = story.p3 ?? { proposedWorldComplexityLevel: null, worldComplexityLevel: null };
    const nextP3: P3State = { ...currentP3, worldComplexityLevel: level };
    // Dotted-field-path update (issue #39 final-review fix) - only
    // worldComplexityLevel is ever written here, so this can never
    // clobber a proposedWorldComplexityLevel written concurrently by a
    // turn's own setP3ProposedLevel call.
    await setP3ConfirmedLevel(storyId, level);

    return NextResponse.json({ p3: nextP3 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

Change the import line:

```ts
import { getStory, setP3ConfirmedLevel, type P3State } from "@/lib/canonEngine/storyStore";
```

to:

```ts
import { getStory, setP3ConfirmedLevel, normalizeP3, type P3State } from "@/lib/canonEngine/storyStore";
```

and change:

```ts
    const currentP3: P3State = story.p3 ?? { proposedWorldComplexityLevel: null, worldComplexityLevel: null };
```

to:

```ts
    const currentP3: P3State = normalizeP3(story.p3);
```

Leave everything else in this file unchanged.

- [ ] **Step 4: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: both errors from Task 2's Step 3 are gone; no new errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/world-chat/route.ts web/src/app/api/world-chat/wcl/route.ts
git commit -m "feat: track proposed World Pillars in the turn pipeline; use normalizeP3 for legacy-safe defaults (#40)"
```

---

### Task 4: Add the pillar list PATCH route

**Files:**
- Create: `web/src/app/api/world-chat/pillars/route.ts`

**Interfaces:**
- Consumes: `getStory`, `setP3Pillars`, `normalizeP3`, `type P3State` (Task 2); `requireUser`, `errorResponse`, `getMembership` (existing, unchanged, same imports the sibling `wcl/route.ts` already uses).
- Produces: `PATCH /api/world-chat/pillars` — body `{ storyId: string, pillars: string[] }`, response `{ p3: P3State }` on success. Consumed by `WorldInterview.tsx` in Task 5.

This route is a direct sibling of `web/src/app/api/world-chat/wcl/route.ts` (read in Task 3's Step 3 above) with the same auth/validation/error shape, adapted for an array-of-strings body instead of a single numeric level.

- [ ] **Step 1: Create the route file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP3Pillars, normalizeP3, type P3State } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Adopts or edits Project 3's working Pillar list - GitHub issue #40. A
 * discrete, non-conversational state mutation (no model call), the same
 * shape as the sibling wcl/route.ts PATCH. Always replaces the whole
 * array: the author's list editor is the single owner of this field, so
 * there's no concurrent-multi-writer case to design around, unlike the
 * proposed/confirmed WCL split.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    const pillarsInput: unknown = body?.pillars;

    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    if (
      !Array.isArray(pillarsInput) ||
      pillarsInput.some((p) => typeof p !== "string" || !p.trim())
    ) {
      return NextResponse.json(
        { error: "`pillars` must be an array of non-empty strings." },
        { status: 400 }
      );
    }
    const pillars = pillarsInput.map((p) => (p as string).trim());

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const nextP3: P3State = { ...normalizeP3(story.p3), pillars };
    // Dotted-field-path update (same disjointness pattern as
    // setP3ConfirmedLevel) - only `pillars` is ever written here, so
    // this can never clobber `proposedPillars` written concurrently by
    // a turn's own setP3ProposedPillars call.
    await setP3Pillars(storyId, pillars);

    return NextResponse.json({ p3: nextP3 });
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
git add web/src/app/api/world-chat/pillars/route.ts
git commit -m "feat: add PATCH /api/world-chat/pillars for author pillar-list edits (#40)"
```

---

### Task 5: Build the Pillar list editor in `WorldInterview.tsx`

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `P3State` (now with `proposedPillars`/`pillars`, Task 2), `PATCH /api/world-chat/pillars` (Task 4). Reuses the existing `wclState` state variable (already typed `P3State | null`, already populated on resume and on every turn response — no changes needed to how `wclState` itself is populated).
- Produces: nothing consumed by a later task — this is the final task.

The full current file was read directly from source; the relevant anchors are:
- State declarations at the top of the component (after `const [wclUpdating, setWclUpdating] = useState(false);`).
- The `applyWcl`/`handleWclChange` functions (after which the new pillar functions are added).
- The right-panel scrollable area (`<div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">`), where a new panel is inserted directly before the existing `{!loading && !resuming && context && (...)}` Notes-card block.

- [ ] **Step 1: Add pillar-editor state**

Find this line:

```tsx
  const [wclUpdating, setWclUpdating] = useState(false);
```

Add immediately after it:

```tsx
  const [pillarDraft, setPillarDraft] = useState<string[]>([]);
  const [pillarDraftTouched, setPillarDraftTouched] = useState(false);
  const [pillarsUpdating, setPillarsUpdating] = useState(false);
  const [newPillarInput, setNewPillarInput] = useState("");
```

- [ ] **Step 2: Sync the local draft from `wclState`**

Add a new `useEffect` directly after the existing resume `useEffect` (the one that fetches `/api/workspaces/.../canvases/...` and ends with `}, [workspaceId, canvasId]);`). Insert:

```tsx
  // Mirrors `pillars` once adopted (live-edit mode); before adoption,
  // mirrors the model's latest `proposedPillars` unless the author has
  // already started editing the pre-adoption draft locally - once
  // touched, the local draft is the author's own and stops following
  // new model proposals, the same "final authority once decided"
  // posture the WCL confirm/change split already established one step
  // later in that flow.
  useEffect(() => {
    if (!wclState) return;
    if (wclState.pillars !== null) {
      setPillarDraft(wclState.pillars);
      setPillarDraftTouched(false);
    } else if (!pillarDraftTouched) {
      setPillarDraft(wclState.proposedPillars ?? []);
    }
  }, [wclState?.pillars, wclState?.proposedPillars, pillarDraftTouched]);
```

- [ ] **Step 3: Add the pillar mutation functions**

Find the closing brace of `handleWclChange`:

```tsx
  function handleWclChange(level: WclLevel) {
    if (wclState?.worldComplexityLevel && level !== wclState.worldComplexityLevel) {
      const confirmed = window.confirm(
        "Changing the World Complexity Level after it's set affects downstream depth budgets. Continue?"
      );
      if (!confirmed) return;
    }
    applyWcl(level);
  }
```

Add immediately after it:

```tsx
  async function applyPillars(pillars: string[]) {
    if (!canvasId || pillarsUpdating) return;
    setPillarsUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/world-chat/pillars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, pillars }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update the pillar list.");
        return;
      }
      setWclState((data.p3 as P3State | undefined) ?? null);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setPillarsUpdating(false);
    }
  }

  // Before adoption (wclState.pillars === null), edits only touch the
  // local draft - Confirm below is what first writes it to the server.
  // After adoption, every edit immediately PATCHes the resulting array,
  // since the author already owns this field (no confirm step needed).
  function mutatePillars(next: string[]) {
    setPillarDraft(next);
    setPillarDraftTouched(true);
    if (wclState && wclState.pillars !== null) {
      applyPillars(next);
    }
  }

  function addPillar() {
    const name = newPillarInput.trim();
    if (!name) return;
    mutatePillars([...pillarDraft, name]);
    setNewPillarInput("");
  }

  function removePillar(index: number) {
    mutatePillars(pillarDraft.filter((_, i) => i !== index));
  }

  function movePillar(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pillarDraft.length) return;
    const next = [...pillarDraft];
    [next[index], next[target]] = [next[target], next[index]];
    mutatePillars(next);
  }

  function confirmPillarDraft() {
    applyPillars(pillarDraft);
  }
```

- [ ] **Step 4: Insert the Pillars panel in the right panel**

Find this block inside the right panel's scrollable area:

```tsx
              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing this world…</p>
                  </div>
                )}

                {!loading && !resuming && context && (
```

Insert a new block between the `loading` block and the `context` block, so it reads:

```tsx
              <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
                {loading && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-neutral-500">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-red-600/60 to-purple-600/60" />
                    <p className="text-sm">Developing this world…</p>
                  </div>
                )}

                {!resuming && wclState && (
                  <div
                    data-testid="pillars-panel"
                    className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
                  >
                    <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
                      {wclState.pillars !== null ? "World Pillars" : "Proposed World Pillars"}
                    </p>
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
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        value={newPillarInput}
                        onChange={(e) => setNewPillarInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addPillar();
                          }
                        }}
                        placeholder="Add a pillar…"
                        disabled={pillarsUpdating || loading}
                        className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[13px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none disabled:opacity-40"
                      />
                      <button
                        onClick={addPillar}
                        disabled={pillarsUpdating || loading || !newPillarInput.trim()}
                        className="shrink-0 rounded-lg border border-red-500/50 px-3 py-1.5 text-[12px] font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                    {wclState.pillars === null && (
                      <button
                        onClick={confirmPillarDraft}
                        disabled={pillarsUpdating || loading || pillarDraft.length === 0}
                        className="mt-3 rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                      >
                        Confirm pillar list
                      </button>
                    )}
                  </div>
                )}

                {!loading && !resuming && context && (
```

Leave the rest of the file (the `context` Notes-card block and everything after it) unchanged.

- [ ] **Step 5: Verify with lint/build**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 6: Manual dev-server verification**

Run from `web/`: `npm run dev`, then in a browser open a World Bible session for a Story Canvas with a completed Story Foundation:
1. Send the opening message and wait for the model's first turn. If it reports a pillar list, confirm the "Proposed World Pillars" panel appears showing that list.
2. Click the ▲/▼ buttons to reorder an item; confirm the order changes locally and no network request fires yet (check the browser's network tab — no PATCH to `/api/world-chat/pillars`).
3. Click ✕ to remove an item, and use the "Add a pillar…" input + Add button to add one; confirm both work locally without a network call.
4. Click "Confirm pillar list"; confirm a PATCH to `/api/world-chat/pillars` fires, the panel header switches to "World Pillars", and the "Confirm pillar list" button disappears.
5. Now click ▲/▼/✕/Add again; confirm each one immediately fires a PATCH request (visible in the network tab) with the full updated array.
6. Reload the page (resume the session); confirm the confirmed list reloads directly into the live-edit view, not the proposal/draft view.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: add Pillar list editor UI to the World Bible interview (#40)"
```

---

## Self-Review Notes

- **Spec coverage:** AC1 (WCL proposal already works, verified in brainstorming, no task needed) — covered by design decision, not a task. AC2 (system proposes an ordered pillar list) — Tasks 1 and 3. AC3 (author can add/remove/reorder before Stage 3) — Task 5, with the PATCH persistence layer from Task 4.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `P3State.pillars`/`proposedPillars` (Task 2) match the property names used in `world-chat/route.ts` (Task 3), `pillars/route.ts` (Task 4), and `WorldInterview.tsx` (Task 5) exactly. `WorldTurn.proposed_pillars` (Task 1) matches `delta.proposed_pillars` as read in Task 3.
- **Legacy-doc fix folded in:** Task 2/3 additionally introduce `normalizeP3()` and use it in both the turn route and the existing WCL PATCH route, closing a real gap (a pre-#40 Story doc's `p3` object would be missing the two new sub-fields entirely, not have them as explicit `null`) that would otherwise have silently miscategorized old sessions as "already has a confirmed pillar list" on the client.
