# Stage 3 Discover/Develop/Validate Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Stage 3 Discover/Develop/Validate cycle (issue
#43) — one continuous World Bible thread with an `activePillar` lock
(per issue #54's decision), where the model proposes per-turn state via
new turn-schema fields and the app persists the final state through
issue #42's World Entry CRUD, extracted into a reusable store module.

**Architecture:** Task 1 extracts `web/src/app/api/world-chat/entries/route.ts`'s
inline create/update logic (issue #42, including its Character Bible
gate exemption note and Confirmed-value guard) into a new
`web/src/lib/worldEngine/worldEntryStore.ts`, with the route becoming a
thin wrapper — no behavior change. Tasks 2-3 add the `activePillar`
lock field and the turn-schema fields. Task 4 wires `world-chat/route.ts`'s
turn handler to read the model's proposals and call the extracted store
functions, exactly mirroring how `character-chat/route.ts` already
treats its own model's claims as advisory, never authoritative.

**Tech Stack:** TypeScript, Next.js route handlers, Firestore, Zod
(turn schema), Anthropic tool-use. No test runner configured —
verification is `npm run lint`, `npm run build`, and manual/code-trace
verification.

## Global Constraints

- Task 1 is a pure refactor — every manual-trace scenario already
  established in issue #42's plan must still hold identically after
  the extraction (same status codes, same error messages, same
  behavior). No functional change in Task 1.
- The Character Bible gate stays at the route/turn-handler level (it
  needs `story.p2`, already available to both callers before this
  point) — it is NOT moved into `createWorldEntry`/`updateWorldEntry`.
- The model's proposed state (`active_pillar`, `cycle_phase`,
  `proposed_entry`, `validated_status`) is always advisory — the app
  never persists it without going through the same validated store
  functions (and their existing guards: Confirmed-value block,
  `isValidTransition`) that the direct API already enforces.
- A rejected/failed store call from the chat-turn handler degrades
  gracefully (logged, conversation continues) — never a hard error
  surfaced to the author as an HTTP failure, since the model's claim is
  untrusted input, not a direct author action.
- No sp03 prompt-text changes — the new tool-schema fields' own
  descriptions carry the guidance, matching P1/P2's convention.

---

### Task 1: Extract `worldEntryStore.ts` from `entries/route.ts` (pure refactor)

**Files:**
- Create: `web/src/lib/worldEngine/worldEntryStore.ts`
- Modify: `web/src/app/api/world-chat/entries/route.ts`

**Interfaces:**
- Consumes: everything `entries/route.ts` already imports from
  `canonEngine`/`worldEngine` (unchanged).
- Produces (used by Task 4): `export function toApiEntry(element: CanonElement)`; `export interface CreateWorldEntryInput { name: string; category: string; narrativeRole: string; importance: EntryImportance; depth: EntryDepth; functionalDescription: string; governingRules: string; outstandingQuestions?: OutstandingQuestion[]; dependsOn?: string[]; }`; `export async function createWorldEntry(storyId: string, input: CreateWorldEntryInput): Promise<{ element: CanonElement; warning: ImportanceDepthCheck }>`; `export interface UpdateWorldEntryInput { name?: string; category?: string; narrativeRole?: string; importance?: EntryImportance; depth?: EntryDepth; functionalDescription?: string; governingRules?: string; outstandingQuestions?: OutstandingQuestion[]; dependsOn?: string[]; status?: "Exploring" | "Working" | "Confirmed" | "Deferred"; }`; `export type UpdateWorldEntryResult = { ok: true; element: CanonElement; warning: ImportanceDepthCheck } | { ok: false; error: string }`; `export async function updateWorldEntry(storyId: string, entryId: string, input: UpdateWorldEntryInput): Promise<UpdateWorldEntryResult>`.

- [ ] **Step 1: Create `worldEntryStore.ts`**

