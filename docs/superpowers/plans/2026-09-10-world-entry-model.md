# Universal World Entry Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Universal World Entry Model (issue #42) as a
structured, CRUD-backed record type reusing the existing generic Canon
Engine, plus the Importance × Depth soft-warning matrix (issue #44)
surfaced at entry creation/edit time.

**Architecture:** A new Firestore collection constant
(`WORLD_ENTRIES_COLLECTION`) added to the existing `canonStore.ts`
(zero new store-layer code — entries are plain `CanonElement` records,
reusing `getElement`/`listElements`/`upsertElement`); a new id-derivation
module (`worldEngine/worldEntryId.ts`); a new value-shape + mismatch-check
module (`worldEngine/worldEntry.ts`); and a new API route
(`web/src/app/api/world-chat/entries/route.ts`, POST/GET/PATCH) matching
`canon-status/route.ts`'s existing conventions exactly.

**Tech Stack:** TypeScript, Next.js route handlers, Firestore via the
existing `canonEngine` store. No test runner configured — verification
is `npm run lint`, `npm run build`, and manual/code-trace verification.

## Global Constraints

- Entries are plain `CanonElement` records in a NEW collection
  (`worldEntries`), never a bespoke new type, and never mixed into the
  existing `worldElements` (pillar-status-only) collection.
- "Systemic Relationships" (cross-references) use the existing generic
  `depends_on: string[]` field on `CanonElement` — no separate field.
- The Importance/Depth mismatch check is grounded exactly in sp03 §3's
  three stated rules — never invent a mismatch rule not in that text.
- Status changes go through `isValidTransition` — a client bug can't
  produce an invalid transition even with `allowConfirmedOverride: true`.
- Auth/membership checks (`requireUser`, `getMembership`) on every
  route, matching `canon-status/route.ts`'s exact pattern.
- No LLM call anywhere in this issue — pure CRUD.

---

### Task 1: Entry id derivation and the value shape + mismatch check

**Files:**
- Create: `web/src/lib/worldEngine/worldEntryId.ts`
- Create: `web/src/lib/worldEngine/worldEntry.ts`
- Modify: `web/src/lib/canonEngine/canonStore.ts`

**Interfaces:**
- Produces (used by Task 2): `export const MAX_ENTRY_ID_LENGTH: number`; `export function slugifyEntryName(name: string): string`; `export function deriveEntryId(name: string, existingIds: Set<string>): string`; `export type EntryImportance = "Critical" | "Major" | "Supporting" | "Minor" | "Incidental"`; `export type EntryDepth = 1 | 2 | 3 | 4 | 5`; `export interface OutstandingQuestion { item: string; notes: string; }`; `export interface WorldEntryValue { name: string; category: string; narrativeRole: string; importance: EntryImportance; depth: EntryDepth; functionalDescription: string; governingRules: string; outstandingQuestions: OutstandingQuestion[]; }`; `export interface ImportanceDepthCheck { warning: boolean; message: string | null; }`; `export function checkImportanceDepthMismatch(importance: EntryImportance, depth: EntryDepth): ImportanceDepthCheck`; `export const WORLD_ENTRIES_COLLECTION: string` (from `canonStore.ts`).

- [ ] **Step 1: Add the collection constant to `canonStore.ts`**

Find (near the top of the file, after the existing `WORLD_ELEMENTS_COLLECTION` constant):

```ts
export const WORLD_ELEMENTS_COLLECTION = "worldElements";
```

Add immediately after it:

```ts

/** Project 3's standalone-world-asset registry (issue #42) - a sibling
 * to WORLD_ELEMENTS_COLLECTION above (pillar status only, issue #41).
 * Entries are plain CanonElement records here too - "Systemic
 * Relationships" (cross-references) use the existing generic
 * `depends_on` field, no separate field needed. */
export const WORLD_ENTRIES_COLLECTION = "worldEntries";
```

- [ ] **Step 2: Create `worldEntryId.ts`**

```ts
/** A real entry name never needs more than this many characters once
 * slugified - same hard backstop rationale as characterEngine/
 * characterId.ts's MAX_CHAR_ID_LENGTH (issue #105's incident: an
 * unbounded derived id can become an oversized Firestore map key). */
export const MAX_ENTRY_ID_LENGTH = 60;

/** Deterministic Canon Element id for a World Entry, derived from its
 * name - same slugify pattern as worldEngine/pillarElementId.ts. */
export function slugifyEntryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ENTRY_ID_LENGTH);
}

/** Disambiguates a collision against the story's existing entry ids
 * with a "_2"/"_3"/... suffix, mirroring issue #105's assignCharIds -
 * re-truncates before each candidate suffix so the result never
 * exceeds MAX_ENTRY_ID_LENGTH even after a suffix is appended. */
export function deriveEntryId(name: string, existingIds: Set<string>): string {
  const base = slugifyEntryName(name);
  let id = base;
  let occurrence = 1;
  while (existingIds.has(id)) {
    occurrence++;
    const suffix = `_${occurrence}`;
    id = `${base.slice(0, MAX_ENTRY_ID_LENGTH - suffix.length)}${suffix}`;
  }
  return id;
}
```

- [ ] **Step 3: Create `worldEntry.ts`**

```ts
/**
 * The Universal World Entry Model's structured value shape and the
 * Importance x Development Depth soft-warning matrix - GitHub issues
 * #42, #44, sp03 §3/§7 (Universal World Entry Model / Priority
 * Framework). None of the three mismatch rules below are invented:
 * "Level 5 is reserved for Critical items only" is sp03 §3's own stated
 * rule verbatim; "a Minor element at Level 4/5" and "a Critical element
 * stuck at Level 1" are issue #44's own explicit AC examples (not
 * stated in sp03 §3 itself); "Incidental" additionally triggers the
 * same rule as "Minor" as this module's own extension (it sits below
 * Minor on sp03's Importance scale), not literally in the AC text
 * either.
 */

export type EntryImportance = "Critical" | "Major" | "Supporting" | "Minor" | "Incidental";
export type EntryDepth = 1 | 2 | 3 | 4 | 5;

export interface OutstandingQuestion {
  item: string;
  notes: string;
}

export interface WorldEntryValue {
  name: string;
  category: string;
  narrativeRole: string;
  importance: EntryImportance;
  depth: EntryDepth;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions: OutstandingQuestion[];
}

export interface ImportanceDepthCheck {
  warning: boolean;
  message: string | null;
}

const DEPTH_LABELS: Record<EntryDepth, string> = {
  1: "Level 1 Reference",
  2: "Level 2 Basic",
  3: "Level 3 Standard",
  4: "Level 4 Comprehensive",
  5: "Level 5 Exhaustive",
};

export function checkImportanceDepthMismatch(
  importance: EntryImportance,
  depth: EntryDepth
): ImportanceDepthCheck {
  if (depth === 5 && importance !== "Critical") {
    return {
      warning: true,
      message: `Level 5 Exhaustive depth is reserved for Critical elements - this entry is tagged "${importance}".`,
    };
  }
  if ((importance === "Minor" || importance === "Incidental") && depth >= 4) {
    return {
      warning: true,
      message: `"${importance}" elements are usually developed at Level 1-2 depth - ${DEPTH_LABELS[depth]} may be more detail than this element needs.`,
    };
  }
  if (importance === "Critical" && depth === 1) {
    return {
      warning: true,
      message: `"Critical" elements usually need more than ${DEPTH_LABELS[1]} depth - consider developing this further.`,
    };
  }
  return { warning: false, message: null };
}
```

- [ ] **Step 4: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 5: Manual trace verification**

No test runner in this repo — trace these by hand:

- **`slugifyEntryName("The Sunken Capital of Aldergate")`** → `"the-sunken-capital-of-aldergate"`.
- **`deriveEntryId("The Capital", new Set())`** → `"the-capital"`.
- **`deriveEntryId("The Capital", new Set(["the-capital"]))`** → `"the-capital_2"`.
- **`deriveEntryId("The Capital", new Set(["the-capital", "the-capital_2"]))`** → `"the-capital_3"`.
- **`checkImportanceDepthMismatch("Minor", 5)`** → `{ warning: true, message: containing "Level 5 Exhaustive depth is reserved for Critical" }` (the depth===5 rule fires before the Minor/Incidental rule would also apply — confirm this is the message you get, since both rules technically match; the depth===5 check runs first in the code).
- **`checkImportanceDepthMismatch("Minor", 4)`** → `{ warning: true, message: containing "Minor" and "Level 1-2" }`.
- **`checkImportanceDepthMismatch("Critical", 1)`** → `{ warning: true, message: containing "Critical" and "Level 1 Reference" }`.
- **`checkImportanceDepthMismatch("Critical", 5)`** → `{ warning: false, message: null }` (Critical at Level 5 is exactly the intended pairing).
- **`checkImportanceDepthMismatch("Major", 3)`** → `{ warning: false, message: null }`.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/canonStore.ts web/src/lib/worldEngine/worldEntryId.ts web/src/lib/worldEngine/worldEntry.ts
git commit -m "feat: add World Entry id derivation, value shape, and Importance/Depth mismatch check"
```

---

### Task 2: Create and list entries (POST, GET)

**Files:**
- Create: `web/src/app/api/world-chat/entries/route.ts`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/session`; `errorResponse` from `@/lib/apiErrors`; `getMembership` from `@/lib/workspace/workspaceStore`; `getStory` from `@/lib/canonEngine/storyStore`; `listElements`, `upsertElement`, `WORLD_ENTRIES_COLLECTION` from `@/lib/canonEngine/canonStore`; `deriveEntryId` from `@/lib/worldEngine/worldEntryId`; `checkImportanceDepthMismatch`, `type EntryImportance`, `type EntryDepth`, `type WorldEntryValue` from `@/lib/worldEngine/worldEntry`; `type CanonElement` from `@/lib/canonEngine/types`.
- Produces (used by Task 3, added to the same file): the module's `POST` and `GET` exports; a shared `toApiEntry(element: CanonElement)` helper translating `Parked` → `Deferred` for the response, matching `canon-status/route.ts`'s existing translation.

- [ ] **Step 1: Create the file with `POST` and `GET`**

```ts
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
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these by hand (auth/Firestore calls
can't run outside a real request, so trace the logic/branches, not a
live HTTP call):

- **`POST` with a missing `storyId`**: returns 400, "Request must
  include `storyId`." before any Firestore call.
- **`POST` with `importance: "Epic"`** (not a valid value): returns 400
  listing the 5 valid values, before any Firestore call.
- **`POST` with `depth: 6`**: returns 400 "`depth` must be an integer
  1-5.".
- **`POST` with valid fields, `importance: "Minor"`, `depth: 5`, no
  existing entries for the story**: `entryId` is `deriveEntryId(name,
  new Set())` (the plain slug, no collision), the created element has
  `status: "Exploring"`, and the response's `warning.warning` is `true`
  with a message about Level 5 being reserved for Critical (the
  depth===5 rule, which fires before the Minor-specific rule).
- **`POST` for a name colliding with an existing entry**: `entryId`
  gets a `_2` suffix, per `deriveEntryId`'s own traced behavior from
  Task 1.
- **`GET` with no `storyId` query param**: returns 400 before any
  Firestore call.
- **`GET` for a story with 3 existing entries, one with `status:
  "Parked"`**: response's `entries` array has 3 items, and the Parked
  one's `status` reads `"Deferred"` (the API-boundary translation),
  never `"Parked"`.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/world-chat/entries/route.ts
git commit -m "feat: add World Entry create (POST) and list (GET) routes"
```

---

### Task 3: Update entries (PATCH)

**Files:**
- Modify: `web/src/app/api/world-chat/entries/route.ts`

**Interfaces:**
- Consumes: `getElement`, `isValidTransition` (new imports); everything already imported/defined by Task 2 in the same file.
- Produces: the module's `PATCH` export.

- [ ] **Step 1: Add the imports and the `PATCH` handler**

Find (Task 2's import block):

```ts
import { listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import type { CanonElement } from "@/lib/canonEngine/types";
```

Replace with:

```ts
import { getElement, listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { isValidTransition } from "@/lib/canonEngine/transitions";
import type { CanonElement, CanonStatus } from "@/lib/canonEngine/types";
```

Add at the end of the file, after `GET`:

```ts
/**
 * Patches an entry's value fields, `dependsOn`, and/or `status`.
 * Status changes go through `isValidTransition` exactly like
 * canon-status/route.ts does for pillars - `allowConfirmedOverride:
 * true` because every call here is an explicit author/API action, not
 * a model turn, but the transition table still runs first so a client
 * bug can't produce a nonsensical transition.
 */
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

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const existing = await getElement(storyId, entryId, WORLD_ENTRIES_COLLECTION);
    if (!existing) {
      return NextResponse.json({ error: "World Entry not found." }, { status: 404 });
    }

    const currentValue = existing.value as WorldEntryValue;
    const nextValue: WorldEntryValue = {
      ...currentValue,
      ...(typeof body?.name === "string" ? { name: body.name } : {}),
      ...(typeof body?.category === "string" ? { category: body.category } : {}),
      ...(typeof body?.narrativeRole === "string" ? { narrativeRole: body.narrativeRole } : {}),
      ...(body?.importance !== undefined ? { importance: body.importance as EntryImportance } : {}),
      ...(body?.depth !== undefined ? { depth: body.depth as EntryDepth } : {}),
      ...(typeof body?.functionalDescription === "string" ? { functionalDescription: body.functionalDescription } : {}),
      ...(typeof body?.governingRules === "string" ? { governingRules: body.governingRules } : {}),
    };

    const patch: { value: WorldEntryValue; depends_on?: string[]; status?: CanonStatus } = { value: nextValue };

    if (Array.isArray(body?.dependsOn) && body.dependsOn.every((d: unknown) => typeof d === "string")) {
      patch.depends_on = body.dependsOn;
    }

    if (status !== undefined) {
      const nextStatus: CanonStatus = status === "Deferred" ? "Parked" : status;
      if (!isValidTransition(existing.status, nextStatus)) {
        const currentLabel = existing.status === "Parked" ? "Deferred" : existing.status;
        return NextResponse.json(
          { error: `Can't change status from ${currentLabel} to ${status}.` },
          { status: 400 }
        );
      }
      patch.status = nextStatus;
    }

    const element = await upsertElement(storyId, entryId, patch, randomUUID(), true, WORLD_ENTRIES_COLLECTION);

    const mismatch = checkImportanceDepthMismatch(nextValue.importance, nextValue.depth);

    return NextResponse.json({ entry: toApiEntry(element), warning: mismatch });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

