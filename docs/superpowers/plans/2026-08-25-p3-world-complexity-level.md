# P3 World Complexity Level (WCL) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #39 — turn the model's already-prompted World Complexity Level declaration (from issue #38's sp03 §10) into real, persisted, author-confirmed state with an explicit UI control.

**Architecture:** Extends the existing turn schema with a structured `proposed_wcl` field, adds a `P3State` object on the `Story` document (mirroring `P2State`'s exact shape/pattern), and adds one small new PATCH route for the explicit confirm/change action — a discrete REST mutation with no model call, matching the existing canvas-rename PATCH's shape. The UI adds a proposal banner and a persistent chip with a change control to `WorldInterview.tsx`.

**Tech Stack:** TypeScript, Zod, Next.js App Router, Firestore (via the already-existing `storyStore.ts` functions), React 19 client component.

## Global Constraints

- WCL confirmation uses an explicit UI control (buttons/dropdown), not chat-mediated confirmation — this is new UI-control territory for this app, a deliberate scoped exception, not a broader pattern change.
- The model's proposal (`proposedWorldComplexityLevel`) and the author's confirmed value (`worldComplexityLevel`) are two separate, independently-tracked fields — the confirmed value only ever changes via the new PATCH route, never from a turn response.
- The warning on change is enforced entirely client-side (a `window.confirm` dialog gating the PATCH call) — the PATCH route itself has no "are you sure" logic, matching the existing canvas-rename PATCH's shape.
- Once a level is confirmed, later model re-proposals update `proposedWorldComplexityLevel` but must never resurface the proposal banner — only the persistent chip shows once something's confirmed.
- `WCL_LABELS`/`WCL_LEVELS` live in their own file (`worldEngine/wcl.ts`), never inside `worldTurnSchema.ts` (which imports `@anthropic-ai/sdk`, unsafe for a client bundle).
- No test framework exists in this codebase (established convention) — verification is `npm run lint && npm run build`, plus a manual read-through described per task.

---

### Task 1: WCL vocabulary

**Files:**
- Create: `web/src/lib/worldEngine/wcl.ts`

**Interfaces:**
- Produces: `WCL_LEVELS = [1,2,3,4] as const`, `type WclLevel`, `WCL_LABELS: Record<WclLevel, string>` — consumed by Task 6's UI.

- [ ] **Step 1: Create the file**

```ts
/**
 * Project 3 World Complexity Level vocabulary - GitHub issue #39. A
 * single, author-confirmed value per project (PRD §4.1), not part of the
 * 4-state Exploring/Working/Confirmed/Deferred canon machinery - kept in
 * its own small file (not worldTurnSchema.ts) since it needs to be safely
 * importable from client components, and worldTurnSchema.ts pulls in
 * @anthropic-ai/sdk (server-only).
 */

export const WCL_LEVELS = [1, 2, 3, 4] as const;
export type WclLevel = (typeof WCL_LEVELS)[number];

export const WCL_LABELS: Record<WclLevel, string> = {
  1: "Minimal",
  2: "Moderate",
  3: "Rich",
  4: "Extensive",
};
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/wcl.ts
git commit -m "feat: add Project 3 World Complexity Level vocabulary (#39)"
```

---

### Task 2: Turn schema — `proposed_wcl`

**Files:**
- Modify: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- Produces: `WorldTurnSchema` gains `proposed_wcl: number | null` (1-4) — consumed by Task 4's route.

Independent of Task 1 — order between them doesn't matter, but both are prerequisites for Task 4.

- [ ] **Step 1: Update the header comment**

Find:
```ts
/**
 * Project 3 turn schema/tool - GitHub issue #38 (base turn shape for
 * Stage 1). Reference: Project 1's stateDelta.ts + extractTurn.ts's
 * generic StructuredDeltaExtractor (ARCHITECTURE.md §2), and Project 2's
 * characterTurnSchema.ts for the same reply/context/current_stage shape.
 * Deliberately minimal for this issue - no canon-state updates, no
 * guardrail/conflict fields yet, since the Canon Registry (#41), scope
 * guardrails (#46), and Conflict Resolution (#47) haven't been built.
 * Every later Phase 1-3 issue extends this same schema, the same way
 * Project 2's grew incrementally across issues #26/#28/#30/#31/#32.
 */
```
Replace:
```ts
/**
 * Project 3 turn schema/tool - GitHub issue #38 (base turn shape for
 * Stage 1) and #39 (`proposed_wcl`). Reference: Project 1's stateDelta.ts +
 * extractTurn.ts's generic StructuredDeltaExtractor (ARCHITECTURE.md §2),
 * and Project 2's characterTurnSchema.ts for the same
 * reply/context/current_stage shape. Deliberately minimal beyond that - no
 * canon-state updates, no guardrail/conflict fields yet, since the Canon
 * Registry (#41), scope guardrails (#46), and Conflict Resolution (#47)
 * haven't been built. Every later Phase 1-3 issue extends this same
 * schema, the same way Project 2's grew incrementally across issues
 * #26/#28/#30/#31/#32.
 */
```

- [ ] **Step 2: Add `proposed_wcl` to the Zod schema**

Find:
```ts
export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
});
```
Replace:
```ts
export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
  proposed_wcl: z.number().int().min(1).max(4).nullable(),
});
```

- [ ] **Step 3: Add `proposed_wcl` to the Anthropic tool definition**

Find:
```ts
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-5) currently in progress: 1 Understand, 2 Assess & Pillar Mapping, 3 Prioritize & Deep Dive, 4 System Integration Audit, 5 Compile.",
      },
    },
    required: ["reply", "context", "current_stage"],
  },
};
```
Replace:
```ts
      current_stage: {
        type: "number",
        description:
          "The interview stage (1-5) currently in progress: 1 Understand, 2 Assess & Pillar Mapping, 3 Prioritize & Deep Dive, 4 System Integration Audit, 5 Compile.",
      },
      proposed_wcl: {
        type: ["number", "null"],
        description:
          "The World Complexity Level (1-4: Minimal/Moderate/Rich/Extensive) you calculated this turn per the Adaptive World Complexity framework, so the app can offer it to the author as a real proposal to confirm or override. Report the level again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't assessed a level yet this turn (e.g. still gathering the Stage 1 basics).",
      },
    },
    required: ["reply", "context", "current_stage", "proposed_wcl"],
  },
};
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add proposed_wcl to the Project 3 turn schema (#39)"
```

---

### Task 3: `P3State` persistence

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `interface P3State { proposedWorldComplexityLevel: 1|2|3|4|null; worldComplexityLevel: 1|2|3|4|null }`, `Story.p3?: P3State | null`, `setP3State(storyId, p3: P3State): Promise<void>` — consumed by Tasks 4 and 5.

- [ ] **Step 1: Add the `P3State` interface**

Find:
```ts
/** Project 2's pending conflict vs. the Story Foundation (issue #30) - a character fact awaiting one of three author resolutions, gating that fact's confirmation until resolved. Singular, like P1's own StoryPendingConflict - only one conflict is ever open at a time. */
export interface P2PendingConflict {
  charId: string;
  characterName: string;
  field: string;
  proposedValue: unknown;
  conflictDescription: string;
  ts: string;
}
```
Replace:
```ts
/** Project 2's pending conflict vs. the Story Foundation (issue #30) - a character fact awaiting one of three author resolutions, gating that fact's confirmation until resolved. Singular, like P1's own StoryPendingConflict - only one conflict is ever open at a time. */
export interface P2PendingConflict {
  charId: string;
  characterName: string;
  field: string;
  proposedValue: unknown;
  conflictDescription: string;
  ts: string;
}

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

- [ ] **Step 2: Add `p3` to the `Story` interface**

Find:
```ts
  /**
   * Project 2's pending conflict vs. the Story Foundation (issue #30),
   * cleared once the author picks one of the three resolution choices.
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2PendingConflict?: P2PendingConflict | null;
}
```
Replace:
```ts
  /**
   * Project 2's pending conflict vs. the Story Foundation (issue #30),
   * cleared once the author picks one of the three resolution choices.
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2PendingConflict?: P2PendingConflict | null;
  /**
   * Project 3's World Complexity Level state (issue #39). Optional/
   * nullable since Stories created before this field existed won't have
   * it in Firestore.
   */
  p3?: P3State | null;
}
```

- [ ] **Step 3: Add `setP3State`**

Find:
```ts
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2, updatedAt: new Date().toISOString() });
}
```
Replace:
```ts
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2, updatedAt: new Date().toISOString() });
}