```ts
import { randomUUID } from "crypto";
import { getElement, listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonElement, CanonStatus } from "@/lib/canonEngine/types";
import { deriveEntryId } from "./worldEntryId";
import {
  checkImportanceDepthMismatch,
  type EntryImportance,
  type EntryDepth,
  type WorldEntryValue,
  type OutstandingQuestion,
  type ImportanceDepthCheck,
} from "./worldEntry";

/**
 * The Universal World Entry Model's store-layer logic - extracted from
 * entries/route.ts (issue #42) so issue #43's chat-turn handler can call
 * the exact same create/update logic (including the Confirmed-value
 * guard) a direct API call gets. The Character Bible gate stays at the
 * caller level (route.ts / world-chat/route.ts), not here - it needs
 * `story.p2`, already available to both callers before this point.
 */

export function toApiEntry(element: CanonElement) {
  return {
    entryId: element.element_id,
    status: element.status === "Parked" ? "Deferred" : element.status,
    value: element.value as WorldEntryValue,
    dependsOn: element.depends_on,
  };
}

export interface CreateWorldEntryInput {
  name: string;
  category: string;
  narrativeRole: string;
  importance: EntryImportance;
  depth: EntryDepth;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions?: OutstandingQuestion[];
  dependsOn?: string[];
}

export async function createWorldEntry(
  storyId: string,
  input: CreateWorldEntryInput
): Promise<{ element: CanonElement; warning: ImportanceDepthCheck }> {
  const existing = await listElements(storyId, WORLD_ENTRIES_COLLECTION);
  const existingIds = new Set(existing.map((e) => e.element_id));
  const entryId = deriveEntryId(input.name, existingIds);

  const value: WorldEntryValue = {
    name: input.name.trim(),
    category: input.category.trim(),
    narrativeRole: input.narrativeRole,
    importance: input.importance,
    depth: input.depth,
    functionalDescription: input.functionalDescription,
    governingRules: input.governingRules,
    outstandingQuestions: input.outstandingQuestions ?? [],
  };

  const element = await upsertElement(
    storyId,
    entryId,
    { status: "Exploring", value, depends_on: input.dependsOn ?? [] },
    randomUUID(),
    false,
    WORLD_ENTRIES_COLLECTION
  );

  return { element, warning: checkImportanceDepthMismatch(value.importance, value.depth) };
}

export interface UpdateWorldEntryInput {
  name?: string;
  category?: string;
  narrativeRole?: string;
  importance?: EntryImportance;
  depth?: EntryDepth;
  functionalDescription?: string;
  governingRules?: string;
  outstandingQuestions?: OutstandingQuestion[];
  dependsOn?: string[];
  status?: "Exploring" | "Working" | "Confirmed" | "Deferred";
}

export type UpdateWorldEntryResult =
  | { ok: true; element: CanonElement; warning: ImportanceDepthCheck }
  | { ok: false; error: string };

export async function updateWorldEntry(
  storyId: string,
  entryId: string,
  input: UpdateWorldEntryInput
): Promise<UpdateWorldEntryResult> {
  const existing = await getElement(storyId, entryId, WORLD_ENTRIES_COLLECTION);
  if (!existing) {
    return { ok: false, error: "World Entry not found." };
  }

  const valueFieldsPresent =
    input.name !== undefined ||
    input.category !== undefined ||
    input.narrativeRole !== undefined ||
    input.importance !== undefined ||
    input.depth !== undefined ||
    input.functionalDescription !== undefined ||
    input.governingRules !== undefined ||
    input.outstandingQuestions !== undefined;
  const leavingConfirmed = input.status !== undefined && input.status !== "Confirmed";
  if (existing.status === "Confirmed" && valueFieldsPresent && !leavingConfirmed) {
    return {
      ok: false,
      error:
        "This entry is Confirmed canon. Change its status away from Confirmed before editing its content (Conflict Resolution for Confirmed canon isn't available yet - issue #47).",
    };
  }

  const currentValue = existing.value as WorldEntryValue;
  const nextValue: WorldEntryValue = {
    ...currentValue,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.narrativeRole !== undefined ? { narrativeRole: input.narrativeRole } : {}),
    ...(input.importance !== undefined ? { importance: input.importance } : {}),
    ...(input.depth !== undefined ? { depth: input.depth } : {}),
    ...(input.functionalDescription !== undefined ? { functionalDescription: input.functionalDescription } : {}),
    ...(input.governingRules !== undefined ? { governingRules: input.governingRules } : {}),
    ...(input.outstandingQuestions !== undefined ? { outstandingQuestions: input.outstandingQuestions } : {}),
  };

  const patch: { value: WorldEntryValue; depends_on?: string[]; status?: CanonStatus } = { value: nextValue };

  if (input.dependsOn !== undefined) {
    patch.depends_on = input.dependsOn;
  }

  if (input.status !== undefined) {
    const nextStatus: CanonStatus = input.status === "Deferred" ? "Parked" : input.status;
    if (!isValidTransition(existing.status, nextStatus)) {
      const currentLabel = existing.status === "Parked" ? "Deferred" : existing.status;
      return { ok: false, error: `Can't change status from ${currentLabel} to ${input.status}.` };
    }
    patch.status = nextStatus;
  }

  const element = await upsertElement(storyId, entryId, patch, randomUUID(), true, WORLD_ENTRIES_COLLECTION);

  return { ok: true, element, warning: checkImportanceDepthMismatch(nextValue.importance, nextValue.depth) };
}
```

- [ ] **Step 2: Replace `entries/route.ts` with a thin wrapper**

Replace the entire file's contents with exactly:

```ts
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
```

Note: the route now does an extra `getElement` existence-check itself
(`existsCheck`) before calling `updateWorldEntry`, purely so the 404
"World Entry not found" status code is preserved exactly as issue #42
shipped it (`updateWorldEntry` itself returns that same message via its
`{ok: false}` branch, but always as a generic 400 from the route's
perspective unless the route distinguishes it) — this keeps this task a
true zero-behavior-change refactor rather than silently changing 404s
to 400s.

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — re-trace EVERY manual-trace scenario
already established in `docs/superpowers/plans/2026-09-10-world-entry-model.md`'s
three tasks and its fix round (Character Bible gate, `outstandingQuestions`
round-trip, empty-slug fallback, Confirmed-value guard, status
transitions) against the NEW two-file structure, confirming identical
behavior:

- **`POST` for a story whose Character Bible isn't complete**: still
  400 with the same message, before `createWorldEntry` is ever called.
- **`POST` with valid fields**: still creates an `Exploring` entry,
  still returns `{ entry, warning }` in the same shape.
- **`PATCH` for a nonexistent `entryId`**: still 404 "World Entry not
  found." (via the route's own `existsCheck`, matching the pre-refactor
  behavior exactly — not via `updateWorldEntry`'s generic 400 branch).
- **`PATCH` on a `Confirmed` entry, value-only edit**: still 400 with
  the same Confirmed-canon message (now sourced from
  `updateWorldEntry`'s `{ok: false}` branch, routed through the generic
  400 handler).
- **`PATCH` with an invalid status transition**: still 400 with the
  same "Can't change status from X to Y" message.
- **`deriveEntryId` empty-slug fallback**: unaffected by this refactor
  (untouched file), still returns `"entry"` for a non-Latin name.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/worldEngine/worldEntryStore.ts web/src/app/api/world-chat/entries/route.ts
git commit -m "refactor: extract World Entry create/update logic into worldEntryStore.ts"
```

