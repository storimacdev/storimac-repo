# Character Bible Completion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** World Bible is inaccessible — both at the API layer and in the UI — until every character in the Story Foundation's cast list has reached Character Bible's Stage 6 sign-off, including for a session that's already in progress.

**Architecture:** Extract the existing charId-slugging logic into a small shared file, add one new pure gate-check function that cross-references the P1 cast list against Character Bible's persisted progress, enforce it as the authoritative check in `POST /api/world-chat`, and surface the same check via the canvas-resume route so `WorldInterview.tsx` can show a blocking screen before ever attempting a turn.

**Tech Stack:** Next.js API routes, Firebase Admin/Firestore, React (client component). No new dependencies.

## Global Constraints

- "Complete" means every cast member from the Story Foundation is `signed_off` — no tier exception, no partial credit.
- The gate is authoritative at `POST /api/world-chat` — this must reject an incomplete story regardless of how the request arrives, not just when the UI happens to check first.
- The gate applies retroactively: an already-in-progress World Bible session becomes blocked the moment this ships, if its Character Bible isn't done.
- `slugifyCharacterName` must produce byte-identical output to today's `character-chat/route.ts` implementation (including its existing `MAX_CHAR_ID_LENGTH` truncation) — the gate's cast-name-to-charId mapping must exactly match how `character-chat/route.ts` itself keys `characterProgress`, or the gate would silently mis-detect completion.
- No automated test framework exists in this repo. Verification for every task is `npm run lint` and `npm run build`, both run from the `web/` directory, plus a manual read-through (and, for the UI task, a manual dev-server check).
- A cast with zero entries is trivially "complete" (nothing to block on) — the gate function must not throw or hang on an empty cast.

---

### Task 1: Extract the shared character-id helper

**Files:**
- Create: `web/src/lib/characterEngine/characterId.ts`
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export const MAX_CHAR_ID_LENGTH = 60` and `export function slugifyCharacterName(name: string): string`. Task 2 imports both.

`web/src/app/api/character-chat/route.ts` currently has this exact block (its own import list is quoted in full further down; this is the section between `CHARACTER_MESSAGE_WINDOW` and the `resolveCharId` function):

```ts
const CHARACTER_MESSAGE_WINDOW = 20;

// A real character name never needs more than this many characters once
// slugified. Caps every derived charId - both the exact/prefix-matched
// cast-list path and the raw-slugify fallback below - as a hard backstop
// against ever writing an oversized Firestore map key, independent of
// whatever validation current_character's schema enforces upstream (a live
// incident: a pre-fix schema had no max-length bound on current_character,
// the model emitted a multi-thousand-character value, and the resulting
// charId became a Firestore map key too large to write, permanently
// corrupting that Story's p2 state).
const MAX_CHAR_ID_LENGTH = 60;

/**
 * The live Character Bible interview turn — issues #26/#27, reference:
 * web/src/app/api/chat/route.ts (Project 1's own turn handler). Issue #26
 * (design: docs/superpowers/specs/2026-08-07-p2-sequential-interview-engine-design.md)
 * added a hard app-level single-active-character lock and app-computed
 * stage clamping via characterFsm.ts's resolveCharacterTurn - still no
 * content-based (fact-completeness) stage-gating or conflict-resolution
 * machinery, since P2 doesn't have a defined required-field vocabulary
 * per stage yet (that's issue #28's job for Stage 2; #30 for conflict
 * resolution).
 */
function slugifyCharacterName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_CHAR_ID_LENGTH);
}
```

- [ ] **Step 1: Create the shared helper file**

```ts
/** A real character name never needs more than this many characters once
 * slugified. Caps every derived charId - both the exact/prefix-matched
 * cast-list path and the raw-slugify fallback in character-chat/route.ts
 * - as a hard backstop against ever writing an oversized Firestore map
 * key, independent of whatever validation current_character's schema
 * enforces upstream (a live incident: a pre-fix schema had no max-length
 * bound on current_character, the model emitted a multi-thousand-character
 * value, and the resulting charId became a Firestore map key too large to
 * write, permanently corrupting that Story's p2 state). */