/** Persists Project 3's World Complexity Level state (issue #39) - same shape as setP2State. */
export async function setP3State(storyId: string, p3: P3State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p3, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: add Project 3 P3State persistence for World Complexity Level (#39)"
```

---

### Task 4: Persist proposals from turns

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `setP3State`, `type P3State` (Task 3); `WorldTurnSchema`'s `proposed_wcl` field (Task 2, already wired into this route's existing `extractTurn` call — no change needed there).
- Produces: the turn response gains a `proposed_wcl` field — consumed by Task 6's UI.

- [ ] **Step 1: Add the import**

Find:
```ts
import { getStory, appendMessage, listMessages, WORLD_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
```
Replace:
```ts
import {
  getStory,
  appendMessage,
  listMessages,
  setP3State,
  type P3State,
  WORLD_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
```

- [ ] **Step 2: Persist the proposal and include it in the response**

Find:
```ts
    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_stage: delta.current_stage,
      },
      WORLD_MESSAGES_COLLECTION
    );

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_stage: delta.current_stage,
    });
```
Replace:
```ts
    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_stage: delta.current_stage,
      },
      WORLD_MESSAGES_COLLECTION
    );

    // World Complexity Level proposal tracking (issue #39) - only the
    // proposed value updates here; the confirmed value only ever changes
    // via the explicit PATCH /api/world-chat/wcl action, never from a
    // turn response directly.
    if (delta.proposed_wcl !== null) {
      const currentP3: P3State = story.p3 ?? { proposedWorldComplexityLevel: null, worldComplexityLevel: null };
      await setP3State(storyId, { ...currentP3, proposedWorldComplexityLevel: delta.proposed_wcl });
    }

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_stage: delta.current_stage,
      proposed_wcl: delta.proposed_wcl,
    });
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Manual read-through check**