---

### Task 2: `Story.p3.activePillar` lock field

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces (used by Task 4): `P3State.activePillar: string | null`; `export async function setP3ActivePillar(storyId: string, pillar: string | null): Promise<void>`.

- [ ] **Step 1: Extend `P3State` and `normalizeP3`**

Find:

```ts
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  proposedPillars: string[] | null;
  pillars: string[] | null;
}
```

Replace with exactly:

```ts
export interface P3State {
  proposedWorldComplexityLevel: 1 | 2 | 3 | 4 | null;
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  proposedPillars: string[] | null;
  pillars: string[] | null;
  /** Issue #43: the pillar currently locked for Stage 3's Discover/
   * Develop/Validate cycle - mirrors P2State.activeCharacterId, per
   * issue #54's platform decision (one continuous thread, not
   * per-pillar sessions). `null` means no pillar is currently active. */
  activePillar: string | null;
}
```

Find:

```ts
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

Replace with exactly:

```ts
export function normalizeP3(p3: P3State | null | undefined): P3State {
  return {
    proposedWorldComplexityLevel: null,
    worldComplexityLevel: null,
    proposedPillars: null,
    pillars: null,
    activePillar: null,
    ...p3,
  };
}
```

- [ ] **Step 2: Add `setP3ActivePillar`**

Find (the existing `setP3Pillars` function, to add the new function
right after it):

```ts
export async function setP3Pillars(storyId: string, pillars: string[]): Promise<void> {
```

Add the new function immediately after `setP3Pillars`'s closing `}`
(i.e., after its full existing body — read the file to find the exact
closing brace, then insert directly below it):

```ts

