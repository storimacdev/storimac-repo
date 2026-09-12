# P3 Systemic Dependency Graph & Dependency Review Trigger (Issue #48) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give World Entries and Pillars a real, persisted dependency graph (entry-to-entry cross-references, pillar-to-pillar causal chains like Geography → Economy), fix the shared `listDependents`/`listDownstreamImpact` collection-parameter gap three prior issues deferred to this one, and add a Dependency Review the author must acknowledge before a Confirmed pillar's status can change.

**Architecture:** Per the design spec (`docs/superpowers/specs/2026-09-11-p3-dependency-graph-design.md`): fix the shared functions (small, backward-compatible), rewire issue #47's P3-local `computeCascadeReview` workaround onto them, give chat-authored entries and pillars an actual way to declare `depends_on` (currently nothing does), and add a synchronous confirm-then-retry gate for pillar Confirmed-changes — deliberately NOT a replica of issue #47's chat-turn Conflict Resolution protocol, since pillar changes are always a direct author action (never a model proposal mid-conversation), so there's no model turn to inject a grounding block into and no "proposed value" for a Revert/Revise/Defer choice to apply to.

**Tech Stack:** Firestore (`canonStore.ts`/`stageFsm.ts` fix), Zod turn schema, Next.js API routes, React component update.

## Global Constraints

- `listDependents`/`listDownstreamImpact` gain a `collection: string = "elements"` parameter, defaulting to today's behavior — Project 1's existing callers (`canonEngine/conflictResolution.ts`, `chat/route.ts`) must need zero changes.
- `computeCascadeReview` (issue #47's P3-local workaround) is rewired onto the now-fixed shared function, not deleted and reimplemented from scratch — keep its own Confirmed-status filter and `{entryId, name}` mapping (the shared function returns raw, unfiltered `CanonElement[]`, same as it always has for Project 1).
- Do NOT add Project 1's rationale-text-scan half of a Dependency Review (the substring search over every Confirmed element's `rationale` field) — explicitly out of scope per the design doc's non-goal, not a silent gap.
- The pillar Confirmed-change gate is a synchronous confirm-then-retry (409 + `acknowledged` flag), NOT a chat-turn-based Revert/Revise/Defer flow — do not build a pillar equivalent of issue #47's `P3PendingConflict`/grounding-block machinery. Every pillar status change already goes through `canon-status/route.ts`, a direct author action, not a model proposal.
- Pillar-to-pillar dependencies (`pillar_dependencies`) are a new TOP-LEVEL `WorldTurnSchema` field (like `proposed_pillars`), not nested inside `proposed_entry` — pillar relationships aren't tied to a single entry proposal.
- A pillar's `CanonElement` may not exist yet when `pillar_dependencies` first sets its `depends_on` (pillars are created lazily on first write, per issue #41's existing design) — use `upsertElement`, which already handles create-or-update, exactly as `canon-status/route.ts` already relies on today.
- Every new Firestore write in `world-chat/route.ts` must degrade gracefully within the existing try/catch blocks (logged via `console.warn`, never a hard error to the author), matching the established convention from issues #43/#46/#47.

---

### Task 1: Fix `listDependents`/`listDownstreamImpact` to accept a collection parameter

**Files:**
- Modify: `web/src/lib/canonEngine/canonStore.ts`
- Modify: `web/src/lib/canonEngine/stageFsm.ts`

**Interfaces:**
- `listDependents(storyId: string, elementId: string, collection: string = "elements"): Promise<CanonElement[]>` (signature gains the 3rd parameter). `listDownstreamImpact(storyId: string, elementId: string, collection: string = "elements"): Promise<CanonElement[]>` (same). A later task calls `listDependents(storyId, elementId, WORLD_ENTRIES_COLLECTION)` and `listDependents(storyId, elementId, WORLD_ELEMENTS_COLLECTION)`.

- [ ] **Step 1: Add the parameter to `listDependents`**

In `web/src/lib/canonEngine/canonStore.ts`, find:

```ts
/**
 * Elements whose depends_on includes elementId — the reverse-dependency
 * lookup Project 3's Dependency Review and Project 4's Relational Impact
 * Check need. array-contains query per ARCHITECTURE.md §6.
 */
export async function listDependents(
  storyId: string,
  elementId: string
): Promise<CanonElement[]> {
  const snap = await elementsCollection(storyId)
    .where("depends_on", "array-contains", elementId)
    .get();
  return snap.docs.map((d) => d.data() as CanonElement);
}
```

Replace with:

```ts
/**
 * Elements whose depends_on includes elementId — the reverse-dependency
 * lookup Project 3's Dependency Review and Project 4's Relational Impact
 * Check need. array-contains query per ARCHITECTURE.md §6. Collection
 * defaults to "elements" (Project 1's own) for backward compatibility -
 * Project 3 passes WORLD_ENTRIES_COLLECTION or WORLD_ELEMENTS_COLLECTION
 * explicitly (issue #48; this parameter was long deferred to this issue
 * across #42/#46/#47's reviews).
 */
export async function listDependents(
  storyId: string,
  elementId: string,
  collection: string = "elements"
): Promise<CanonElement[]> {
  const snap = await elementsCollection(storyId, collection)
    .where("depends_on", "array-contains", elementId)
    .get();
  return snap.docs.map((d) => d.data() as CanonElement);
}
```

- [ ] **Step 2: Add the parameter to `listDownstreamImpact`**

In `web/src/lib/canonEngine/stageFsm.ts`, find:

```ts
/**
 * Elements that would be affected if `elementId` changes - what issue #10
 * (Conflict Resolution) shows the author before letting a revision to a
 * Confirmed element through.
 */
export async function listDownstreamImpact(storyId: string, elementId: string): Promise<CanonElement[]> {
  return listDependents(storyId, elementId);
}
```

Replace with:

```ts
/**
 * Elements that would be affected if `elementId` changes - what issue #10
 * (Conflict Resolution) shows the author before letting a revision to a
 * Confirmed element through. Collection defaults to "elements" for
 * backward compatibility (issue #48).
 */
export async function listDownstreamImpact(
  storyId: string,
  elementId: string,
  collection: string = "elements"
): Promise<CanonElement[]> {
  return listDependents(storyId, elementId, collection);
}
```

- [ ] **Step 3: Verify no behavior change for existing callers**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. Grep the whole repo for every call site of `listDependents` and `listDownstreamImpact` (there are exactly two external callers today: `web/src/lib/canonEngine/conflictResolution.ts`'s `findCascadeReview`, and `stageFsm.ts`'s own internal pass-through) — confirm neither needed to change, since both omit the new parameter and get the same default `"elements"` behavior as before.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canonEngine/canonStore.ts web/src/lib/canonEngine/stageFsm.ts
git commit -m "feat: add collection parameter to listDependents/listDownstreamImpact (issue #48)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body (use this exact line regardless of which underlying model you are — this is a fixed session-wide convention, not a self-attribution).

---

### Task 2: Rewire `computeCascadeReview` onto the fixed shared function

**Files:**
- Modify: `web/src/lib/worldEngine/conflictResolution.ts`

**Interfaces:**
- `computeCascadeReview`'s signature and return shape are unchanged (`(storyId: string, entryId: string) => Promise<{ entryId: string; name: string }[]>`) — this task only changes its implementation. No other file needs to change.

- [ ] **Step 1: Replace the query with a call to `listDependents`**

Find:

```ts
import { getElement, listElements, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
```

Replace with:

```ts
import { getElement, listDependents, upsertElement, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";
```

(`listElements` is no longer used by this file once Step 2 lands — remove it from the import; `listDependents` replaces it.)

Find:

```ts
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
```

Replace with:

```ts
/**
 * Every Confirmed World Entry whose depends_on includes entryId - AC-(B)'s
 * Dependency Review. Issue #48 fixed the shared canonStore.ts#listDependents
 * to accept a collection parameter (it was hardcoded to "elements",
 * Project 1's own, until then) - this now calls it directly instead of
 * the P3-local in-memory workaround issue #47 used to avoid that gap.
 * listDependents itself doesn't filter by status, so the Confirmed
 * filter stays here, same as before.
 */
export async function computeCascadeReview(
  storyId: string,
  entryId: string
): Promise<{ entryId: string; name: string }[]> {
  const dependents = await listDependents(storyId, entryId, WORLD_ENTRIES_COLLECTION);
  return dependents
    .filter((e) => e.status === "Confirmed")
    .map((e) => ({ entryId: e.element_id, name: (e.value as WorldEntryValue | undefined)?.name ?? e.element_id }));
}
```