Confirm by reading the function:
- `story` here is the same object fetched once near the top of the handler (`const story = await getStory(storyId);`) — nothing else in this route writes to `p3` between that fetch and this point, so reading `story.p3` as the "before" snapshot is safe (matches the established pattern of reusing an already-fetched `story` object throughout a single request, e.g. `story.p2PendingConflict` in `character-chat/route.ts`).
- A turn where `delta.proposed_wcl` is `null` (model hasn't assessed a level yet): the `if` block is skipped entirely, no Firestore write, `proposed_wcl: null` still returned in the response.
- A turn where `delta.proposed_wcl` is `3` and `story.p3` was previously `undefined` (a brand-new story): `currentP3` defaults to both fields `null`, then `proposedWorldComplexityLevel` is set to `3`, `worldComplexityLevel` stays `null` — confirmed via the spread (`...currentP3`) then override.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: persist World Complexity Level proposals from Project 3 turns (#39)"
```

---

### Task 5: WCL confirm/change route

**Files:**
- Create: `web/src/app/api/world-chat/wcl/route.ts`

**Interfaces:**
- Consumes: `getStory`, `setP3State`, `type P3State` (Task 3); `requireUser`, `errorResponse`, `getMembership` (all already exist).
- Produces: `PATCH /api/world-chat/wcl` → `{ p3: P3State }` — consumed by Task 6's UI.

- [ ] **Step 1: Create the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, setP3State, type P3State } from "@/lib/canonEngine/storyStore";

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
    await setP3State(storyId, nextP3);

    return NextResponse.json({ p3: nextP3 });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass, and the route listing includes `ƒ /api/world-chat/wcl`.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the route:
- `level: 0`, `level: 5`, `level: "3"` (a string), and `level: undefined` are all rejected by the `!== 1 && !== 2 && !== 3 && !== 4` check with a 400 — none of them fall through to the Firestore write. (Note: the strict `!==` comparisons mean a JSON string `"3"` is correctly rejected too, unlike a looser numeric coercion would allow.)
- The auth/membership sequence matches every other route exactly (401 via `requireUser`'s own throw → `errorResponse`, 404 story-not-found, 403 not-a-member).
- Writing when `story.p3` is `undefined` (brand-new story, never proposed anything) works: `currentP3` defaults both fields to `null`, then `worldComplexityLevel` is overridden — no crash on a missing `p3` field.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/world-chat/wcl/route.ts
git commit -m "feat: add Project 3 World Complexity Level confirm/change route (#39)"
```

---

### Task 6: WCL UI

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `WCL_LABELS`, `WCL_LEVELS`, `type WclLevel` (Task 1); `type P3State` (Task 3, type-only import — safe in a client component the same way `CharacterInterview.tsx` type-imports `P2State`/`CharacterBibleEntry` from the same server-only module); `data.story.p3` from the existing canvases GET route response (already unstripped, no GET-route change needed); `data.proposed_wcl` from `POST /api/world-chat`'s response (Task 4); `PATCH /api/world-chat/wcl` (Task 5).

- [ ] **Step 1: Add imports**

Find:
```tsx
import Markdown from "@/components/Markdown";
import UserMenu from "@/components/UserMenu";
```
Replace:
```tsx
import Markdown from "@/components/Markdown";
import UserMenu from "@/components/UserMenu";
import type { P3State } from "@/lib/canonEngine/storyStore";
import { WCL_LABELS, WCL_LEVELS, type WclLevel } from "@/lib/worldEngine/wcl";
```

- [ ] **Step 2: Add state**

Find:
```tsx
  const [currentStage, setCurrentStage] = useState<number | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(380);
```
Replace:
```tsx
  const [currentStage, setCurrentStage] = useState<number | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [leftWidth, setLeftWidth] = useState(380);
  const [wclState, setWclState] = useState<P3State | null>(null);
  const [wclUpdating, setWclUpdating] = useState(false);
```

- [ ] **Step 3: Read `story.p3` on resume**

Find:
```tsx
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          setContext(lastAssistant.context ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
        }
```
Replace:
```tsx
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          setContext(lastAssistant.context ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
        }
        setWclState((data.story?.p3 as P3State | undefined) ?? null);
```

- [ ] **Step 4: Merge `proposed_wcl` from each turn response**

Find:
```tsx
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
```
Replace:
```tsx
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setContext(data.context ?? null);
      setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
      if (typeof data.proposed_wcl === "number") {
        setWclState((prev) => ({
          proposedWorldComplexityLevel: data.proposed_wcl,
          worldComplexityLevel: prev?.worldComplexityLevel ?? null,
        }));
      }
```

- [ ] **Step 5: Add the confirm/change handlers**

Find:
```tsx
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
```
Replace:
```tsx
  async function applyWcl(level: WclLevel) {
    if (!canvasId || wclUpdating) return;
    setWclUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/world-chat/wcl", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, level }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't update the World Complexity Level.");
        return;
      }
      setWclState((data.p3 as P3State | undefined) ?? null);
    } catch {
      setError("Couldn't reach the server. Is the dev server running?");
    } finally {
      setWclUpdating(false);
    }
  }

  function handleWclChange(level: WclLevel) {
    if (wclState?.worldComplexityLevel && level !== wclState.worldComplexityLevel) {
      const confirmed = window.confirm(
        "Changing the World Complexity Level after it's set affects downstream depth budgets. Continue?"
      );
      if (!confirmed) return;
    }
    applyWcl(level);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
```

- [ ] **Step 6: Add the UI controls**

Find:
```tsx
            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
              <div className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">preview · World Overview</span>
              </div>
```
Replace:
```tsx
            <div data-testid="right-panel" className="flex min-w-0 flex-1 flex-col bg-neutral-950">
              <div className="flex shrink-0 items-center justify-between border-b border-red-900/40 px-5 py-2.5">
                <span className="text-[11px] uppercase tracking-widest text-neutral-500">preview · World Overview</span>
                {wclState?.worldComplexityLevel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400">
                      WCL: Level {wclState.worldComplexityLevel} ({WCL_LABELS[wclState.worldComplexityLevel]})
                    </span>
                    <select
                      value=""
                      disabled={wclUpdating}
                      onChange={(e) => {
                        const level = Number(e.target.value) as WclLevel;
                        if (level) handleWclChange(level);
                        e.target.value = "";
                      }}
                      className="rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-40"
                    >
                      <option value="">Change ▾</option>
                      {WCL_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          Level {level} ({WCL_LABELS[level]})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : wclState?.proposedWorldComplexityLevel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400">
                      Proposed: Level {wclState.proposedWorldComplexityLevel} ({WCL_LABELS[wclState.proposedWorldComplexityLevel]})
                    </span>
                    <button
                      onClick={() => applyWcl(wclState.proposedWorldComplexityLevel as WclLevel)}
                      disabled={wclUpdating}
                      className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                    >
                      Confirm
                    </button>
                    <select
                      value=""
                      disabled={wclUpdating}
                      onChange={(e) => {
                        const level = Number(e.target.value) as WclLevel;
                        if (level) applyWcl(level);
                        e.target.value = "";
                      }}
                      className="rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-40"
                    >
                      <option value="">Pick a different level ▾</option>
                      {WCL_LEVELS.filter((level) => level !== wclState.proposedWorldComplexityLevel).map((level) => (
                        <option key={level} value={level}>
                          Level {level} ({WCL_LABELS[level]})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
```

- [ ] **Step 7: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 8: Manual read-through check**

Confirm by reading the component:
- `wclState === null` (fresh mount, before resume/first turn resolves): neither the chip nor the banner renders (both conditions are falsy) — no error, no crash.
- A turn response with `proposed_wcl: 3` and `wclState` previously `null`: the merge sets `proposedWorldComplexityLevel: 3, worldComplexityLevel: null` — the proposal banner renders ("Proposed: Level 3 (Rich)"), not the chip (since `worldComplexityLevel` is still `null`).
- Clicking Confirm on the banner PATCHes with the proposed level; the response's `p3` (now `{ proposedWorldComplexityLevel: 3, worldComplexityLevel: 3 }`) replaces `wclState` entirely — the banner's condition (`!wclState.worldComplexityLevel`) is now false, so the chip renders instead.
- On an already-confirmed level, selecting a *different* level from the "Change" dropdown triggers `window.confirm` before calling `applyWcl`; selecting the *same* level skips the confirm dialog (the `level !== wclState.worldComplexityLevel` guard is false) and calls `applyWcl` directly — a harmless same-value PATCH, not a crash or a stuck UI state.
- A resumed session where `data.story.p3.worldComplexityLevel` is already set: Step 3's resume logic sets `wclState` directly from the persisted value, so the chip renders immediately on load — the proposal banner never has a chance to flash first, even if `proposedWorldComplexityLevel` differs from the confirmed value.

- [ ] **Step 9: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: add World Complexity Level confirm/change UI to the P3 chat (#39)"
```