/** Sets Project 3's currently-locked pillar for the Stage 3 Discover/
 * Develop/Validate cycle (issue #43) - null clears the lock. Uses a
 * dotted-field-path update, same convention as every other P3 sub-field
 * writer, so it can never clobber the other P3 fields regardless of
 * which writer reads a stale snapshot first. */
export async function setP3ActivePillar(storyId: string, pillar: string | null): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ "p3.activePillar": pillar, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 3: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 4: Manual trace verification**

- **`normalizeP3(null)`**: returns `{ proposedWorldComplexityLevel: null, worldComplexityLevel: null, proposedPillars: null, pillars: null, activePillar: null }`.
- **`normalizeP3({ proposedWorldComplexityLevel: 2, worldComplexityLevel: 2, proposedPillars: ["Geography"], pillars: ["Geography"] })`**
  (a P3 doc written before `activePillar` existed): returns the same
  object with `activePillar: null` filled in — confirms the "old doc
  simply lacks the key" backward-compatibility this function exists
  for still works for the new field too.
- **`setP3ActivePillar(storyId, "Geography")`** then
  **`setP3ActivePillar(storyId, null)`**: each call only ever touches
  the single `p3.activePillar` field via the dotted path — trace that
  neither call's update object contains any other `p3.*` key, so a
  concurrent write to e.g. `p3.pillars` can't be clobbered.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: add Story.p3.activePillar lock field for Stage 3's Discover/Develop/Validate cycle"
