# P3 Conflict Resolution Protocol (Issue #47) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect contradictions against the immutable Story Foundation or a previously `Confirmed` World Entry, halt forward progress on the affected thread, and force exactly three author choices — Revert / Revise (with a Dependency Review) / Defer — logging the resolution with a timestamp.

**Architecture:** Per the design spec (`docs/superpowers/specs/2026-09-11-p3-conflict-resolution-design.md`), the claimed shared `ConflictResolution` engine (issue #10) is not actually reused by Project 2 — P2 forked its own module because Foundation-prose contradiction has no deterministic detection. This plan follows P2's precedent: build a new, P3-local module. Two conflict kinds share one `story.p3PendingConflict` field and one Revert/Revise/Defer vocabulary, but "Revise" means different things per kind (the Foundation is immutable; a `Confirmed` World Entry is not).

**Tech Stack:** Zod turn schema, Firestore (new `p3ConflictLog` subcollection, new `p3PendingConflict` Story field), Next.js API route, new React component.

## Global Constraints

- Two conflict kinds: `confirmed_entry` (a proposed edit contradicts a `Confirmed` World Entry — detected structurally, deterministic) and `foundation` (a new idea contradicts the immutable Story Foundation — detected via model self-report, mirroring issue #32/P2's precedent that there is "no deterministic way to judge" contradiction against prose).
- Resolution labels are always Revert / Revise / Defer (per the architecture note's instruction to use P3's own copy, not P1's "Keep Canon/Accept & Update/Park" or P2's "revert/update_foundation/park"). Internally: `resolution: "revert" | "revise" | "defer"`.
- "Revise" for `confirmed_entry`: apply the proposed new value to the entry, show the resulting Dependency Review (which other entries depend on it). "Revise" for `foundation`: there is no mutable target to revise (the Foundation is immutable) — mirrors P2's own `"update_foundation"` precedent: the new idea proceeds as the World Bible's working position from here on; no Dependency Review section (nothing to cascade from prose).
- "Defer" for `confirmed_entry`: add an `OutstandingQuestion` to the entry itself (visible via issue #45's side panel). "Defer" for `foundation` (no specific entry): use the generic `outstanding_questions` subcollection with `defer_to: null`.
- While `story.p3PendingConflict` is set and not yet resolved this turn, the Stage 3 write block (issue #43) must not act on `delta.proposed_entry`/`delta.active_pillar` at all — halts forward progress, mirroring Project 1/2's existing single-pending-conflict convention exactly (not thread-scoped partial halting, which neither precedent implements and the AC doesn't clearly require).
- Do NOT fix or extend `canonStore.ts`'s `listDependents`/`listDownstreamImpact` (hardcoded to the `"elements"` collection) — that generalization is issue #48's explicit, already-assigned job. This plan's Dependency Review uses a new, P3-scoped, in-memory computation instead (`listElements(storyId, WORLD_ENTRIES_COLLECTION)` + filter), not the shared function.
- Every new Firestore write introduced by this plan (`setP3PendingConflict`, `appendP3ConflictLog`, `appendOutstandingQuestions`, the entry-level `outstandingQuestions` append) must degrade gracefully if it throws — logged via `console.warn`, never a hard error to the author, matching issue #43's established pattern, since the assistant's reply is already persisted to the transcript by the time this code runs.
- The direct World Entry CRUD API (`entries/route.ts`) is unaffected by this plan — its `updateWorldEntry` call already just returns `result.error` generically regardless of the new `reason` field, so its behavior for a direct author PATCH against a Confirmed entry is unchanged (still a hard rejection, by design — only the chat-driven proposal path gets the new three-way flow).

---

### Task 1: Add conflict fields to the World turn schema

**Files:**
- Modify: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- `WorldTurnSchema` gains `conflict_detected: z.boolean()`, `conflict_description: z.string().nullable()`, `resolution: z.enum(["revert", "revise", "defer"]).nullable()`. `EMIT_WORLD_TURN_TOOL`'s `required` array gains all three names. A later task reads `delta.conflict_detected`, `delta.conflict_description`, `delta.resolution`.

- [ ] **Step 1: Add the three fields to `WorldTurnSchema`**

Add after the existing `deferred_items: z.array(WorldDeferredItemSchema),` line:

```ts
  conflict_detected: z.boolean(),
  conflict_description: z.string().nullable(),
  resolution: z.enum(["revert", "revise", "defer"]).nullable(),
```

- [ ] **Step 2: Add the three fields to `EMIT_WORLD_TURN_TOOL`'s `properties`**

Add after the existing `deferred_items` property block:

```ts
      conflict_detected: {
        type: "boolean",
        description:
          "True only on the turn where you notice the author's new idea contradicts the immutable Story Foundation (not a Confirmed World Entry - that's detected separately by the app). False on every other turn, including every turn while a conflict is already pending your author's choice.",
      },
      conflict_description: {
        type: ["string", "null"],
        description:
          "A concise description of the Story-Foundation contradiction, set only when conflict_detected is true this turn or a Foundation-level conflict is still pending from an earlier turn. Null otherwise.",
      },
      resolution: {
        type: ["string", "null"],
        enum: ["revert", "revise", "defer", null],
        description:
          "Set only on the turn where the author has just given a clear verdict on a pending conflict (Foundation or Confirmed-canon, whichever is currently open - the app will tell you which via a [CONFLICT DETECTED...] note): revert (keep things as they are), revise (accept the new idea, updating canon), or defer (park the decision for now). Null on every other turn.",
      },
```

- [ ] **Step 3: Add all three names to the `required` array**

The array currently ends with `"deferred_items"`. Add `"conflict_detected", "conflict_description", "resolution"` after it.

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. No other file constructs a full `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL` object literal yet (a later task is the only consumer), so this should not force any other file to change — if it does, apply the minimal fix and explain in your report, per the established pattern from issue #43's Task 2.

Manually trace 3 scenarios against the real Zod schema (a `tsx` script is fastest): (a) all three fields at their "nothing happening" defaults (`conflict_detected: false, conflict_description: null, resolution: null`) — parses; (b) `conflict_detected: true, conflict_description: "The author wants X, but the Foundation says Y.", resolution: null` — parses; (c) `resolution: "revise"` with `conflict_detected: false, conflict_description: null` — parses (the schema itself doesn't need to enforce "resolution only makes sense when a conflict is pending" — that's application logic in a later task, not a schema-level constraint).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add conflict_detected, conflict_description, and resolution fields to WorldTurnSchema (issue #47)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 2: Add P3's pending-conflict state and conflict log to `storyStore.ts`

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `export type P3PendingConflict = { kind: "confirmed_entry"; entryId: string; entryName: string; oldValue: unknown; newValue: unknown; ts: string } | { kind: "foundation"; description: string; ts: string };` — a new `Story.p3PendingConflict?: P3PendingConflict | null` field, `export async function setP3PendingConflict(storyId: string, conflict: P3PendingConflict | null): Promise<void>`, `export interface P3ConflictLogEntry { kind: "confirmed_entry" | "foundation"; description: string; entryId?: string; resolution: "revert" | "revise" | "defer"; resolvedBy: string; ts: string; turnId: string; }`, `export async function appendP3ConflictLog(storyId: string, entry: P3ConflictLogEntry): Promise<void>`, `export async function listP3ConflictLog(storyId: string): Promise<P3ConflictLogEntry[]>`. Later tasks import all of these.

This mirrors `P2PendingConflict`/`setP2PendingConflict`/`CharacterConflictLogEntry`/`appendCharacterConflictLog` exactly in pattern (read those in this same file, around the `P2PendingConflict` and `CharacterConflictLogEntry` definitions, if you want the precedent alongside what you're writing) — a fresh, P3-shaped copy, not a generalization of P2's version.

- [ ] **Step 1: Add the `P3PendingConflict` type**

Add near `P2PendingConflict`'s definition (same section of the file):

```ts
/** Project 3's pending conflict (issue #47) - either a proposed edit
 * contradicting a Confirmed World Entry (detected structurally, hence
 * old_value/new_value under the same entryId - same shape as P1's own
 * StoryPendingConflict) or a new idea contradicting the immutable Story
 * Foundation (detected via model self-report, same as P2PendingConflict,
 * since there's no deterministic way to judge contradiction against
 * prose). Singular, like P1/P2's own pending-conflict fields - only one
 * conflict is ever open at a time. */
export type P3PendingConflict =
  | { kind: "confirmed_entry"; entryId: string; entryName: string; oldValue: unknown; newValue: unknown; ts: string }
  | { kind: "foundation"; description: string; ts: string };
```

- [ ] **Step 2: Add the `Story.p3PendingConflict` field**

Add near the existing `p2PendingConflict?: P2PendingConflict | null;` field on the `Story` interface:

```ts
  /**
   * Project 3's pending conflict (issue #47), cleared once the author
   * picks one of the three resolution choices. Optional/nullable since
   * Stories created before this field existed won't have it in
   * Firestore.
   */
  p3PendingConflict?: P3PendingConflict | null;
```

- [ ] **Step 3: Add `setP3PendingConflict`**

Add near `setP2PendingConflict`:

```ts
/** Records or clears Project 3's pending conflict (issue #47); pass null to clear once resolved. */
export async function setP3PendingConflict(
  storyId: string,
  conflict: P3PendingConflict | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p3PendingConflict: conflict, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Add the `p3ConflictLog` collection + append/list functions**

Add near `CharacterConflictLogEntry`/`appendCharacterConflictLog`/`characterConflictsLogCollection`:

```ts
/** Project 3's conflict resolution log (issue #47, PRD §4.5) - one entry per resolved conflict, either kind. */
export interface P3ConflictLogEntry {
  kind: "confirmed_entry" | "foundation";
  description: string;
  /** Present only for kind "confirmed_entry". */
  entryId?: string;
  resolution: "revert" | "revise" | "defer";
  resolvedBy: string;
  ts: string;
  turnId: string;
}

function p3ConflictLogCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("p3ConflictLog");
}

/** Appends a resolved conflict to Project 3's conflict log (issue #47). */
export async function appendP3ConflictLog(storyId: string, entry: P3ConflictLogEntry): Promise<void> {
  await p3ConflictLogCollection(storyId).add(entry);
}

export async function listP3ConflictLog(storyId: string): Promise<P3ConflictLogEntry[]> {
  const snap = await p3ConflictLogCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as P3ConflictLogEntry);
}
```

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. Nothing else constructs a full `Story` object literal (Firestore documents are read via `.data() as Story`, not hand-built), so this should not force any other file to change.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: add P3PendingConflict state and p3ConflictLog to storyStore (issue #47)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 3: Make `updateWorldEntry`'s Confirmed-value guard return conflict data instead of just failing

**Files:**
- Modify: `web/src/lib/worldEngine/worldEntryStore.ts`

**Interfaces:**
- Changes `UpdateWorldEntryResult`'s `{ok:false}` variant from `{ ok: false; error: string }` to `{ ok: false; error: string; reason: "not_found" | "invalid_transition" | "confirmed_conflict"; conflict?: { entryId: string; entryName: string; oldValue: WorldEntryValue; newValue: WorldEntryValue } }` — `conflict` is present only when `reason === "confirmed_conflict"`. A later task reads `result.reason`/`result.conflict` when wiring the chat turn handler; the direct CRUD API (`entries/route.ts`) already just returns `result.error` regardless of `reason`, so it needs no change.

This is a refactor of the existing guard, not new logic: today the guard blocks with a hard error before it ever computes `nextValue`. This task moves the `nextValue` computation earlier so both the conflict path and the normal path can use it (currently `nextValue` is computed once, after the guard - after this change, it's computed once, before the guard, and reused by both).

- [ ] **Step 1: Restructure `updateWorldEntry`**

Replace the entire function body (everything from `export async function updateWorldEntry(` through its closing `}`) with:

```ts
export async function updateWorldEntry(
  storyId: string,
  entryId: string,
  input: UpdateWorldEntryInput
): Promise<UpdateWorldEntryResult> {
  const existing = await getElement(storyId, entryId, WORLD_ENTRIES_COLLECTION);
  if (!existing) {
    return { ok: false, error: "World Entry not found.", reason: "not_found" };
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

  if (existing.status === "Confirmed" && valueFieldsPresent && !leavingConfirmed) {
    // issue #47: this used to be a hard block ("Conflict Resolution for
    // Confirmed canon isn't available yet"). Now it hands the caller
    // everything needed to open the real three-way flow instead of just
    // failing - the direct CRUD API (entries/route.ts) still just
    // returns `error` generically and is unaffected by this change.
    return {
      ok: false,
      reason: "confirmed_conflict",
      error: "This entry is Confirmed canon and the proposed change conflicts with it.",
      conflict: { entryId, entryName: currentValue.name, oldValue: currentValue, newValue: nextValue },
    };
  }

  const patch: { value: WorldEntryValue; depends_on?: string[]; status?: CanonStatus } = { value: nextValue };

  if (input.dependsOn !== undefined) {
    patch.depends_on = input.dependsOn;
  }

  if (input.status !== undefined) {
    const nextStatus: CanonStatus = input.status === "Deferred" ? "Parked" : input.status;
    if (!isValidTransition(existing.status, nextStatus)) {
      const currentLabel = existing.status === "Parked" ? "Deferred" : existing.status;
      return { ok: false, error: `Can't change status from ${currentLabel} to ${input.status}.`, reason: "invalid_transition" };
    }
    patch.status = nextStatus;
  }

  // allowConfirmedOverride stays true here because the Confirmed-value
  // guard above already blocks any content edit to a Confirmed entry
  // regardless of caller - both the direct PATCH API and the world-chat
  // turn handler (issue #43) reach this same guard before this call, so
  // neither can use this override to bypass it. The Conflict Resolution
  // flow (issue #47) legitimately bypasses this guard entirely by
  // calling upsertElement directly instead of this function - see
  // conflictResolution.ts.
  const element = await upsertElement(storyId, entryId, patch, randomUUID(), true, WORLD_ENTRIES_COLLECTION);

  return { ok: true, element, warning: checkImportanceDepthMismatch(nextValue.importance, nextValue.depth) };
}
```

- [ ] **Step 2: Update `UpdateWorldEntryResult`'s type**

Replace:

```ts
export type UpdateWorldEntryResult =
  | { ok: true; element: CanonElement; warning: ImportanceDepthCheck }
  | { ok: false; error: string };
```

with:

```ts
export type UpdateWorldEntryResult =
  | { ok: true; element: CanonElement; warning: ImportanceDepthCheck }
  | {
      ok: false;
      error: string;
      reason: "not_found" | "invalid_transition" | "confirmed_conflict";
      conflict?: { entryId: string; entryName: string; oldValue: WorldEntryValue; newValue: WorldEntryValue };
    };
```

- [ ] **Step 3: Verify no behavior change for existing callers**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean — this will surface any place that destructures `UpdateWorldEntryResult`'s `{ok:false}` branch without the new required `reason` field causing a type error (TypeScript won't actually error here, since `reason` is only required on the `{ok:false}` object literal returned FROM this function, not on the CONSUMING side's destructuring — but check `world-chat/route.ts`'s existing `{ok:false}` handling (`console.warn(...result.error...)`) and `entries/route.ts`'s PATCH handler still compile correctly and behave identically, since both only read `.error`, never `.reason` yet).

Manually trace 3 scenarios (a `tsx` script against the real function, or careful by-hand tracing): (a) updating a non-Confirmed entry's content — unaffected, still returns `{ok:true, ...}`; (b) updating a Confirmed entry's status only (e.g. to `"Deferred"`) with no content fields — unaffected (leavingConfirmed=true bypasses the guard, same as before); (c) updating a Confirmed entry's content (e.g. `functionalDescription`) with no status change — now returns `{ok:false, reason:"confirmed_conflict", conflict:{entryId, entryName, oldValue, newValue}}` instead of the old plain error — confirm `oldValue`/`newValue` are correct (`oldValue` unchanged from the entry's current value, `newValue` reflecting the proposed edit merged in).

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/worldEngine/worldEntryStore.ts
git commit -m "feat: return structured conflict data from updateWorldEntry's Confirmed-value guard (issue #47)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 4: Build the P3 conflict-resolution module

**Files:**
- Create: `web/src/lib/worldEngine/conflictResolution.ts`

**Interfaces:**
- Consumes: `upsertElement`, `getElement`, `listElements`, `WORLD_ENTRIES_COLLECTION` from `@/lib/canonEngine/canonStore` (all already exist). `appendOutstandingQuestions`, `appendP3ConflictLog`, `type P3PendingConflict` from `@/lib/canonEngine/storyStore` (Task 2). `type WorldEntryValue` from `./worldEntry`.
- Produces: `export function buildConflictContextMessage(conflict: P3PendingConflict): string`, `export async function computeCascadeReview(storyId: string, entryId: string): Promise<{ entryId: string; name: string }[]>`, `export interface ResolveP3ConflictParams { storyId: string; conflict: P3PendingConflict; resolution: "revert" | "revise" | "defer"; turnId: string; resolvedBy: string; }`, `export interface ResolveP3ConflictResult { cascadeReview: { entryId: string; name: string }[] | null; }`, `export async function resolveP3Conflict(params: ResolveP3ConflictParams): Promise<ResolveP3ConflictResult>`. A later task imports all of `buildConflictContextMessage`, `resolveP3Conflict` (and, indirectly, uses the `cascadeReview` result).

- [ ] **Step 1: Create the module**

Create `web/src/lib/worldEngine/conflictResolution.ts`:

```ts
import { getElement, listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
import { appendOutstandingQuestions, appendP3ConflictLog, type P3PendingConflict } from "@/lib/canonEngine/storyStore";
import type { WorldEntryValue } from "./worldEntry";

/**
 * Project 3's Conflict Resolution Protocol (issue #47) - a fresh,
 * P3-local module, not a call-through to canonEngine/conflictResolution.ts
 * (issue #10's reference implementation). Investigated first: Project 2
 * doesn't call that module either - it forked its own
 * (characterEngine/foundationConflict.ts) because Foundation-prose
 * contradiction has no deterministic detection, and P1's version is
 * hardcoded to the "elements" collection anyway. This module follows
 * P2's precedent (a bespoke fork, P3's own vocabulary) rather than P1's
 * literal functions. See the design doc
 * (docs/superpowers/specs/2026-09-11-p3-conflict-resolution-design.md)
 * for the full reasoning, including why "Revise" means something
 * different for each of the two conflict kinds (the Foundation is
 * immutable; a Confirmed World Entry is not).
 */

export function buildConflictContextMessage(conflict: P3PendingConflict): string {
  const description =
    conflict.kind === "confirmed_entry"
      ? `The proposed change to "${conflict.entryName}" contradicts its Confirmed canon.`
      : conflict.description;
  const revisePhrase =
    conflict.kind === "confirmed_entry"
      ? "Revise the existing canon to match the new idea (this may affect other entries that depend on it)"
      : "Accept the new idea as the working position going forward";
  return `\n\n[CONFLICT DETECTED - internal grounding only, never narrate this raw data to the author. ${description} Present the author with exactly three choices in your reply, in your own words: (A) Revert the new idea and keep things as they are, (B) ${revisePhrase}, (C) Defer the decision for now and note it as an outstanding question. Once the author clearly picks one, set resolution to "revert", "revise", or "defer" on your next structured output - do not act on any Stage 3 proposal until this is resolved.]`;
}

/**
 * Every Confirmed World Entry whose depends_on includes entryId - AC-(B)'s
 * Dependency Review. A direct, P3-scoped in-memory filter over
 * listElements(WORLD_ENTRIES_COLLECTION), not the shared
 * canonStore.ts#listDependents (hardcoded to the "elements" collection;
 * generalizing that is issue #48's job, tracked separately - see the
 * design doc's Global Constraints).
 */
export async function computeCascadeReview(
  storyId: string,
  entryId: string
): Promise<{ entryId: string; name: string }[]> {
  const allEntries = await listElements(storyId, WORLD_ENTRIES_COLLECTION);
  return allEntries
    .filter((e) => e.status === "Confirmed" && (e.depends_on ?? []).includes(entryId))
    .map((e) => ({ entryId: e.element_id, name: (e.value as WorldEntryValue | undefined)?.name ?? e.element_id }));
}

export interface ResolveP3ConflictParams {
  storyId: string;
  conflict: P3PendingConflict;
  resolution: "revert" | "revise" | "defer";
  turnId: string;
  resolvedBy: string;
}

export interface ResolveP3ConflictResult {
  cascadeReview: { entryId: string; name: string }[] | null;
}

export async function resolveP3Conflict(params: ResolveP3ConflictParams): Promise<ResolveP3ConflictResult> {
  const { storyId, conflict, resolution, turnId, resolvedBy } = params;
  let cascadeReview: { entryId: string; name: string }[] | null = null;

  if (resolution === "revise" && conflict.kind === "confirmed_entry") {
    // The entry IS mutable canon - write the proposed new value directly
    // via upsertElement (bypassing updateWorldEntry's guard entirely,
    // which is exactly what that guard's own comment reserves this flow
    // for), keeping status Confirmed, then show what else depends on it.
    await upsertElement(
      storyId,
      conflict.entryId,
      { value: conflict.newValue as WorldEntryValue, status: "Confirmed" },
      turnId,
      true,
      WORLD_ENTRIES_COLLECTION
    );
    cascadeReview = await computeCascadeReview(storyId, conflict.entryId);
  } else if (resolution === "defer" && conflict.kind === "confirmed_entry") {
    const existing = await getElement(storyId, conflict.entryId, WORLD_ENTRIES_COLLECTION);
    if (existing) {
      const currentValue = existing.value as WorldEntryValue;
      const updatedValue: WorldEntryValue = {
        ...currentValue,
        outstandingQuestions: [
          ...currentValue.outstandingQuestions,
          {
            item: "Conflicting idea deferred",
            notes: `A proposed change to "${conflict.entryName}" was deferred rather than applied - see the conflict log for the original proposal.`,
          },
        ],
      };
      await upsertElement(storyId, conflict.entryId, { value: updatedValue }, turnId, true, WORLD_ENTRIES_COLLECTION);
    }
  } else if (resolution === "defer" && conflict.kind === "foundation") {
    await appendOutstandingQuestions(storyId, [
      { item: conflict.description, defer_to: null, notes: "Deferred via the Conflict Resolution Protocol." },
    ]);
  }
  // "revert" (either kind) and "revise" for a foundation-kind conflict
  // need no additional write beyond the log below - revert keeps
  // existing state untouched by definition, and a foundation-kind
  // "revise" has no specific stored value to change (see this module's
  // header comment).

  await appendP3ConflictLog(storyId, {
    kind: conflict.kind,
    description: conflict.kind === "confirmed_entry" ? `Confirmed entry "${conflict.entryName}"` : conflict.description,
    entryId: conflict.kind === "confirmed_entry" ? conflict.entryId : undefined,
    resolution,
    resolvedBy,
    ts: new Date().toISOString(),
    turnId,
  });

  return { cascadeReview };
}
```

- [ ] **Step 2: Verify with manual trace scenarios**

Run `npm run lint` and `npm run build` from `web/` (both must be clean; this module isn't imported anywhere yet, so this only confirms it's syntactically/type-correct in isolation). Then manually trace (a `tsx` script exercising `buildConflictContextMessage` and `computeCascadeReview` directly against constructed inputs is the fastest way, since `resolveP3Conflict` needs a real Firestore-backed story to fully exercise — trace that one by careful reading instead):

1. `buildConflictContextMessage({kind: "confirmed_entry", entryId: "x", entryName: "The Assize of Salt", oldValue: {}, newValue: {}, ts: "..."})` — confirm the returned string names "The Assize of Salt" and includes the "(this may affect other entries that depend on it)" phrase for the Revise choice.
2. `buildConflictContextMessage({kind: "foundation", description: "The author wants a monarchy, but the Foundation says this world has no centralized government.", ts: "..."})` — confirm the returned string includes that description verbatim and uses "Accept the new idea as the working position going forward" for the Revise choice (not the entry-specific phrasing).
3. `computeCascadeReview` — by reading, not running (no live Firestore in this trace): confirm it correctly filters to `status === "Confirmed"` only and correctly falls back to the raw `entryId` if `value.name` is somehow missing.
4. `resolveP3Conflict` — by reading: confirm the `resolution === "revise" && conflict.kind === "confirmed_entry"` branch calls `upsertElement` with `allowConfirmedOverride: true` (the 4th positional arg) and `WORLD_ENTRIES_COLLECTION` (the 5th) - get the exact `upsertElement` signature right by reading `canonStore.ts`'s definition, don't guess the argument order.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/conflictResolution.ts
git commit -m "feat: add P3 conflict-resolution module (issue #47)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 5: Wire conflict detection and resolution into `world-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `setP3PendingConflict`, `type P3PendingConflict` (add to the existing `@/lib/canonEngine/storyStore` import block). `buildConflictContextMessage`, `resolveP3Conflict` from `@/lib/worldEngine/conflictResolution` (Task 4). `updateWorldEntry`'s new `result.reason`/`result.conflict` fields (Task 3) - already imported via the existing `createWorldEntry, updateWorldEntry` import.

The current file (as of this plan being written) has, in order: the World Entries grounding block, the Final-reminder block, `extractTurn`, the scope-guardrail block (issue #46), `appendMessage`/`logTurnHeuristics`, the deferred-items persistence, the WCL/Pillar proposal tracking, the Stage 3 try/catch block (issue #43), and the final `return NextResponse.json(...)`.

- [ ] **Step 1: Add the imports**

Add `setP3PendingConflict,` and `type P3PendingConflict,` into the existing `@/lib/canonEngine/storyStore` import block (alongside `getStory, appendMessage, ...`).

Add a new import line:

```ts
import { buildConflictContextMessage, resolveP3Conflict } from "@/lib/worldEngine/conflictResolution";
```

- [ ] **Step 2: Read `story.p3PendingConflict` and inject its grounding block**

Right after the block that reads `const story = await getStory(storyId);` (near the top of the handler), no change needed there - `story.p3PendingConflict` is already available on the fetched `story` object once Task 2 lands (it's just a new optional field on the existing `Story` type).

Find the World Entries grounding block (the code building `system += \`\n\n[World Entries So Far...\``). Immediately after that block's closing `}`, and before the "Issue #110: closing reminder" comment/block, insert:

```ts
    // Conflict Resolution Protocol grounding (issue #47) - only while a
    // conflict is genuinely open; cleared once resolved (Step 5 below).
    const pendingConflictBefore = story.p3PendingConflict ?? null;
    if (pendingConflictBefore) {
      system += buildConflictContextMessage(pendingConflictBefore);
    }
```

- [ ] **Step 3: Resolve a pending conflict, or detect a new Foundation-level one**

Find the existing WCL/Pillar proposal tracking block (`let p3ForResponse: P3State = normalizeP3(story.p3); if (delta.proposed_wcl !== null) {...} if (delta.proposed_pillars !== null) {...}`). Immediately after that block's closing `}` and BEFORE the Stage 3 try/catch block, insert:

```ts
    // Conflict Resolution Protocol (issue #47) - resolves an already-open
    // conflict if the author just picked a choice, or opens a new
    // Foundation-level one if the model self-reported a contradiction
    // this turn. Runs before Stage 3 below so that block can check
    // whether a conflict is still open and, if so, skip all Stage 3
    // writes this turn (halts forward progress per the AC).
    let pendingConflictForResponse: P3PendingConflict | null = pendingConflictBefore;
    let cascadeReview: { entryId: string; name: string }[] | null = null;
    try {
      if (pendingConflictBefore && delta.resolution !== null) {
        const result = await resolveP3Conflict({
          storyId,
          conflict: pendingConflictBefore,
          resolution: delta.resolution,
          turnId,
          resolvedBy: user.uid,
        });
        cascadeReview = result.cascadeReview;
        pendingConflictForResponse = null;
        await setP3PendingConflict(storyId, null);
      } else if (!pendingConflictBefore && delta.conflict_detected) {
        const newConflict: P3PendingConflict = {
          kind: "foundation",
          description: delta.conflict_description ?? "The model flagged a contradiction but gave no description.",
          ts: new Date().toISOString(),
        };
        pendingConflictForResponse = newConflict;
        await setP3PendingConflict(storyId, newConflict);
      }
    } catch (conflictErr) {
      console.warn(`[world-chat] conflict resolution failed for turn ${turnId}:`, conflictErr);
    }
```

- [ ] **Step 4: Halt Stage 3 while a conflict is open, and detect new `confirmed_entry` conflicts**

Find the entire Stage 3 try/catch block, from `let entryWarning: ImportanceDepthCheck | null = null;` through its closing `} catch (stage3Err) { console.warn(...); }`. This is deliberately a minimal-diff change, not a re-indent: the two existing top-level `if` statements inside the `try` each just gain an extra guard clause, so their bodies don't move or change indentation at all. Replace the entire block with:

```ts
    let entryWarning: ImportanceDepthCheck | null = null;
    try {
      if (pendingConflictForResponse) {
        // A conflict is still open (either just detected this turn, or
        // still awaiting the author's choice from an earlier turn) -
        // halt Stage 3 forward progress entirely this turn, matching
        // Project 1/2's existing single-pending-conflict convention.
      } else if (delta.active_pillar !== p3ForResponse.activePillar) {
        await setP3ActivePillar(storyId, delta.active_pillar);
        p3ForResponse = { ...p3ForResponse, activePillar: delta.active_pillar };
      }

      if (!pendingConflictForResponse && delta.proposed_entry) {
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
          const { element, warning } = await createWorldEntry(storyId, entryInput);
          entryWarning = warning;
          if (delta.validated_status !== null) {
            const validation = await updateWorldEntry(storyId, element.element_id, {
              status: delta.validated_status,
            });
            if (validation.ok) {
              entryWarning = validation.warning;
            } else {
              console.warn(`[world-chat] validated_status rejected for turn ${turnId}: ${validation.error}`);
            }
          }
        } else {
          const result = await updateWorldEntry(storyId, delta.proposed_entry.entry_id, entryInput);
          if (result.ok) {
            entryWarning = result.warning;
          } else if (result.reason === "confirmed_conflict" && result.conflict) {
            const newConflict: P3PendingConflict = {
              kind: "confirmed_entry",
              entryId: result.conflict.entryId,
              entryName: result.conflict.entryName,
              oldValue: result.conflict.oldValue,
              newValue: result.conflict.newValue,
              ts: new Date().toISOString(),
            };
            pendingConflictForResponse = newConflict;
            await setP3PendingConflict(storyId, newConflict);
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
    } catch (stage3Err) {
      console.warn(`[world-chat] Stage 3 lock/entry persistence failed for turn ${turnId}:`, stage3Err);
    }
```

The only real changes versus the original block: (1) the first `if` gained a preceding `if (pendingConflictForResponse) { /* halt, no-op */ } else if (...)` wrapper: `if (pendingConflictForResponse) {} else if (delta.active_pillar !== ...)`, done here as one `if/else if` pair rather than two independent statements, since both conditions govern the same activePillar-lock concern; (2) the second `if (delta.proposed_entry)` gained a `!pendingConflictForResponse &&` clause; (3) inside the existing-entry `else` branch, one new `else if (result.reason === "confirmed_conflict" && result.conflict)` arm was inserted before the pre-existing generic `else`. Nothing else moved.

- [ ] **Step 5: Return the pending conflict and cascade review in the response**

Find the final `return NextResponse.json({...})` block. Add two fields:

```ts
    return NextResponse.json({
      reply: finalReply,
      context: finalContext,
      current_stage: delta.current_stage,
      p3: p3ForResponse,
      entryWarning,
      pendingConflict: pendingConflictForResponse,
      cascadeReview,
    });
```

- [ ] **Step 6: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

Manually trace these scenarios (a `tsx` script isolating just the branching logic, mirroring the real code's structure, is the most reliable way — there is no automated test runner in this repo):

1. No pending conflict before this turn, `delta.conflict_detected = false`, no `proposed_entry` targeting a Confirmed entry → `pendingConflictForResponse` stays `null` throughout, Stage 3 proceeds normally (the `else if` chain reaches the real Stage 3 logic), response's `pendingConflict` is `null`.
2. No pending conflict before, `delta.conflict_detected = true` with a description → a new `foundation`-kind conflict is set via `setP3PendingConflict`, `pendingConflictForResponse` is non-null, and because of that, Stage 3's `if (pendingConflictForResponse)` branch is taken this SAME turn (no entry work happens even though this is the turn the conflict was first detected).
3. A `foundation`-kind conflict was already pending, this turn `delta.resolution = "revise"` → `resolveP3Conflict` is called, `pendingConflictForResponse` becomes `null`, `setP3PendingConflict(storyId, null)` clears it, and because `pendingConflictForResponse` is now null, Stage 3 proceeds normally this same turn (the author's resolution and a fresh Stage 3 proposal can land in the same turn).
4. A `confirmed_entry`-kind conflict was already pending, this turn `delta.resolution = "defer"` → `resolveP3Conflict` is called with `resolution: "defer"`, which (per Task 4) appends an `OutstandingQuestion` to that specific entry and logs the resolution; confirm the response's `cascadeReview` is `null` (only populated on `resolve`+`confirmed_entry`).
5. No pending conflict before, `delta.proposed_entry` targets an existing entry that's `Confirmed`, and the content fields differ → `updateWorldEntry` returns `{ok:false, reason:"confirmed_conflict", conflict:{...}}`, a new `confirmed_entry`-kind conflict is set, `pendingConflictForResponse` becomes non-null for THIS turn's response (even though Stage 3's halt-check ran before this specific rejection happened - confirm this is fine: the halt-check at the top of the block only matters for the NEXT turn, since this turn's Stage 3 code is what's currently executing and detecting the conflict for the first time).
6. `appendP3ConflictLog`/`setP3PendingConflict` throwing inside the Step 3 try/catch → confirm the catch logs via `console.warn` and the function still proceeds normally to Stage 3 and the final response (same degrade-gracefully pattern already proven for issue #43's own try/catch just below).

- [ ] **Step 7: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: wire Conflict Resolution Protocol into the world-chat turn handler (issue #47)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 6: Build the conflict UI and wire it into `WorldInterview.tsx`

**Files:**
- Create: `web/src/components/ConflictCard.tsx`
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- `ConflictCard` (new): props `{ conflict: { kind: "confirmed_entry" | "foundation"; entryName?: string; description?: string }; cascadeReview: { entryId: string; name: string }[] | null; onChoose: (choice: "revert" | "revise" | "defer") => void; disabled: boolean }`. `WorldInterview.tsx` renders it.

This follows **Project 1's** existing UI precedent (`ChatInterview.tsx`'s conflict card with three lettered buttons that send canned confirmation messages through the normal chat flow) rather than Project 2's purely-conversational approach (no UI at all) - the AC's own wording ("halt forward progress and **force** a three-way choice... enforced... not left to the model to remember unaided") reads as wanting a real UI affordance. Read `web/src/components/ChatInterview.tsx`'s conflict-card section first if you want to see that precedent directly.

- [ ] **Step 1: Create `ConflictCard.tsx`**

Create `web/src/components/ConflictCard.tsx`:

```tsx
"use client";

export interface ConflictCardConflict {
  kind: "confirmed_entry" | "foundation";
  entryName?: string;
  description?: string;
}

export interface ConflictCardProps {
  conflict: ConflictCardConflict;
  cascadeReview: { entryId: string; name: string }[] | null;
  onChoose: (choice: "revert" | "revise" | "defer") => void;
  disabled: boolean;
}

const CHOICES: { letter: string; label: string; choice: "revert" | "revise" | "defer" }[] = [
  { letter: "A", label: "Revert", choice: "revert" },
  { letter: "B", label: "Revise", choice: "revise" },
  { letter: "C", label: "Defer", choice: "defer" },
];

export default function ConflictCard({ conflict, cascadeReview, onChoose, disabled }: ConflictCardProps) {
  const description =
    conflict.kind === "confirmed_entry"
      ? `This contradicts the Confirmed canon for "${conflict.entryName}".`
      : conflict.description ?? "This contradicts the Story Foundation.";

  return (
    <div
      data-testid="conflict-card"
      className="mt-3 rounded-xl border-2 border-red-500 bg-red-950/40 px-4 py-3 text-sm text-neutral-100"
    >
      <p className="mb-2 font-semibold text-red-200">Conflict detected</p>
      <p className="mb-3 text-neutral-300">{description}</p>
      <div className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.choice}
            onClick={() => onChoose(c.choice)}
            disabled={disabled}
            className="rounded-lg border border-red-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {c.letter} — {c.label}
          </button>
        ))}
      </div>
      {cascadeReview && cascadeReview.length > 0 && (
        <div className="mt-3 border-t border-red-900/40 pt-2">
          <p className="mb-1 text-[11px] uppercase tracking-widest text-neutral-500">Dependency Review</p>
          <ul className="space-y-1 text-xs text-neutral-300">
            {cascadeReview.map((e) => (
              <li key={e.entryId}>{e.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `WorldInterview.tsx`**

Add imports near the top:

```ts
import ConflictCard from "@/components/ConflictCard";
import type { P3PendingConflict } from "@/lib/canonEngine/storyStore";
```

(`P3State` is already imported as a type-only import from the same module in this file today - `P3PendingConflict` is safe to add the same way.)

Add state near the existing `wclState`/`characterBibleGate` declarations:

```ts
  const [pendingConflict, setPendingConflictState] = useState<P3PendingConflict | null>(null);
  const [cascadeReview, setCascadeReview] = useState<{ entryId: string; name: string }[] | null>(null);
```

Extend `applyTurnResponse`'s parameter type and body:

```ts
  function applyTurnResponse(data: {
    reply: string;
    context?: string | null;
    current_stage?: number;
    p3?: P3State;
    pendingConflict?: P3PendingConflict | null;
    cascadeReview?: { entryId: string; name: string }[] | null;
  }) {
    setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    setContext(data.context ?? null);
    setCurrentStage(typeof data.current_stage === "number" ? data.current_stage : null);
    if (data.p3) {
      const incoming = data.p3;
      setWclState((prev) => ({
        proposedWorldComplexityLevel: incoming.proposedWorldComplexityLevel,
        worldComplexityLevel: prev?.worldComplexityLevel ?? null,
        proposedPillars: incoming.proposedPillars,
        pillars: prev?.pillars ?? null,
        activePillar: incoming.activePillar,
      }));
    }
    setPendingConflictState(data.pendingConflict ?? null);
    setCascadeReview(data.cascadeReview ?? null);
  }
```

Add a handler near `sendMessage`:

```ts
  function chooseConflictResolution(choice: "revert" | "revise" | "defer") {
    const labels: Record<"revert" | "revise" | "defer", string> = {
      revert: "A — Revert the new idea and keep things as they are.",
      revise: "B — Revise the existing canon to match the new idea.",
      defer: "C — Defer this decision for now.",
    };
    sendMessage(labels[choice]);
  }
```

In the initial resume-fetch effect (the one that sets `wclState`/`characterBibleGate` from `data.story?.p3`), add, alongside the existing `setWclState(...)`/`setCharacterBibleGate(...)` lines:

```ts
        setPendingConflictState((data.story?.p3PendingConflict as P3PendingConflict | undefined) ?? null);
```

**Before assuming this works, verify it**: check whether `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (the endpoint this effect calls) actually includes `p3PendingConflict` on the `story` object in its response - it may return the raw Firestore document (in which case this just works, same as `data.story?.p3` already does) or it may explicitly pick/whitelist fields (in which case you'd need to add `p3PendingConflict` to that whitelist too - a compiler-forced or logically-forced unlisted-file touch, same pattern as issue #43's Task 2). Report which case it was in your task report.

In the chat pane's message list (inside the `containerRef` scrollable div, which currently renders `{messages.map(...)}`, then `{loading && ...}`, then `{error && ...}`), add the conflict card right after the `{loading && ...}` block and before the `{error && ...}` block:

```tsx
                {pendingConflict && (
                  <ConflictCard
                    conflict={pendingConflict}
                    cascadeReview={cascadeReview}
                    onChoose={chooseConflictResolution}
                    disabled={loading}
                  />
                )}
```

- [ ] **Step 3: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

For browser verification, follow the same approach issue #45's Task 3 used if a real authenticated session isn't reachable in your sandbox (no Firestore emulator, no test credentials): drive what you can for real (a network-mocked render proving the card mounts, shows the right description per conflict kind, renders three buttons, and calls `chooseConflictResolution` with the right choice on click; and that the Dependency Review section only renders when `cascadeReview` is non-empty), and clearly disclose in your report whatever you could not verify end-to-end rather than fabricating a full authenticated test.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ConflictCard.tsx web/src/components/WorldInterview.tsx
git commit -m "feat: add ConflictCard UI and wire it into the World Bible interview (issue #47)"
```

(If Step 2's verification found the canvas route needs a whitelist update, include that file in this commit too and note it clearly in the commit message and your report.)

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