- **`PATCH` with a missing `entryId`**: returns 400 before any
  Firestore call.
- **`PATCH` for an `entryId` that doesn't exist**: returns 404 "World
  Entry not found.".
- **`PATCH` changing only `functionalDescription`** (no `status`, no
  `importance`/`depth`): `nextValue` keeps the existing `importance`/
  `depth` (spread from `currentValue`), only `functionalDescription`
  changes; `patch.status` is never set (so `upsertElement`'s patch
  doesn't touch status at all); the returned `warning` is computed
  against the (unchanged) `importance`/`depth` — confirm this doesn't
  spuriously flip because nothing about those two fields moved.
- **`PATCH` with `status: "Confirmed"` on an `Exploring` entry**:
  `isValidTransition("Exploring", "Confirmed")` is `true` (per
  `transitions.ts`'s table) — patch succeeds, returned `status` is
  `"Confirmed"`.
- **`PATCH` with `status: "Working"` on a `Confirmed` entry**:
  `isValidTransition("Confirmed", "Working")` is `false` — returns 400
  "Can't change status from Confirmed to Working.", and no write
  happens (confirm `upsertElement` is never called on this path).
- **`PATCH` changing `importance` to `"Minor"` while `depth` stays at
  an existing `5`**: `nextValue.depth` is `5` (unchanged, from the
  spread), `nextValue.importance` is `"Minor"` (from the patch) — the
  mismatch check now fires (Level 5 reserved for Critical), even though
  `depth` itself wasn't in this particular request body.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/world-chat/entries/route.ts
git commit -m "feat: add World Entry update (PATCH) route with status-transition and Importance/Depth checks"
```