```

---

### Task 3: Turn-schema fields

**Files:**
- Modify: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- Produces (used by Task 4): `WorldTurn` gains `active_pillar: string | null`, `cycle_phase: "Discover" | "Develop" | "Validate" | null`, `proposed_entry: { entry_id: string | null; name: string; category: string; narrative_role: string; importance: "Critical" | "Major" | "Supporting" | "Minor" | "Incidental"; depth: 1 | 2 | 3 | 4 | 5; functional_description: string; governing_rules: string; } | null`, `validated_status: "Working" | "Confirmed" | "Deferred" | null`.

- [ ] **Step 1: Extend `WorldTurnSchema` and `EMIT_WORLD_TURN_TOOL`**

Find:

```ts
export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
  proposed_wcl: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  proposed_pillars: z.array(z.string().min(1)).nullable(),
});
```

Replace with exactly:

```ts
export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string().min(1),
  current_stage: z.number().int().min(1).max(5),
  proposed_wcl: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  proposed_pillars: z.array(z.string().min(1)).nullable(),
  active_pillar: z.string().nullable(),
  cycle_phase: z.enum(["Discover", "Develop", "Validate"]).nullable(),
  proposed_entry: z
    .object({
      entry_id: z.string().nullable(),
      name: z.string().min(1),
      category: z.string().min(1),
      narrative_role: z.string(),
      importance: z.enum(["Critical", "Major", "Supporting", "Minor", "Incidental"]),
      depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      functional_description: z.string(),
      governing_rules: z.string(),
    })
    .nullable(),
  validated_status: z.enum(["Working", "Confirmed", "Deferred"]).nullable(),
});
```

Find (the `EMIT_WORLD_TURN_TOOL`'s `properties` object, right after
`proposed_pillars`'s description block):

```ts
      proposed_pillars: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "The ordered list of relevant World Pillars you've identified for this world (e.g. Technology, Government & Bureaucracy, Economy, Culture, Geography, Underworld, History), most important first, so the app can offer it to the author as a starting list to confirm, edit, or reorder. Report the list again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't identified a pillar list yet this turn.",
      },
    },
    required: ["reply", "context", "current_stage", "proposed_wcl", "proposed_pillars"],
  },
};
```

Replace with exactly:

```ts
      proposed_pillars: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "The ordered list of relevant World Pillars you've identified for this world (e.g. Technology, Government & Bureaucracy, Economy, Culture, Geography, Underworld, History), most important first, so the app can offer it to the author as a starting list to confirm, edit, or reorder. Report the list again on every turn you've assessed one, even if unchanged from a prior turn. Use null only if you haven't identified a pillar list yet this turn.",
      },
      active_pillar: {
        type: ["string", "null"],
        description:
          "During Stage 3 (Prioritize & Deep Dive), the single pillar you are currently deep-diving with the author, exactly matching one of the adopted pillar names. Null before Stage 3 starts, or in the gap between finishing one pillar and starting the next. Report it again every turn it's active, even if unchanged.",
      },
      cycle_phase: {
        type: ["string", "null"],
        enum: ["Discover", "Develop", "Validate", null],
        description:
          "Which phase of the Discover/Develop/Validate cycle this turn's reply belongs to, for the currently active pillar. Null when active_pillar is null.",
      },
      proposed_entry: {
        type: ["object", "null"],
        properties: {
          entry_id: {
            type: ["string", "null"],
            description:
              "The id of an existing draft entry this turn is updating (from a prior turn's created/updated entry). Null when this turn proposes a brand-new entry instead.",
          },
          name: { type: "string", description: "The entry's Name." },
          category: { type: "string", description: "The entry's Category (e.g. Location, Technology, Religion, Historical Event)." },
          narrative_role: { type: "string", description: "The entry's Narrative Role - its explicit reason for existing." },
          importance: {
            type: "string",
            enum: ["Critical", "Major", "Supporting", "Minor", "Incidental"],
            description: "The entry's Narrative Importance tag.",
          },
          depth: {
            type: "number",
            enum: [1, 2, 3, 4, 5],
            description: "The entry's Development Depth level (1 Reference - 5 Exhaustive).",
          },
          functional_description: { type: "string", description: "The entry's Functional Description, bounded by its depth level." },
          governing_rules: { type: "string", description: "The entry's Governing Rules & Constraints." },
        },
        required: ["entry_id", "name", "category", "narrative_role", "importance", "depth", "functional_description", "governing_rules"],
        description:
          "A structured draft of the World Entry currently being developed or validated, during the Develop or Validate phase of the active pillar's cycle. Null outside those phases, or when nothing concrete has been drafted yet this turn.",
      },
      validated_status: {
        type: ["string", "null"],
        enum: ["Working", "Confirmed", "Deferred", null],
        description:
          "Set only on the turn where the author has just given a clear verdict on the entry named in proposed_entry (or its entry_id): Working (provisional), Confirmed (approved as canon), or Deferred (postponed). Null on every other turn, including every Discover/Develop-phase turn.",
      },
    },
    required: [
      "reply",
      "context",
      "current_stage",
      "proposed_wcl",
      "proposed_pillars",
      "active_pillar",
      "cycle_phase",
      "proposed_entry",
      "validated_status",
    ],
  },
};
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

