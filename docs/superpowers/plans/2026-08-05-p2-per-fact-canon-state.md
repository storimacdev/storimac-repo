# P2 Per-Fact Canon State Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Project 2's Character Bible interview real per-fact canon-state tracking (GitHub issue #29) by reusing Project 1's already-proven generic Canon Engine (`CanonElement`/`canonStore.ts`), scoped to the 11 Psychological-Engine fields the PRD/CDRM/issue #28 already name — not an independent state store, and not a premature guess at fields later issues haven't defined yet.

**Architecture:** Generalize `canonStore.ts` to accept an optional target collection (same pattern already used for `storyStore.ts`'s message functions), add a new closed field-vocabulary registry mirroring `elementRegistry.ts`, extend Project 2's turn schema/tool with an `updates` array mirroring Project 1's `StateDeltaSchema.updates`, and wire the chat route to apply those updates into a new `characterFacts` collection scoped per character via a composite `{charId}.{field}` ID.

**Tech Stack:** TypeScript, Firestore (via the existing `firebase-admin` Admin SDK), Zod, Anthropic tool-use.

## Global Constraints

- `canonStore.ts`'s generalization must not change Project 1's behavior — every existing P1 call site keeps working with zero argument changes (default parameter values preserve today's exact collection paths).
- The `field` enum in `factRegistry.ts` is exactly these 11 values, nothing more: `want`, `personality_how`, `need`, `values`, `life_experience`, `core_wound`, `false_belief`, `core_flaw`, `dominant_fear`, `defense_mechanisms`, `behavioral_trajectory`.
- `Deferred` is the only fact-state label the model or any P2-facing code ever sees or emits — `Parked` is an internal storage detail of the shared `CanonStatus` type and must never leak into P2's tool schema, Zod schema, or route-level naming.
- Unknown `field` values are accepted and logged, never rejected — same posture as Project 1's `element_id` fix (a hard rejection risks a new 502 class for an occasional model slip).
- No code changes to `elementRegistry.ts`, `stateDelta.ts`, or `web/src/app/api/chat/route.ts` (Project 1's own files) — this plan touches Project 2's files plus the one shared file (`canonStore.ts`) both projects depend on.

---

### Task 1: Generalize canonStore.ts for a second collection

**Files:**
- Modify: `web/src/lib/canonEngine/canonStore.ts`

**Interfaces:**
- Produces: `elementsCollection(storyId: string, collection: string = "elements")`, `getElement(storyId: string, elementId: string, collection: string = "elements")`, `listElements(storyId: string, collection: string = "elements")`, `applyStateDelta(storyId: string, updates: ElementUpdate[], turnId: string, collection: string = "elements")`, and a new exported constant `CHARACTER_FACTS_COLLECTION = "characterFacts"` — all consumed by Task 4.

- [ ] **Step 1: Add the `CHARACTER_FACTS_COLLECTION` constant**

Near the top of `web/src/lib/canonEngine/canonStore.ts`, immediately after the `CanonConflictError` class definition, add:
```ts
/** Project 2's per-character fact subcollection name (issue #29) - a
 * sibling to Project 1's default "elements" collection, sharing the same
 * transactional store/status-transition logic via the `collection`
 * parameter added to every function below. */
export const CHARACTER_FACTS_COLLECTION = "characterFacts";
```

- [ ] **Step 2: Generalize `elementsCollection`**

Find:
```ts
function elementsCollection(storyId: string) {
  return getDb().collection("stories").doc(storyId).collection("elements");
}
```
Replace with:
```ts
function elementsCollection(storyId: string, collection: string = "elements") {
  return getDb().collection("stories").doc(storyId).collection(collection);
}
```

- [ ] **Step 3: Generalize `getElement` and `listElements`**

Find:
```ts
export async function getElement(
  storyId: string,
  elementId: string
): Promise<CanonElement | null> {
  const snap = await elementsCollection(storyId).doc(elementId).get();
  return snap.exists ? (snap.data() as CanonElement) : null;
}

export async function listElements(storyId: string): Promise<CanonElement[]> {
  const snap = await elementsCollection(storyId).get();
  return snap.docs.map((d) => d.data() as CanonElement);
}
```
Replace with:
```ts
export async function getElement(
  storyId: string,
  elementId: string,
  collection: string = "elements"
): Promise<CanonElement | null> {
  const snap = await elementsCollection(storyId, collection).doc(elementId).get();
  return snap.exists ? (snap.data() as CanonElement) : null;
}

export async function listElements(storyId: string, collection: string = "elements"): Promise<CanonElement[]> {
  const snap = await elementsCollection(storyId, collection).get();
  return snap.docs.map((d) => d.data() as CanonElement);
}
```

- [ ] **Step 4: Generalize `applyStateDelta`**

Find (note the local variable is named `collection`, which would collide with a same-named new parameter — this step renames that local variable to `elementsRef` at the same time):
```ts
export async function applyStateDelta(
  storyId: string,
  updates: ElementUpdate[],
  turnId: string
): Promise<CanonElement[]> {
  if (updates.length === 0) return [];

  const db = getDb();
  const collection = elementsCollection(storyId);

  return db.runTransaction(async (tx) => {
    const refs = updates.map((u) => collection.doc(u.element_id));
```
Replace with:
```ts
export async function applyStateDelta(
  storyId: string,
  updates: ElementUpdate[],
  turnId: string,
  collection: string = "elements"
): Promise<CanonElement[]> {
  if (updates.length === 0) return [];

  const db = getDb();
  const elementsRef = elementsCollection(storyId, collection);

  return db.runTransaction(async (tx) => {
    const refs = updates.map((u) => elementsRef.doc(u.element_id));
```
The rest of `applyStateDelta`'s body (everything after this point, including the `tx.set(refs[i], next)` line and closing braces) is unchanged — it never references the old `collection` name again, only `refs`.

- [ ] **Step 5: Verify no other reference to the old local variable name remains**

Run: `grep -n "collection\." web/src/lib/canonEngine/canonStore.ts`
Expected: no matches referencing a bare `collection.` (e.g. `collection.doc`) — only `elementsRef.doc` should appear now, confirming the rename in Step 4 was complete. (`elementsCollection(` calls themselves are fine and expected to remain.)

- [ ] **Step 6: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. This confirms Project 1's existing call sites (`chat/route.ts`, `stage7Audit.ts`, wherever else imports from `canonStore.ts`) still compile with zero argument changes, since every new parameter has a default matching today's exact behavior.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/canonEngine/canonStore.ts
git commit -m "feat: generalize canonStore.ts to support a second collection (P2 facts)"
```

---

### Task 2: Character fact-field registry

**Files:**
- Create: `web/src/lib/characterEngine/factRegistry.ts`

**Interfaces:**
- Produces: `CHARACTER_FIELD_IDS: string[]` and `isKnownFieldId(id: string): boolean` — both consumed by Task 3 (`characterTurnSchema.ts`) and Task 4 (`character-chat/route.ts`).

This task is independent of Task 1 (no shared code) — order between them doesn't matter, but Task 3 depends on this one.

- [ ] **Step 1: Create the registry file**

```ts
/**
 * Canonical fact-field vocabulary for Project 2's Character Bible
 * interview - GitHub issue #29. Mirrors elementRegistry.ts's shape and
 * purpose: a closed vocabulary that steers the model's tool schema
 * (characterTurnSchema.ts) away from inventing field names, the same
 * lesson Project 1 learned the hard way from a freeform element_id field
 * (see docs/superpowers/specs/2026-08-04-stage-drift-catchup-design.md).
 *
 * Deliberately scoped to only what's explicitly named in the PRD/CDRM and
 * issue #28 today: the corrected Triad+Need, and the causal psychology
 * chain. Stages 1, 3, 4, 5, and 6's field vocabularies aren't fixed in the
 * source docs yet - inventing names for them now would risk the same
 * sibling-collision bug Project 1 just had fixed, self-inflicted this
 * time. Extend this array (don't create a parallel one) when a later
 * issue (#31 relationships, #34 compiler, or whichever issue covers
 * Stage 1/3/5's fields) defines more fields.
 */

export const CHARACTER_FIELD_IDS: string[] = [
  // Corrected Triad + Need (issue #28's corrected AC, PRD §5.3)
  "want",
  "personality_how",
  "need",
  "values",
  // Causal psychology chain (PRD §5.3, CDRM §3): Life Experience ->
  // Core Wound -> False Belief -> Core Flaw -> Dominant Fear ->
  // Defense Mechanisms -> Behavioral Trajectory
  "life_experience",
  "core_wound",
  "false_belief",
  "core_flaw",
  "dominant_fear",
  "defense_mechanisms",
  "behavioral_trajectory",
];

export function isKnownFieldId(id: string): boolean {
  return CHARACTER_FIELD_IDS.includes(id);
}
```

- [ ] **Step 2: Sanity-check the registry**

Confirm `CHARACTER_FIELD_IDS.length` is exactly 11 by counting the array entries above, and confirm there are no duplicate strings (all 11 are visibly distinct).

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (this file isn't imported anywhere yet, so it just needs to compile cleanly on its own).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/factRegistry.ts
git commit -m "feat: add character fact-field registry for Project 2 (#29)"
```

---

### Task 3: Extend the Project 2 turn schema with fact updates

**Files:**
- Modify: `web/src/lib/characterEngine/characterTurnSchema.ts`

**Interfaces:**
- Consumes: `CHARACTER_FIELD_IDS` from `./factRegistry` (Task 2).
- Produces: `FactUpdateSchema` (Zod), `type FactUpdateInput = z.infer<typeof FactUpdateSchema>`, and `CharacterTurnSchema`/`CharacterTurn`/`EMIT_CHARACTER_TURN_TOOL` all gaining an `updates` field — all consumed by Task 4.

- [ ] **Step 1: Replace the file's header comment**

Find:
```ts
/**
 * Project 2 turn schema/tool — GitHub issues #26/#27, reference: Project
 * 1's stateDelta.ts + extractTurn.ts's now-generic StructuredDeltaExtractor
 * (ARCHITECTURE.md §2). Deliberately minimal: no per-fact canon-tracking
 * field yet (that's issue #29's job, milestone M2) — just enough structured
 * output to drive sequential-character enforcement and the reply/context UI
 * split already proven on Project 1.
 */
```
Replace with:
```ts
/**
 * Project 2 turn schema/tool — GitHub issues #26/#27 (base turn shape) and
 * #29 (per-fact canon-tracking `updates`). Reference: Project 1's
 * stateDelta.ts + extractTurn.ts's now-generic StructuredDeltaExtractor
 * (ARCHITECTURE.md §2). Issue #29's architecture note: configure the
 * shared Canon Engine with Project 2's own field vocabulary, not an
 * independent state store - same pattern as Project 1's stateDelta.ts.
 * `updates`' `field` enum is deliberately scoped to only the Psychological
 * Engine's 11 known fields (factRegistry.ts) - see that file's own comment
 * for why the other 5 interview stages aren't covered yet.
 */
```

- [ ] **Step 2: Add the import**

Find:
```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
```
Add a third import line immediately after:
```ts
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { CHARACTER_FIELD_IDS } from "./factRegistry";
```

- [ ] **Step 3: Add `FactUpdateSchema` and extend `CharacterTurnSchema`**

Find:
```ts
export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  context: z.string().min(1),
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;
```
Replace with:
```ts
export const FactUpdateSchema = z.object({
  field: z.string().min(1),
  value: z.unknown().optional(),
  state: z.enum(["Exploring", "Working", "Confirmed", "Deferred"]).optional(),
  rationale: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
});

export type FactUpdateInput = z.infer<typeof FactUpdateSchema>;

export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  context: z.string().min(1),
  updates: z.array(FactUpdateSchema),
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;
```
Note `field` deliberately stays `z.string().min(1)` (not enum-constrained at the Zod level) - same posture as Project 1's `ElementUpdateSchema.element_id`. The enum constraint lives at the tool-schema level only (Step 4), so an occasional model slip outside the 11 known fields still validates and writes (logged, not rejected) rather than failing the whole turn.

- [ ] **Step 4: Add the `updates` property to `EMIT_CHARACTER_TURN_TOOL`**

Find:
```ts
      context: {
        type: "string",
        description:
          "Your reasoning, psychological analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief. Keep it to a few short paragraphs at most - this is internal reasoning, not a transcript.",
      },
    },
    required: ["reply", "current_character", "current_stage", "character_signed_off", "context"],
  },
};
```
Replace with:
```ts
      context: {
        type: "string",
        description:
          "Your reasoning, psychological analysis, and creative rationale for this turn - everything that used to go in reply's prose now goes here instead. Shown to the author separately from chat, never inside the numbered reply list. Required every turn, even if brief. Keep it to a few short paragraphs at most - this is internal reasoning, not a transcript.",
      },
      updates: {
        type: "array",
        description:
          "Canon fact changes proposed this turn, for current_character only. Empty array if none - most turns during Stages 1, 3, 4, 5, and 6 will have none, since only the Psychological Engine's fields (Stage 2) are tracked as facts today.",
        items: {
          type: "object",
          properties: {
            field: {
              type: "string",
              enum: CHARACTER_FIELD_IDS,
              description:
                "The canonical fact field this update is for - always pick the closest match from the enum. Never invent a new key.",
            },
            value: { description: "Author-facing value for this fact." },
            state: {
              type: "string",
              enum: ["Exploring", "Working", "Confirmed", "Deferred"],
              description:
                "This fact's canon state. Only Confirmed facts will ever appear in the compiled Character Bible.",
            },
            rationale: { type: "string" },
            depends_on: {
              type: "array",
              items: { type: "string", enum: CHARACTER_FIELD_IDS },
              description:
                "Other field names (from this same character) this fact causally depends on - e.g. core_flaw depends on core_wound or false_belief. Used to verify the psychological chain stays traceable.",
            },
          },
          required: ["field"],
        },
      },
    },
    required: ["reply", "current_character", "current_stage", "character_signed_off", "context", "updates"],
  },
};
```

- [ ] **Step 5: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/characterEngine/characterTurnSchema.ts
git commit -m "feat: add per-fact updates to the Project 2 turn schema (#29)"
```

---

### Task 4: Wire fact updates into the Character Bible chat route

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `applyStateDelta`, `CanonConflictError`, `CHARACTER_FACTS_COLLECTION`, `type ElementUpdate` from `@/lib/canonEngine/canonStore` (Task 1); `isKnownFieldId` from `@/lib/characterEngine/factRegistry` (Task 2); `FactUpdateInput` from `@/lib/characterEngine/characterTurnSchema` (Task 3); `delta.updates: FactUpdateInput[]` and `delta.current_character: string` (already exist on the turn, `current_character` from #26/#27, `updates` new from Task 3).

- [ ] **Step 1: Add the new imports**

Find:
```ts
import { getStory, appendMessage, listMessages, CHARACTER_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { computePriorityMatrix } from "@/lib/characterEngine/priorityMatrix";
import { getDepthLabel } from "@/lib/characterEngine/depthLabels";
import { CharacterTurnSchema, EMIT_CHARACTER_TURN_TOOL } from "@/lib/characterEngine/characterTurnSchema";
```
Replace with:
```ts
import { getStory, appendMessage, listMessages, CHARACTER_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
import { applyStateDelta, CanonConflictError, CHARACTER_FACTS_COLLECTION, type ElementUpdate } from "@/lib/canonEngine/canonStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { computePriorityMatrix } from "@/lib/characterEngine/priorityMatrix";
import { getDepthLabel } from "@/lib/characterEngine/depthLabels";
import { isKnownFieldId } from "@/lib/characterEngine/factRegistry";
import {
  CharacterTurnSchema,
  EMIT_CHARACTER_TURN_TOOL,
  type FactUpdateInput,
} from "@/lib/characterEngine/characterTurnSchema";
```

- [ ] **Step 2: Add `slugifyCharacterName` and `toFactUpdate` helpers**

Find the existing `export async function POST(req: NextRequest) {` line (the start of the route handler). Immediately above it, add:
```ts
function slugifyCharacterName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toFactUpdate(u: FactUpdateInput, charId: string): ElementUpdate {
  const patch: ElementUpdate["patch"] = {};
  if (u.value !== undefined) patch.value = u.value;
  if (u.state !== undefined) patch.status = u.state === "Deferred" ? "Parked" : u.state;
  if (u.rationale !== undefined) patch.rationale = u.rationale;
  if (u.depends_on !== undefined) patch.depends_on = u.depends_on.map((f) => `${charId}.${f}`);
  return { element_id: `${charId}.${u.field}`, patch };
}
```

- [ ] **Step 3: Apply fact updates after extracting the turn**

Find (the code immediately after the `extractTurn` try/catch block finishes, before the `appendMessage` call):
```ts
      throw err;
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
```
Replace with (inserting the new block between the two existing pieces):
```ts
      throw err;
    }

    const charId = slugifyCharacterName(delta.current_character);
    const factUpdates = delta.updates.map((u) => toFactUpdate(u, charId));
    for (const update of factUpdates) {
      const field = update.element_id.slice(charId.length + 1);
      if (!isKnownFieldId(field)) {
        console.warn(
          `[character-chat] unknown field "${field}" on turn ${turnId} - not in the Project 2 canonical registry, writing as-is`
        );
      }
    }
    if (factUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, factUpdates, turnId, CHARACTER_FACTS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying fact updates on turn ${turnId}:`, err.message);
      }
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Manual read-through check**

Confirm by reading the edited function: a turn where the model proposes `{ field: "core_wound", value: "...", state: "Confirmed" }` for `current_character: "Deva"` results in a call to `applyStateDelta` with one `ElementUpdate` whose `element_id` is `"deva.core_wound"` and whose `patch.status` is `"Confirmed"` (unchanged, since `"Confirmed"` isn't `"Deferred"`). Confirm a turn proposing `{ field: "false_belief", state: "Deferred" }` results in `patch.status: "Parked"` (translated). Confirm a turn with `updates: []` (the common case for Stages 1, 3, 4, 5, 6) skips the `applyStateDelta` call entirely (the `if (factUpdates.length > 0)` guard), matching `applyStateDelta`'s own early-return for an empty array — this guard is a minor optimization, not required for correctness, but avoids an unnecessary Firestore transaction on the common no-op turn.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: apply per-fact canon updates in the Character Bible chat route (#29)"
```