export const MAX_CHAR_ID_LENGTH = 60;

/** Deterministic Canon Element id (and P2State.characterProgress key) for
 * a character, derived from its name. Extracted from character-chat/
 * route.ts (issue #26) into its own shared file so the Character Bible
 * completion gate (worldEngine/characterBibleGate.ts) can key
 * characterProgress the exact same way character-chat/route.ts itself
 * does, with no risk of the two derivations drifting apart. */
export function slugifyCharacterName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_CHAR_ID_LENGTH);
}
```

- [ ] **Step 2: Remove the duplicated constant and function from `character-chat/route.ts`**

Replace the block quoted above (both the `MAX_CHAR_ID_LENGTH` constant and the `slugifyCharacterName` function, but NOT the JSDoc comment between them — leave that comment exactly where it is) with:

```ts
const CHARACTER_MESSAGE_WINDOW = 20;

/**
 * The live Character Bible interview turn — issues #26/#27, reference:
 * web/src/app/api/chat/route.ts (Project 1's own turn handler). Issue #26
 * (design: docs/superpowers/specs/2026-08-07-p2-sequential-interview-engine-design.md)
 * added a hard app-level single-active-character lock and app-computed
 * stage clamping via characterFsm.ts's resolveCharacterTurn - still no
 * content-based (fact-completeness) stage-gating or conflict-resolution
 * machinery, since P2 doesn't have a defined required-field vocabulary
 * per stage yet (that's issue #28's job for Stage 2; #30 for conflict
 * resolution).
 */
```

- [ ] **Step 3: Add the import**

This file's import block currently ends with:

```ts
import { compileCharacterBibleEntry } from "@/lib/characterEngine/characterBibleCompiler";
```

Add immediately after it:

```ts
import { MAX_CHAR_ID_LENGTH, slugifyCharacterName } from "@/lib/characterEngine/characterId";
```

- [ ] **Step 4: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors. `slugifyCharacterName` and `MAX_CHAR_ID_LENGTH` are used exactly as before at their existing call sites in this file (`resolveCharId`'s three call sites, and the P2-state self-heal logic) — only their definition location changed.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/characterEngine/characterId.ts web/src/app/api/character-chat/route.ts
git commit -m "refactor: extract slugifyCharacterName into a shared characterEngine/characterId.ts"
```

---

### Task 2: Add the Character Bible completion gate function

**Files:**
- Create: `web/src/lib/worldEngine/characterBibleGate.ts`

**Interfaces:**
- Consumes: `slugifyCharacterName` (Task 1); `type CastMember` (from `@/lib/characterEngine/ingestFoundation`, already exported, unchanged); `type P2State` (from `@/lib/canonEngine/storyStore`, already exported, unchanged).
- Produces: `export interface CharacterBibleGateResult { complete: boolean; incompleteNames: string[]; }` and `export function checkCharacterBibleComplete(cast: CastMember[], p2State: P2State | null | undefined): CharacterBibleGateResult`. Tasks 3, 4, and 5 all import these exact names.

- [ ] **Step 1: Create the file**

```ts
import { slugifyCharacterName } from "@/lib/characterEngine/characterId";
import type { CastMember } from "@/lib/characterEngine/ingestFoundation";
import type { P2State } from "@/lib/canonEngine/storyStore";

export interface CharacterBibleGateResult {
  complete: boolean;
  incompleteNames: string[];
}

/** True only when every cast member from the Story Foundation has reached
 * Character Bible's Stage 6 sign-off. A cast with zero entries is
 * trivially complete - nothing to block on (this gate exists to stop
 * World Bible progress before Character Bible is done, not to require a
 * cast that doesn't exist yet). */
export function checkCharacterBibleComplete(
  cast: CastMember[],
  p2State: P2State | null | undefined
): CharacterBibleGateResult {
  const progress = p2State?.characterProgress ?? {};
  const incompleteNames = cast
    .filter((member) => progress[slugifyCharacterName(member.name)]?.status !== "signed_off")
    .map((member) => member.name);
  return { complete: incompleteNames.length === 0, incompleteNames };
}
```