- **A turn with `active_pillar: null, cycle_phase: null, proposed_entry: null, validated_status: null`** (pre-Stage-3 or between pillars): parses successfully against `WorldTurnSchema` — confirms all four new fields are genuinely optional/nullable, not silently required non-null.
- **A turn with `active_pillar: "Geography"`, `cycle_phase: "Develop"`, `proposed_entry: { entry_id: null, name: "The Sunken Capital", category: "Location", narrative_role: "...", importance: "Major", depth: 3, functional_description: "...", governing_rules: "...", }`, `validated_status: null`**: parses successfully.
- **A turn with `proposed_entry.importance: "Epic"`** (not a valid enum value): fails Zod validation (this is what `extractTurn`'s existing retry-on-validation-failure logic already handles for every other field in this schema — no new error-handling code needed, confirm by reading `extractTurn.ts`'s existing generic handling).
- **A turn with `cycle_phase: "Discover"` but `active_pillar: null`**: this is schema-valid (both fields are independently nullable, the schema doesn't cross-validate them) — confirm this is an accepted design tradeoff, not a bug: `world-chat/route.ts`'s Task 4 handler is what will decide what to do with an inconsistent combination, not the schema itself.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add active_pillar, cycle_phase, proposed_entry, and validated_status to WorldTurnSchema"
```

---

### Task 4: Wire `world-chat/route.ts`'s turn handler

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `setP3ActivePillar` from `@/lib/canonEngine/storyStore` (Task 2); `createWorldEntry`, `updateWorldEntry` from `@/lib/worldEngine/worldEntryStore` (Task 1); the new `WorldTurn` fields (Task 3).
- Produces: the route's JSON response gains `activePillar: string | null` and, when a create/update happened this turn, `entryWarning: ImportanceDepthCheck | null`.

- [ ] **Step 1: Add the imports**

Find:

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

Replace with exactly:

```ts
import {
  getStory,
  appendMessage,
  listMessages,
  setP3ProposedLevel,
  setP3ProposedPillars,
  setP3ActivePillar,
  normalizeP3,
  type P3State,
  WORLD_MESSAGES_COLLECTION,
} from "@/lib/canonEngine/storyStore";
import { createWorldEntry, updateWorldEntry } from "@/lib/worldEngine/worldEntryStore";
import type { ImportanceDepthCheck } from "@/lib/worldEngine/worldEntry";
```

- [ ] **Step 2: Add the turn-handling logic**

Find (the existing WCL/pillar-proposal tracking block, right before
the final `return NextResponse.json(...)`):

```ts
    let p3ForResponse: P3State = normalizeP3(story.p3);
    if (delta.proposed_wcl !== null) {
      await setP3ProposedLevel(storyId, delta.proposed_wcl);
      p3ForResponse = { ...p3ForResponse, proposedWorldComplexityLevel: delta.proposed_wcl };
    }
    if (delta.proposed_pillars !== null) {
      await setP3ProposedPillars(storyId, delta.proposed_pillars);
      p3ForResponse = { ...p3ForResponse, proposedPillars: delta.proposed_pillars };
    }

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_stage: delta.current_stage,
      p3: p3ForResponse,
    });