- [ ] **Step 2: Verify the result is identical**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

Manually trace (a `tsx` script against a real or stubbed Firestore is the most reliable way, following the in-memory-stub technique issue #47's Task 3 established, if you want genuine execution rather than by-hand tracing): given the same set of World Entries (some Confirmed with `depends_on` including the target id, some not, some non-Confirmed with `depends_on` including it), confirm `computeCascadeReview`'s new implementation returns the exact same `{entryId, name}[]` set the old implementation would have — same entries, same order-independent membership, same fallback to `element_id` when `value.name` is missing.

Also confirm this function is still exported with the same name and still used, unmodified at its call site, by `resolveP3Conflict` in the same file (issue #47's Conflict Resolution flow for `confirmed_entry` conflicts) — this task must not change that flow's behavior at all, only how the review is computed underneath.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/conflictResolution.ts
git commit -m "refactor: rewire computeCascadeReview onto the fixed shared listDependents (issue #48)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 3: Add `depends_on` and `pillar_dependencies` to the World turn schema

**Files:**
- Modify: `web/src/lib/worldEngine/worldTurnSchema.ts`

**Interfaces:**
- `WorldTurnSchema.proposed_entry` gains `depends_on: z.array(z.string())` (required within the object, can be empty). `WorldTurnSchema` (top-level) gains `pillar_dependencies: z.array(z.object({ pillar: z.string().min(1), depends_on: z.array(z.string()) }))` (required, can be empty). `EMIT_WORLD_TURN_TOOL` gains matching properties/required entries. A later task reads `delta.proposed_entry.depends_on` and `delta.pillar_dependencies`.

- [ ] **Step 1: Add `depends_on` to `proposed_entry`'s Zod shape**

Find (inside `WorldTurnSchema`'s `proposed_entry` object):

```ts
  proposed_entry: z
    .object({
      entry_id: z.string().nullable(),
      name: z.string().min(1),
      category: z.string().min(1),
      narrative_role: z.string().min(1),
      importance: z.enum(["Critical", "Major", "Supporting", "Minor", "Incidental"]),
      depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      functional_description: z.string().min(1),
      governing_rules: z.string().min(1),
    })
    .nullable(),
```

Replace with:

```ts
  proposed_entry: z
    .object({
      entry_id: z.string().nullable(),
      name: z.string().min(1),
      category: z.string().min(1),
      narrative_role: z.string().min(1),
      importance: z.enum(["Critical", "Major", "Supporting", "Minor", "Incidental"]),
      depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
      functional_description: z.string().min(1),
      governing_rules: z.string().min(1),
      depends_on: z.array(z.string()),
    })
    .nullable(),
```

- [ ] **Step 2: Add `pillar_dependencies` to `WorldTurnSchema`'s top level**

Add after the existing `resolution: z.enum(["revert", "revise", "defer"]).nullable(),` line (currently the last field):

```ts
  pillar_dependencies: z.array(
    z.object({
      pillar: z.string().min(1),
      depends_on: z.array(z.string()),
    })
  ),
```

- [ ] **Step 3: Add both to `EMIT_WORLD_TURN_TOOL`**

Add `depends_on` to `proposed_entry`'s `properties` object (after `governing_rules`):

```ts
          depends_on: {
            type: "array",
            items: { type: "string" },
            description:
              "The entry_ids of other World Entries this one references or systemically depends on (e.g. an economic system that depends on a geographic feature). Empty array if none. Use the exact entry_id shown for that entry in the [World Entries So Far...] grounding block - never its Name, and never an id for an entry that doesn't appear there yet. This field always fully replaces what's currently stored - when you re-propose an entry you've already drafted (e.g. during Validate), report its dependencies again exactly as shown in the grounding block's depends_on column, even if unchanged, or you will silently erase them.",
          },
```

Add `depends_on` to `proposed_entry`'s `required` array (currently ends with `"governing_rules"`) — append `"depends_on"`.

Add a new top-level `pillar_dependencies` property (after `resolution`):

```ts
      pillar_dependencies: {
        type: "array",
        items: {
          type: "object",
          properties: {
            pillar: { type: "string", description: "The name of a pillar, exactly matching one of the adopted pillar names." },
            depends_on: {
              type: "array",
              items: { type: "string" },
              description: "The names of other pillars this one systemically depends on (e.g. Economy depends on Geography). Empty array if none.",
            },
          },
          required: ["pillar", "depends_on"],
        },
        description:
          "Causal/systemic relationships between World Pillars you've identified (e.g. Economy depends on Geography, Culture depends on Politics) - per sp03's own instruction to treat the world as a causal chain. Report a pillar's dependencies again on any turn they're still true, even if unchanged from a prior turn. Empty array if you haven't identified any pillar-level dependencies yet.",
      },
```

Add `"pillar_dependencies"` to the tool's top-level `required` array (currently ends with `"resolution"`).

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. No other file constructs a full `WorldTurnSchema`/`EMIT_WORLD_TURN_TOOL` object literal yet (a later task is the only consumer), so this should not force any other file to change — if it does, apply the minimal fix and explain in your report, per the established pattern from issue #43's Task 2.

Manually trace 3 scenarios against the real Zod schema (a `tsx` script is fastest): (a) `proposed_entry: null, pillar_dependencies: []` — parses; (b) a non-null `proposed_entry` with `depends_on: ["The Assize of Salt"]` — parses; (c) `pillar_dependencies: [{pillar: "Economy", depends_on: ["Geography"]}]` — parses.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/worldEngine/worldTurnSchema.ts
git commit -m "feat: add depends_on and pillar_dependencies fields to WorldTurnSchema (issue #48)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 4: Wire entry-level and pillar-level dependencies into `world-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/world-chat/route.ts`

**Interfaces:**
- Consumes: `delta.proposed_entry.depends_on` (already typed once Task 3 lands), `delta.pillar_dependencies` (same). `upsertElement`, `WORLD_ELEMENTS_COLLECTION` from `@/lib/canonEngine/canonStore` (already exists; `WORLD_ELEMENTS_COLLECTION` is not currently imported in this file - add it). `pillarElementId` from `@/lib/worldEngine/pillarElementId` (already exists, not currently imported here - add it).

**Part A — entry-level `depends_on`:**

Find, inside the Stage 3 block, the `entryInput` construction:

```ts
        const entryInput = {
          name: delta.proposed_entry.name,
          category: delta.proposed_entry.category,
          narrativeRole: delta.proposed_entry.narrative_role,
          importance: delta.proposed_entry.importance,
          depth: delta.proposed_entry.depth,
          functionalDescription: delta.proposed_entry.functional_description,
          governingRules: delta.proposed_entry.governing_rules,
        };
```

Replace with:

```ts
        const entryInput = {
          name: delta.proposed_entry.name,
          category: delta.proposed_entry.category,
          narrativeRole: delta.proposed_entry.narrative_role,
          importance: delta.proposed_entry.importance,
          depth: delta.proposed_entry.depth,
          functionalDescription: delta.proposed_entry.functional_description,
          governingRules: delta.proposed_entry.governing_rules,
          dependsOn: delta.proposed_entry.depends_on,
        };
```

(`createWorldEntry`/`updateWorldEntry` in `worldEntryStore.ts` already accept `dependsOn` in their input types and already pass it through to `upsertElement`'s `depends_on` patch field — no store-layer change needed, this is purely the missing plumbing at the call site issue #47's own review flagged as a gap.)

**Part B — pillar-level `pillar_dependencies`:**

- [ ] Add to the imports:

```ts
import { listElements, WORLD_ENTRIES_COLLECTION, upsertElement, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
```

(this replaces the current `import { listElements, WORLD_ENTRIES_COLLECTION } from "@/lib/canonEngine/canonStore";` line — add the two new names to the same import, don't create a second import statement for the same module).

```ts
import { pillarElementId } from "@/lib/worldEngine/pillarElementId";
```

- [ ] Find the WCL/Pillar proposal tracking block:

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
```

Immediately after that block's closing `}`, insert:

```ts
    // Pillar-to-pillar dependency graph (issue #48) - lazily creates each
    // named pillar's CanonElement if it doesn't exist yet (mirroring how
    // canon-status/route.ts already lazily creates pillars on first
    // status-set, issue #41), writing only depends_on so an existing
    // pillar's status/value is never touched by this. Degrades gracefully
    // - logged, never a hard error to the author - same convention as
    // every other Stage-3-adjacent write in this route.
    if (delta.pillar_dependencies.length > 0) {
      try {
        for (const { pillar, depends_on } of delta.pillar_dependencies) {
          await upsertElement(
            storyId,
            pillarElementId(pillar),
            { depends_on },
            turnId,
            false,
            WORLD_ELEMENTS_COLLECTION
          );
        }
      } catch (pillarDepsErr) {
        console.warn(`[world-chat] pillar_dependencies persistence failed for turn ${turnId}:`, pillarDepsErr);
      }
    }
```

- [ ] **Step: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

Manually trace: (a) `delta.proposed_entry.depends_on = ["Some Other Entry"]` on a new entry create → `createWorldEntry`'s `entryInput.dependsOn` carries that array through to the stored `CanonElement.depends_on` (trace this through `worldEntryStore.ts`'s existing code, don't just assume); (b) `delta.pillar_dependencies = [{pillar: "Economy", depends_on: ["Geography"]}]` on a story where neither pillar has a `CanonElement` yet → `upsertElement` creates `pillar-economy` with `depends_on: ["Geography"]` and status defaulting per `upsertElement`'s own existing create-path default (verify what that default actually is by reading `upsertElement`, don't guess) - note this stores the raw pillar NAME "Geography" in `depends_on`, not `pillarElementId("Geography")` - decide and clearly state in your report whether `depends_on` should store raw names or derived ids, checking how `computeCascadeReview`/`listDependents`'s `array-contains` query on `depends_on` would need to match whatever `entryId`/`elementId` value gets passed to it elsewhere (for entries, `depends_on` already stores whatever string the caller supplies via the direct CRUD API - check `entries/route.ts` to see whether that API expects names or ids in `dependsOn`, and be consistent with that existing convention rather than introducing a new one for pillars); (c) `upsertElement` throwing (simulate by reading the code path) → the catch logs via `console.warn` and the function still proceeds normally to Stage 3 and the final response.

- [ ] **Step: Commit**

```bash
git add web/src/app/api/world-chat/route.ts
git commit -m "feat: wire entry-level and pillar-level dependency graph writes into the world-chat turn handler (issue #48)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 5: Add the pillar Confirmed-change Dependency Review gate to `canon-status/route.ts`

**Files:**
- Modify: `web/src/app/api/world-chat/canon-status/route.ts`

**Interfaces:**
- The PATCH request body gains an optional `acknowledged?: boolean` field. When a request would change a `Confirmed` pillar's status to something else AND that pillar has Confirmed dependents AND `acknowledged` is not `true`, the response is `409` with `{ needsAcknowledgment: true, dependencyReview: { entryId: string; name: string }[] }` instead of committing. A later task (Task 6) calls this endpoint and handles that `409` shape.

- [ ] **Step 1: Add the import**

```ts
import { computeCascadeReview } from "@/lib/worldEngine/conflictResolution";
```

Wait - `computeCascadeReview` is currently scoped to `WORLD_ENTRIES_COLLECTION` only (it takes `storyId, entryId` with no collection parameter, hardcoding `WORLD_ENTRIES_COLLECTION` internally per Task 2). For pillars, you need the same *kind* of Confirmed-filtered dependents lookup but against `WORLD_ELEMENTS_COLLECTION` instead. Do NOT modify `computeCascadeReview`'s signature to take a collection parameter for this (that would change issue #47's Conflict Resolution call site's meaning). Instead, call the now-fixed `listDependents` directly here with the same two-line pattern (`listDependents` + a Confirmed filter + map to `{entryId, name}`), scoped to `WORLD_ELEMENTS_COLLECTION`. Import:

```ts
import { getElement, upsertElement, listDependents, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
```

(this replaces the current `import { getElement, upsertElement, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";` line - add `listDependents` to the same import).

- [ ] **Step 2: Read the `acknowledged` field from the body**

Find:

```ts
    const storyId: unknown = body?.storyId;
    const elementId: unknown = body?.elementId;
    const status: unknown = body?.status;
```

Replace with:

```ts
    const storyId: unknown = body?.storyId;
    const elementId: unknown = body?.elementId;
    const status: unknown = body?.status;
    const acknowledged = body?.acknowledged === true;
```

- [ ] **Step 3: Add the Dependency Review gate**

Find:

```ts
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
```

Replace with:

```ts
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
      const dependencyReview = dependents
        .filter((e) => e.status === "Confirmed")
        .map((e) => ({ entryId: e.element_id, name: (e.value as { name?: string } | undefined)?.name ?? e.element_id }));
      if (dependencyReview.length > 0) {
        return NextResponse.json({ needsAcknowledgment: true, dependencyReview }, { status: 409 });
      }
    }

    const element = await upsertElement(
```

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

Manually trace: (a) a non-Confirmed pillar changing status → gate never triggers (unchanged behavior); (b) a Confirmed pillar changing status, no Confirmed dependents → gate computes an empty `dependencyReview`, falls through to the normal commit (unchanged end result, one extra read); (c) a Confirmed pillar changing status, real Confirmed dependents exist, `acknowledged` not sent → `409` with the review, nothing written; (d) same as (c) but `acknowledged: true` sent → gate is skipped entirely (the `!acknowledged` condition), commits normally.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/world-chat/canon-status/route.ts
git commit -m "feat: add Dependency Review confirm-then-retry gate for pillar Confirmed-changes (issue #48)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 6: Wire the confirm-then-retry flow into `WorldInterview.tsx`

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: the `409`/`needsAcknowledgment`/`dependencyReview` response shape from Task 5. Modifies the existing `changeElementStatus`/`handleElementStatusChange` functions.

The current file has these two functions:

```ts
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

- [ ] **Step 1: Replace both functions**

Replace with:

```ts
  async function changeElementStatus(elementId: string, nextStatus: PillarStatus, acknowledged = false) {
    if (!canvasId || elementStatusUpdating) return;
    setElementStatusUpdating(true);
    setError(null);
    try {
      const res = await fetch("/api/world-chat/canon-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: canvasId,
          elementId,
          status: nextStatus,
          ...(acknowledged ? { acknowledged: true } : {}),
        }),
      });
      const data = await res.json();

      if (res.status === 409 && data.needsAcknowledgment) {
        const dependents = (data.dependencyReview as { entryId: string; name: string }[]) ?? [];
        const list = dependents.map((d) => `- ${d.name}`).join("\n");
        const confirmed = window.confirm(
          `The following Confirmed entries depend on this pillar and may need review:\n${list}\n\nContinue anyway?`
        );
        if (confirmed) {
          await changeElementStatus(elementId, nextStatus, true);
        }
        return;
      }

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

Note the recursive call in the `409` branch (`await changeElementStatus(elementId, nextStatus, true)`) happens INSIDE the same `try` block, after the first `fetch` already completed - `setElementStatusUpdating(true)` was already set at the top of the outer call, so the inner recursive call will try to set it `true` again (harmless, same value) and its own `finally` will set it back to `false` when the whole chain finishes; the outer call's own `finally` will also fire after the awaited recursive call returns, also setting it `false` (idempotent). Trace this yourself to confirm there's no way `elementStatusUpdating` gets stuck `true` (e.g. if the user declines the confirm and the function just `return`s) - if you find a real bug here, fix it and explain clearly in your report; this exact interaction is the trickiest part of this task.

- [ ] **Step 2: Verify**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

For browser verification, follow the same approach issues #45/#47 used if a real authenticated session isn't reachable in your sandbox: network-mock the `canon-status` PATCH to return a `409`/`needsAcknowledgment` response on the first call and a `200` on the second (acknowledged) call, drive the real component, and confirm: (a) the `window.confirm` dialog text lists the dependent entry names; (b) declining leaves the pillar's status unchanged in the UI; (c) confirming results in a second PATCH call with `acknowledged: true` and the status updates in the UI afterward. Clearly disclose what you could not verify end-to-end rather than fabricating a full authenticated test.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: wire the Dependency Review confirm-then-retry flow into the pillar status control (issue #48)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