- [ ] **Step 2: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/characterBibleGate.ts
git commit -m "feat: add checkCharacterBibleComplete gate function"
```

---

### Task 3: Enforce the gate in the World Bible turn route

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `checkCharacterBibleComplete` (Task 2); `ingestFoundation` from `characterEngine/ingestFoundation.ts` (existing, unchanged, imported under an alias since this file already imports a same-named function from `worldEngine/ingestFoundation.ts`).
- Produces: nothing consumed by a later task — this is the actual enforcement.

This file's import block and the start of its `POST` handler currently read (in full, matching the file's current state):

```ts
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
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
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/worldEngine/ingestFoundation";
import { WorldTurnSchema, EMIT_WORLD_TURN_TOOL } from "@/lib/worldEngine/worldTurnSchema";
```

and, inside `POST`, immediately after the membership check:

```ts
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const foundationResult = await ingestFoundation(storyId);
```

- [ ] **Step 1: Add the new imports**

Change:

```ts
import { ingestFoundation } from "@/lib/worldEngine/ingestFoundation";
import { WorldTurnSchema, EMIT_WORLD_TURN_TOOL } from "@/lib/worldEngine/worldTurnSchema";
```

to:

```ts
import { ingestFoundation } from "@/lib/worldEngine/ingestFoundation";
import { ingestFoundation as characterIngestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { checkCharacterBibleComplete } from "@/lib/worldEngine/characterBibleGate";
import { WorldTurnSchema, EMIT_WORLD_TURN_TOOL } from "@/lib/worldEngine/worldTurnSchema";
```

- [ ] **Step 2: Insert the gate check**

Change:

```ts
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const foundationResult = await ingestFoundation(storyId);
```

to:

```ts
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    // Character Bible completion gate - authoritative check, independent
    // of the UI's own resume-time check (canvases/[canvasId]/route.ts).
    // Rejects before this route's own worldEngine ingestFoundation call
    // below, so a blocked request doesn't pay that fetch cost. A missing
    // or malformed character Foundation is treated as "nothing to gate
    // on yet" - the worldEngine ingestFoundation call below independently
    // handles its own missing/error Foundation cases unchanged.
    const characterFoundation = await characterIngestFoundation(storyId);
    if (characterFoundation.status === "ok" || characterFoundation.status === "incomplete") {
      const gate = checkCharacterBibleComplete(characterFoundation.foundation.cast, story.p2);
      if (!gate.complete) {
        return NextResponse.json(
          {
            error: `Finish your Character Bible before starting the World Bible. Still in progress: ${gate.incompleteNames.join(", ")}.`,
          },
          { status: 400 }
        );
      }
    }

    const foundationResult = await ingestFoundation(storyId);
```

- [ ] **Step 3: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: enforce the Character Bible completion gate in POST /api/world-chat"
```

---

### Task 4: Surface the gate on Story Canvas resume

**Files:**
- Modify: `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts`

**Interfaces:**
- Consumes: `checkCharacterBibleComplete`, `type CharacterBibleGateResult` (Task 2); `ingestFoundation` from `characterEngine/ingestFoundation.ts` (existing, aliased, same alias convention as Task 3).
- Produces: the resume response's JSON body now includes `characterBibleGate: CharacterBibleGateResult | null` whenever `?worldMessages=1` or `?worldElements=1` is requested (`null` otherwise). Consumed by `WorldInterview.tsx` in Task 5.

This file's `GET` handler currently reads (in full):

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import {
  getStory,
  listMessages,
  renameStory,
  deleteStory,
  listGuardrailFlags,
  normalizeP3,
  CHARACTER_MESSAGES_COLLECTION,
  WORLD_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
import { listElements, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { setLastVisited } from "@/lib/userStore";
import type { LastProject } from "@/lib/lastProject";

export const runtime = "nodejs";

/**
 * Resume a Story Canvas — issue #89. Any workspace member can load it (not
 * just the creator), matching the sibling canvases collection route's
 * membership-based access rather than storyStore's own ownerUid-only checks
 * (which predate real auth/workspaces and are too strict for a shared Premium canvas).
 */
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

    // Track last-visited so a bare resume route lands back on whichever
    // project screen was actually active, not always Project 1 (issue #90,
    // extended). includeCharacterMessages/includeWorldMessages/
    // includeWorldElements already uniquely identify which screen made
    // this request - no new query param needed.
    const lastProject: LastProject = includeCharacterMessages
      ? "character-bible"
      : includeWorldMessages || includeWorldElements
        ? "world-bible"
        : "interview";
    await setLastVisited(user.uid, workspaceId, canvasId, lastProject);

    return NextResponse.json({
      story: { ...story, p3: normalizeP3(story.p3) },
      elements,
      messages,
      characterMessages,
      worldMessages,
      worldElements,
      guardrailFlags,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

Leave the `PATCH` and `DELETE` handlers in this same file completely untouched.

- [ ] **Step 1: Add the new imports**

Change:

```ts
import { listElements, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { setLastVisited } from "@/lib/userStore";
import type { LastProject } from "@/lib/lastProject";
```

to:

```ts
import { listElements, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import { setLastVisited } from "@/lib/userStore";
import type { LastProject } from "@/lib/lastProject";
import { ingestFoundation as characterIngestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { checkCharacterBibleComplete, type CharacterBibleGateResult } from "@/lib/worldEngine/characterBibleGate";
import type { P2State } from "@/lib/canonEngine/storyStore";
```

(`type P2State` is a new named import added to the existing `@/lib/canonEngine/storyStore` type-only usage in this file - add it as its own import statement as shown above, do not try to merge it into the existing value-import block from that same module.)

- [ ] **Step 2: Add the helper function**

Add this function above the `GET` handler (directly below the `export const runtime = "nodejs";` line, before the `/** Resume a Story Canvas ... */` comment):

```ts
/** Computes the Character Bible completion gate for a World Bible resume
 * request only (null for a Project 1/2 resume, which never asked for it)
 * - a missing/malformed character Foundation is "nothing to gate on yet",
 * matching world-chat/route.ts's own enforcement of this same gate. */
async function computeCharacterBibleGate(
  storyId: string,
  p2State: P2State | null | undefined
): Promise<CharacterBibleGateResult | null> {
  const characterFoundation = await characterIngestFoundation(storyId);
  if (characterFoundation.status !== "ok" && characterFoundation.status !== "incomplete") {
    return null;
  }
  return checkCharacterBibleComplete(characterFoundation.foundation.cast, p2State);
}
```

- [ ] **Step 3: Compute and return it in the `GET` handler**

Change:

```ts
    const [elements, messages, characterMessages, worldMessages, worldElements, guardrailFlags] = await Promise.all([
      listElements(canvasId),
      listMessages(canvasId),
      includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldMessages ? listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION) : Promise.resolve([]),
      includeWorldElements ? listElements(canvasId, WORLD_ELEMENTS_COLLECTION) : Promise.resolve([]),
      listGuardrailFlags(canvasId),
    ]);
```

to:

```ts
    const [elements, messages, characterMessages, worldMessages, worldElements, guardrailFlags, characterBibleGate] =
      await Promise.all([
        listElements(canvasId),
        listMessages(canvasId),
        includeCharacterMessages ? listMessages(canvasId, undefined, CHARACTER_MESSAGES_COLLECTION) : Promise.resolve([]),
        includeWorldMessages ? listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION) : Promise.resolve([]),
        includeWorldElements ? listElements(canvasId, WORLD_ELEMENTS_COLLECTION) : Promise.resolve([]),
        listGuardrailFlags(canvasId),
        includeWorldMessages || includeWorldElements
          ? computeCharacterBibleGate(canvasId, story.p2)
          : Promise.resolve(null),
      ]);
```

Change:

```ts
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

to:

```ts
    return NextResponse.json({
      story: { ...story, p3: normalizeP3(story.p3) },
      elements,
      messages,
      characterMessages,
      worldMessages,
      worldElements,
      guardrailFlags,
      characterBibleGate,
    });
```

- [ ] **Step 4: Verify**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts"
git commit -m "feat: surface the Character Bible completion gate on World Bible resume"
```

---

### Task 5: Show a blocking screen in the World Bible UI

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `type CharacterBibleGateResult` (Task 2, type-only import - safe in this client component since `worldEngine/characterBibleGate.ts` has no runtime server-only imports), `characterBibleGate` in the resume response (Task 4).
- Produces: nothing consumed by a later task — this is the final task.

The current file was read directly from source. The relevant anchors:
- The top-level imports.
- State declarations (after `const { setLastProject } = useUser();`).
- The resume `useEffect` (the one fetching `/api/workspaces/.../canvases/...`).
- The opening-turn `useEffect` (the one calling `sendMessage("Let's begin.")`).
- The `if (!workspaceId || !canvasId) { ... }` early-return block, right before the main `return (`.

- [ ] **Step 1: Add the import**

Find this import line:

```tsx
import type { CanonStatus } from "@/lib/canonEngine/types";
```

Add immediately after it:

```tsx
import type { CharacterBibleGateResult } from "@/lib/worldEngine/characterBibleGate";
```

- [ ] **Step 2: Add state**

Find this line:

```tsx
  const { setLastProject } = useUser();
```

Add immediately after it (still among the component's other `useState` declarations - place it next to `wclState`'s declaration for locality, i.e. find `const [wclState, setWclState] = useState<P3State | null>(null);` and add the new line directly after it):

```tsx
  const [characterBibleGate, setCharacterBibleGate] = useState<CharacterBibleGateResult | null>(null);
```

- [ ] **Step 3: Populate it in the resume effect**

Find this line inside the resume `useEffect`:

```tsx
        setWclState((data.story?.p3 as P3State | undefined) ?? null);
```

Add immediately after it:

```tsx
        setCharacterBibleGate((data.characterBibleGate as CharacterBibleGateResult | undefined) ?? null);
```

- [ ] **Step 4: Guard the opening-turn effect**

Change:

```tsx
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId]);
```

to:

```tsx
  useEffect(() => {
    if (resuming || messages.length > 0 || !canvasId) return;
    if (characterBibleGate && !characterBibleGate.complete) return;
    sendMessage("Let's begin.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resuming, canvasId, characterBibleGate]);
```

- [ ] **Step 5: Add the blocking screen**

Find this block (the existing "no canvas selected" early return, immediately before the component's main `return (`):

```tsx
  if (!workspaceId || !canvasId) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: AMBIENT_GRADIENT }}>
        <div className="rounded-2xl p-[1.5px]" style={{ background: BORDER_GRADIENT }}>
          <div className="flex flex-col items-center gap-4 rounded-[14px] bg-neutral-950 px-10 py-12 text-center text-neutral-100">
            <p className="text-lg font-medium">No Story Canvas selected.</p>
            <p className="max-w-sm text-sm text-neutral-400">
              The World Bible needs a Workspace and Story Canvas with a completed Story Foundation. Start from your dashboard.
            </p>
            <Link
              href="/dashboard"
              className="rounded-xl bg-gradient-to-r from-red-600 to-orange-500 px-5 py-3 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }
```

Add a new block immediately after it (still before the main `return (`):

```tsx

  if (!resuming && characterBibleGate && !characterBibleGate.complete) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4" style={{ background: AMBIENT_GRADIENT }}>
        <div className="rounded-2xl p-[1.5px]" style={{ background: BORDER_GRADIENT }}>
          <div className="flex flex-col items-center gap-4 rounded-[14px] bg-neutral-950 px-10 py-12 text-center text-neutral-100">
            <p className="text-lg font-medium">Finish your Character Bible first.</p>
            <p className="max-w-sm text-sm text-neutral-400">
              Still in progress: {characterBibleGate.incompleteNames.join(", ")}.
            </p>
            <Link
              href={`/character-bible?workspaceId=${workspaceId}&canvasId=${canvasId}`}
              className="rounded-xl bg-gradient-to-r from-red-600 to-orange-500 px-5 py-3 text-sm font-semibold text-white hover:from-red-500 hover:to-orange-400"
            >
              Go to Character Bible
            </Link>
          </div>
        </div>
      </div>
    );
  }
```

- [ ] **Step 6: Verify with lint/build**

Run from `web/`: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 7: Manual dev-server verification**

Run from `web/`: `npm run dev`. Using a Story Canvas whose Character Bible is NOT fully signed off:
1. Navigate to `/world-bible?workspaceId=...&canvasId=...`. Confirm the blocking screen appears (not the chat UI), naming the correct incomplete character(s), and no `POST /api/world-chat` request fires (check the network tab).
2. Click "Go to Character Bible" and confirm it navigates to `/character-bible?...` for the same canvas.
3. Directly `curl`/PATCH-test `POST /api/world-chat` for the same story with a valid session (or note in the report if this isn't practical without a browser session) and confirm it also rejects with the 400 message, independent of the UI.
4. For a Story Canvas whose Character Bible IS fully signed off, confirm World Bible loads normally with no blocking screen and the opening turn fires as before.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: show a blocking screen in World Bible when Character Bible isn't complete"
```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (all cast members, no tier exception) — Task 2's `checkCharacterBibleComplete` filters the full `cast` array with no tier check. Decision 2 (two-layer enforcement) — Task 3 (authoritative) and Task 4/5 (UI, resume-time). Decision 3 (retroactive) — confirmed: the gate reads live `story.p2`/cast state on every request, nothing is cached or grandfathered, so an already-in-progress session is blocked the moment this ships. Decision 4 (shared `characterId.ts`) — Task 1. Decision 5 (reuse `characterEngine/ingestFoundation.ts` directly rather than teaching `worldEngine/ingestFoundation.ts` to extract cast) — Tasks 3 and 4 both import it under the `characterIngestFoundation` alias. Decision 6 (empty cast is trivially complete) — `checkCharacterBibleComplete`'s `filter` over an empty array yields `incompleteNames: []` → `complete: true`. Decision 7 (no dashboard-level gating) — no task touches `ProjectDashboard.tsx`.
- **Placeholder scan:** no TBD/TODO; every step has literal code.
- **Type consistency:** `CharacterBibleGateResult` (Task 2) is imported identically (type-only where used purely for typing, value-level where the function itself is called) in Task 3 (not needed there - Task 3 only calls the function, doesn't need the type name), Task 4 (both the function and the type), and Task 5 (type-only). `checkCharacterBibleComplete`'s parameter types (`CastMember[]`, `P2State | null | undefined`) match exactly what `characterIngestFoundation`'s `foundation.cast` and `story.p2` actually produce at both call sites.
- **Correction caught before finalizing this plan:** the spec's illustrative code for `characterId.ts` didn't mention the existing `.slice(0, MAX_CHAR_ID_LENGTH)` truncation or the `MAX_CHAR_ID_LENGTH` constant itself (added in a prior, separate live-bug fix after the spec's decisions were written) - this plan extracts both together, verified against `character-chat/route.ts`'s actual current source, so the moved function is byte-identical to today's real implementation, not the spec's simplified illustration.