```

Replace with exactly:

```ts
    let p3ForResponse: P3State = normalizeP3(story.p3);
    if (delta.proposed_wcl !== null) {
      await setP3ProposedLevel(storyId, delta.proposed_wcl);
      p3ForResponse = { ...p3ForResponse, proposedWorldComplexityLevel: delta.proposed_wcl };
    }
    if (delta.proposed_pillars !== null) {
      await setP3ProposedPillars(storyId, delta.proposed_pillars);
      p3ForResponse = { ...p3ForResponse, proposedPillars: delta.proposed_pillars };
    }

    // Stage 3 Discover/Develop/Validate cycle (issue #43) - the model's
    // active_pillar/proposed_entry/validated_status are always advisory;
    // the app only ever persists them through the same validated store
    // functions (and their existing Confirmed-value guard, isValidTransition
    // check) the direct entries API already enforces. A failed store call
    // here degrades gracefully - logged, never a hard error to the author,
    // since this is an untrusted model claim, not a direct author action.
    if (delta.active_pillar !== p3ForResponse.activePillar) {
      await setP3ActivePillar(storyId, delta.active_pillar);
      p3ForResponse = { ...p3ForResponse, activePillar: delta.active_pillar };
    }

    let entryWarning: ImportanceDepthCheck | null = null;
    if (delta.proposed_entry) {
      const entryInput = {
        name: delta.proposed_entry.name,
        category: delta.proposed_entry.category,
        narrativeRole: delta.proposed_entry.narrative_role,
        importance: delta.proposed_entry.importance,
        depth: delta.proposed_entry.depth,
        functionalDescription: delta.proposed_entry.functional_description,
        governingRules: delta.proposed_entry.governing_rules,
      };
      if (delta.proposed_entry.entry_id === null) {
        const { warning } = await createWorldEntry(storyId, entryInput);
        entryWarning = warning;
      } else {
        const result = await updateWorldEntry(storyId, delta.proposed_entry.entry_id, entryInput);
        if (result.ok) {
          entryWarning = result.warning;
        } else {
          console.warn(`[world-chat] proposed_entry update rejected for turn ${turnId}: ${result.error}`);
        }
        if (result.ok && delta.validated_status !== null) {
          const validation = await updateWorldEntry(storyId, delta.proposed_entry.entry_id, {
            status: delta.validated_status,
          });
          if (validation.ok) {
            entryWarning = validation.warning;
          } else {
            console.warn(`[world-chat] validated_status rejected for turn ${turnId}: ${validation.error}`);
          }
        }
      }
    }

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_stage: delta.current_stage,
      p3: p3ForResponse,
      entryWarning,
    });
```

- [ ] **Step 3: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 4: Manual trace verification**

- **`delta.active_pillar` unchanged from `story.p3.activePillar`**:
  `setP3ActivePillar` is never called this turn (the `!==` guard skips
  it) — no wasted write.
- **`delta.active_pillar` differs**: `setP3ActivePillar` is called once,
  and the response's `p3.activePillar` reflects the new value.
- **`delta.proposed_entry` present with `entry_id: null`**:
  `createWorldEntry` is called, never `updateWorldEntry`; the response's
  `entryWarning` is that creation's `ImportanceDepthCheck`.
- **`delta.proposed_entry` present with a real `entry_id`,
  `delta.validated_status: null`**: only the content-update
  `updateWorldEntry` call happens; the second (`validated_status`) call
  block is skipped entirely (its `if` guard is `delta.validated_status
  !== null`).
- **`delta.proposed_entry` present with a real `entry_id`,
  `delta.validated_status: "Confirmed"`, and the content-update
  succeeds**: TWO `updateWorldEntry` calls happen — one for the content
  fields, one for `{ status: "Confirmed" }` — and `entryWarning` ends up
  reflecting the SECOND (status) call's warning, since it's assigned
  after the first.
- **The content-update call fails** (e.g. the entry is already
  `Confirmed` and this turn's content fields would be blocked by the
  Confirmed-value guard): logged via `console.warn`, `entryWarning`
  stays `null` (its initial value, since the `if (result.ok)` branch
  that would set it is skipped) - the validated_status branch is also
  skipped since it's nested inside `if (result.ok && ...)` — and the
  route does NOT throw or return an error response; `NextResponse.json`
  still returns normally with the conversation's `reply`/`context`
  intact.
- **`delta.proposed_entry` is `null`**: neither `createWorldEntry` nor
  `updateWorldEntry` is called; `entryWarning` stays `null`.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: wire world-chat turn handler to Stage 3's Discover/Develop/Validate cycle"
```
