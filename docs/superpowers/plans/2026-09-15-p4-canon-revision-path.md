# P4 Canon Revision Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #64 — halt and force a 3-way resolution (Revert / Accept-and-
update / Park) whenever a proposed structural choice either (a) would silently regress an
already-`Confirmed` unit back to `Exploring`/`Working`, or (b) contradicts already-locked
Project 1-3 canon the unit cites.

**Architecture:** Two independent detection triggers feed one shared multi-turn halt-and-
resolve flow, mirroring `world-chat/route.ts`'s existing Conflict Resolution Protocol (issue
#47) almost exactly: a pending conflict persists on the Story document across turns; while one
is open, the grounding block instructs the model to present exactly three choices and report
`resolution` on its next turn; the route then applies that choice and clears the pending state.
Trigger A (unit regression) is fully deterministic, reusing `canonEngine/transitions.ts`'s
existing `isValidTransition`. Trigger B (cross-project contradiction) is model-reported, the
same reasoning as `validation_result`/`causal_tag` before it. Neither trigger, nor the
resolution's "accept and update" choice, ever writes into P1/P2/P3's own canon — every
resolution logs the decision and (for a P3 source only) surfaces an informational dependents
list via already-existing `canonEngine/canonStore.ts` machinery.

**Tech Stack:** Next.js API route, Zod + Anthropic tool schema, plain TypeScript modules,
Firestore via `storyStore.ts`/`canonStore.ts`, a Markdown system prompt, a React component.

## Global Constraints

- No test suite exists in this project — verification is `npx tsc --noEmit`, `npm run lint`,
  `npm run build`, and a direct code trace.
- **No cross-project writes, ever, for any source project.** Option B ("accept and update")
  never calls `upsertElement` or any other write function against P1/P2/P3's own canon. This
  was explicitly decided during design (see the spec's "Research" section) after finding P4
  never has a structured replacement value to write — only a free-text explanation. The one
  reused read: `canonEngine/canonStore.ts`'s existing `listDependents(storyId, elementId,
  WORLD_ELEMENTS_COLLECTION)` for an informational (never written) P3 dependents list.
- Trigger A reuses `canonEngine/transitions.ts`'s `isValidTransition` directly — do not write a
  new P4-local copy of that logic.
  `attemptStatusTransition`/`evaluateCausalGate` (already reviewed and shipped in #62/#111/#63)
  are completely unchanged — the two new triggers are checked *before* either of those
  functions is ever called for a given turn, not integrated into them.
- Resolving a conflict (`accept_and_update`) bypasses `attemptStatusTransition` and
  `evaluateCausalGate` entirely and writes the unit directly via `stateLedger.ts`'s plain
  updater functions — mirroring `canonStore.ts`'s own `allowConfirmedOverride` precedent
  ("the store layer requires an explicit override to change a Confirmed element at all, which
  is the Conflict Resolution flow's job, not a plain transition"). The unit's causal tag is
  deliberately left untouched by this path (out of scope for this issue — #64 is about
  lifecycle/contradiction, not causality).
- Design spec: `docs/superpowers/specs/2026-09-15-p4-canon-revision-path-design.md`. Read it
  first if anything below is ambiguous.

---

### Task 1: Schema, storage, and the P4-local conflict-resolution module

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`
- Modify: `web/src/lib/canonEngine/storyStore.ts`
- Create: `web/src/lib/storyArchitectureEngine/canonRevision.ts`
- Modify: `web/system-prompts/sp04-sae-systemprompt.md`

**Interfaces:**
- Produces: `P4PendingConflict` (a discriminated union, `storyStore.ts`), `Story.p4PendingConflict`,
  `setP4PendingConflict(storyId, conflict: P4PendingConflict | null): Promise<void>`,
  `P4CanonRevisionLogEntry`, `appendP4CanonRevisionLog(storyId, entry): Promise<void>`.
- Produces: `buildP4ConflictContextMessage(conflict: P4PendingConflict): string` and
  `resolveP4Conflict(params: ResolveP4ConflictParams): Promise<ResolveP4ConflictResult>`
  (`canonRevision.ts`) — Task 2 calls both of these; their exact signatures below are what
  Task 2's brief will assume.
- Consumes: `isValidTransition` from `@/lib/canonEngine/transitions` (already exists, unchanged).
- Consumes: `listDependents`, `WORLD_ELEMENTS_COLLECTION` from `@/lib/canonEngine/canonStore`
  (already exist, unchanged).
- Consumes: `StructuralUnit`, `StructuralUnitType`, `createUnit`, `findUnit`, `upsertUnit`,
  `setUnitStatus`, `setUnitContent`, `addCanonRefs` from `@/lib/storyArchitectureEngine/stateLedger`
  (already exist, unchanged).

- [ ] **Step 1: Add `canon_contradiction` and top-level `resolution` to the turn schema**

  In `web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts`, add a field to the
  `proposed_unit` object in `ArchitectureTurnSchema` (right after `causal_tag_reason`, i.e. as
  the last field before the object's closing `.nullable()`):

  ```ts
      causal_tag_reason: z.string(),
      canon_contradiction: z
        .object({
          contradicted_ref: z.string().min(1),
          source_project: z.enum(["Project 1", "Project 2", "Project 3"]),
          explanation: z.string().min(1),
        })
        .nullable(),
    })
    .nullable(),
  ```

  Add a new **top-level** field to `ArchitectureTurnSchema` (a sibling of `validation_result`,
  `deferred_items`, etc. — NOT nested inside `proposed_unit`), right after the closing of the
  `deferred_items` array:

  ```ts
    resolution: z.enum(["revert", "accept_and_update", "park"]).nullable(),
  });
  ```

  (i.e. add it as the last field before `ArchitectureTurnSchema`'s own closing `});`.)

  Make the matching changes to `EMIT_ARCHITECTURE_TURN_TOOL`: add `canon_contradiction` to
  `proposed_unit.properties` (after `causal_tag_reason`) and to `proposed_unit`'s own
  `required` array (which currently ends `..., "causal_tag", "causal_tag_reason"]` — append
  `"canon_contradiction"`):

  ```ts
          causal_tag_reason: {
            type: "string",
            description: "A specific, concrete explanation for causal_tag, either way.",
          },
          canon_contradiction: {
            type: ["object", "null"],
            properties: {
              contradicted_ref: { type: "string", description: "The id of the already-locked Project 1-3 canon reference this unit's content contradicts." },
              source_project: {
                type: "string",
                enum: ["Project 1", "Project 2", "Project 3"],
                description: "Which project owns the contradicted canon.",
              },
              explanation: { type: "string", description: "A specific, concrete explanation of the contradiction." },
            },
            required: ["contradicted_ref", "source_project", "explanation"],
            description: "Set only when this unit's proposed content contradicts an already-locked Project 1-3 fact it cites via canon_refs. Null in every ordinary turn.",
          },
        },
        required: [
          "unit_id",
          "type",
          "content",
          "requested_status",
          "canon_refs",
          "proposed_position_percent",
          "causal_tag",
          "causal_tag_reason",
          "canon_contradiction",
        ],
  ```

  Add `resolution` to the TOP-LEVEL tool schema's `properties` (a sibling of `deferred_items`,
  not nested under `proposed_unit`) and to the top-level `required` array (which currently ends
  `..., "deferred_items"]` — append `"resolution"`):

  ```ts
      resolution: {
        type: ["string", "null"],
        enum: ["revert", "accept_and_update", "park", null],
        description:
          "Set only on the turn immediately after the author picks one of the three choices presented for an open Canon Revision Path conflict (see your grounding). Null on every other turn.",
      },
    },
    required: [
      "reply",
      "context",
      "routing_choice",
      "active_step_number",
      "proposed_unit",
      "validation_result",
      "validation_reason",
      "deferred_items",
      "resolution",
    ],
  };
  ```

- [ ] **Step 2: Add `P4PendingConflict` storage to `storyStore.ts`**

  In `web/src/lib/canonEngine/storyStore.ts`, add this new type right after the existing
  `P4State`/`normalizeP4` block (after `normalizeP4`'s closing brace, before `export interface
  Story`):

  ```ts
  /** Project 4's pending Canon Revision conflict (issue #64) - either a
   * deterministic lifecycle regression (an already-Confirmed unit asked
   * to move back to Exploring/Working, detected via
   * canonEngine/transitions.ts's isValidTransition) or a cross-project
   * contradiction against already-locked P1-3 canon (detected via model
   * self-report, since there's no deterministic way to judge
   * contradiction against another project's canon from P4's side).
   * Singular, like P1/P2/P3's own pending-conflict fields - only one
   * conflict is ever open at a time. Both variants carry the triggering
   * turn's full requested content/status/canon_refs/type so
   * canonRevision.ts's resolveP4Conflict can apply the original request
   * later without asking the model to re-propose it from scratch - same
   * reasoning as P3PendingConflict's "confirmed_entry" variant storing
   * newValue at detection time. */
  export type P4PendingConflict =
    | {
        kind: "unit_regression";
        unitId: string;
        type: StructuralUnitType;
        requestedStatus: CanonStatus;
        requestedContent: string;
        requestedCanonRefs: string[];
        ts: string;
      }
    | {
        kind: "canon_contradiction";
        unitId: string;
        type: StructuralUnitType;
        sourceProject: "Project 1" | "Project 2" | "Project 3";
        contradictedRef: string;
        explanation: string;
        requestedStatus: CanonStatus;
        requestedContent: string;
        requestedCanonRefs: string[];
        ts: string;
      };
  ```

  This requires two new imports at the top of the file: add `CanonStatus` to the existing
  `import type { CanonElement } from "./types";` line (change it to `import type { CanonElement,
  CanonStatus } from "./types";`), and add `StructuralUnitType` to the existing `import type {
  StructuralUnit } from "@/lib/storyArchitectureEngine/stateLedger";` line (change it to `import
  type { StructuralUnit, StructuralUnitType } from "@/lib/storyArchitectureEngine/stateLedger";`).

  Add `p4PendingConflict?: P4PendingConflict | null;` to the `Story` interface, right after the
  existing `p4Units?: StructuralUnit[] | null;` field (before the `p1Locked` field), with a
  doc comment matching the style of every other Story field above it:
  ```ts
    /**
     * Project 4's pending Canon Revision conflict (issue #64), cleared
     * once the author picks one of the three resolution choices.
     * Optional/nullable since Stories created before this field existed
     * won't have it in Firestore.
     */
    p4PendingConflict?: P4PendingConflict | null;
  ```

  Add the setter right after the existing `setP4Units` function:
  ```ts
  /** Records or clears Project 4's pending Canon Revision conflict (issue #64); pass null to clear once resolved. */
  export async function setP4PendingConflict(
    storyId: string,
    conflict: P4PendingConflict | null
  ): Promise<void> {
    await storiesCollection()
      .doc(storyId)
      .update({ p4PendingConflict: conflict, updatedAt: new Date().toISOString() });
  }
  ```

  Add the log entry type and append function right after the existing `appendP3ConflictLog`/
  `listP3ConflictLog` block:
  ```ts
  /** Project 4's Canon Revision log (issue #64) - one entry per resolved conflict, either kind. */
  export interface P4CanonRevisionLogEntry {
    kind: "unit_regression" | "canon_contradiction";
    unitId: string;
    description: string;
    /** Present only for kind "canon_contradiction". */
    sourceProject?: "Project 1" | "Project 2" | "Project 3";
    contradictedRef?: string;
    resolution: "revert" | "accept_and_update" | "park";
    resolvedBy: string;
    ts: string;
    turnId: string;
  }

  function p4CanonRevisionLogCollection(storyId: string) {
    return storiesCollection().doc(storyId).collection("p4CanonRevisionLog");
  }

  /** Appends a resolved conflict to Project 4's Canon Revision log (issue #64). */
  export async function appendP4CanonRevisionLog(storyId: string, entry: P4CanonRevisionLogEntry): Promise<void> {
    await p4CanonRevisionLogCollection(storyId).add(entry);
  }
  ```

- [ ] **Step 3: Create `canonRevision.ts`**

  Create `web/src/lib/storyArchitectureEngine/canonRevision.ts`:

  ```ts
  import { listDependents, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
  import { appendP4CanonRevisionLog, type P4PendingConflict } from "@/lib/canonEngine/storyStore";
  import {
    createUnit,
    findUnit,
    upsertUnit,
    setUnitStatus,
    setUnitContent,
    addCanonRefs,
    type StructuralUnit,
  } from "./stateLedger";

  /**
   * P4's own Canon Revision Path (issue #64) - a P4-local fork, not a
   * call-through to canonEngine/conflictResolution.ts (issue #10's
   * reference implementation) or worldEngine/conflictResolution.ts
   * (issue #47). Investigated first, following the same "reuse or fork"
   * precedent P2/P3 already established: P4's structural units live in
   * their own StructuralUnit[] array (stateLedger.ts), not in
   * canonEngine/canonStore.ts's generic `elements` collection, so
   * neither existing module's literal functions apply. See the design
   * doc (docs/superpowers/specs/2026-09-15-p4-canon-revision-path-design.md)
   * for the full reasoning, including why Option B never writes into
   * P1/P2/P3's own canon (P4 never has a structured replacement value
   * for another project's canon - only a free-text explanation).
   */

  export function buildP4ConflictContextMessage(conflict: P4PendingConflict): string {
    const description =
      conflict.kind === "unit_regression"
        ? `Unit "${conflict.unitId}" is already Confirmed, but the latest proposal would move it back to ${conflict.requestedStatus} - that is not a plain revision, it needs this Canon Revision Path.`
        : `The proposed content for unit "${conflict.unitId}" contradicts already-locked ${conflict.sourceProject} canon ("${conflict.contradictedRef}"): ${conflict.explanation}`;
    return `\n\n[CANON REVISION PATH - internal grounding only, never narrate this raw data to the author. ${description} Present the author with exactly three choices in your reply, in your own words: (A) Revert the proposal and keep things as they are, (B) Accept the new idea as the correct one going forward - note clearly that the author will need to make the matching edit on the referenced project's own screen separately, this app will not do it for them, (C) Park the idea for later, logged as an outstanding decision. Once the author clearly picks one, set resolution to "revert", "accept_and_update", or "park" on your next structured output - do not develop any other structural content until this is resolved.]`;
  }

  export interface P4CascadeReviewEntry {
    id: string;
    description: string;
  }

  export interface ResolveP4ConflictParams {
    storyId: string;
    conflict: P4PendingConflict;
    resolution: "revert" | "accept_and_update" | "park";
    turnId: string;
    resolvedBy: string;
    units: StructuralUnit[];
  }

  export interface ResolveP4ConflictResult {
    units: StructuralUnit[];
    cascadeReview: P4CascadeReviewEntry[] | null;
  }

  /**
   * Applies the author's resolution choice. "accept_and_update" bypasses
   * attemptStatusTransition/evaluateCausalGate entirely and writes the
   * unit directly via stateLedger.ts's plain updaters - the author has
   * now explicitly authorized this, past the point of the automatic
   * gates, mirroring canonStore.ts's own allowConfirmedOverride
   * precedent. Never writes into P1/P2/P3's own canon for any source -
   * the log entry is the durable record. For a Project-3-sourced
   * contradiction only, surfaces an informational (never written)
   * dependents list via canonStore.ts's existing listDependents, whose
   * own comment already names this exact future use. Also scans P4's
   * OWN units for any other unit citing the same contradicted
   * reference - a cheap, P4-internal cascade check; a full cross-project
   * cascade is issue #72's scope, not this one's.
   */
  export async function resolveP4Conflict(params: ResolveP4ConflictParams): Promise<ResolveP4ConflictResult> {
    const { storyId, conflict, resolution, turnId, resolvedBy, units } = params;
    const existing = findUnit(units, conflict.unitId);
    let updatedUnits = units;
    let cascadeReview: P4CascadeReviewEntry[] | null = null;

    if (resolution === "park") {
      if (existing) {
        updatedUnits = upsertUnit(units, setUnitStatus(existing, "Parked"));
      }
    } else if (resolution === "accept_and_update") {
      const base = existing ?? createUnit(conflict.unitId, conflict.type);
      const withContent = addCanonRefs(setUnitContent(base, conflict.requestedContent), conflict.requestedCanonRefs);
      const finalUnit = setUnitStatus(withContent, conflict.requestedStatus);
      updatedUnits = upsertUnit(units, finalUnit);

      if (conflict.kind === "canon_contradiction") {
        const p4Entries: P4CascadeReviewEntry[] = updatedUnits
          .filter((u) => u.unitId !== conflict.unitId && u.canonRefs.includes(conflict.contradictedRef))
          .map((u) => ({ id: u.unitId, description: `Another structural unit (${u.type}) in this screenplay that also cites this reference.` }));

        let p3Entries: P4CascadeReviewEntry[] = [];
        if (conflict.sourceProject === "Project 3") {
          const dependents = await listDependents(storyId, conflict.contradictedRef, WORLD_ELEMENTS_COLLECTION);
          p3Entries = dependents
            .filter((e) => e.status === "Confirmed")
            .map((e) => ({ id: e.element_id, description: "Confirmed World Bible element that currently depends on this pillar." }));
        }

        cascadeReview = [...p3Entries, ...p4Entries];
      }
    }
    // "revert" needs no unit write beyond the log below - it keeps existing state untouched by definition.

    await appendP4CanonRevisionLog(storyId, {
      kind: conflict.kind,
      unitId: conflict.unitId,
      description:
        conflict.kind === "unit_regression"
          ? `Unit "${conflict.unitId}" attempted regression to ${conflict.requestedStatus}`
          : `Unit "${conflict.unitId}" contradicted ${conflict.sourceProject} canon "${conflict.contradictedRef}"`,
      // Firestore rejects an explicit `undefined` field value unless
      // ignoreUndefinedProperties is set (it isn't, repo-wide) - a
      // conditional spread, matching worldEngine/conflictResolution.ts's
      // own fix for the exact same hazard (final whole-branch review
      // finding C1 there).
      ...(conflict.kind === "canon_contradiction"
        ? { sourceProject: conflict.sourceProject, contradictedRef: conflict.contradictedRef }
        : {}),
      resolution,
      resolvedBy,
      ts: new Date().toISOString(),
      turnId,
    });

    return { units: updatedUnits, cascadeReview };
  }
  ```

- [ ] **Step 4: Add the Canon Revision Path section to sp04**

  In `web/system-prompts/sp04-sae-systemprompt.md`, insert a new section between the current
  Section 8 (STRUCTURED OUTPUT CONTRACT) and Section 9 (OPENING TURN), and renumber the
  current Section 9 to Section 10. The file currently ends:
  ```
  9. OPENING TURN
  Review the attached canon-ingestion grounding below. Execute Section 7's onboarding sequence exactly — structural overview, milestone checklist, routing prompt, in your own words — and nothing else. No structural development of any kind on this turn.
  ```
  Replace that with:
  ```
  9. CANON REVISION PATH
  A structural unit that is already Confirmed cannot silently revert to Exploring or Working - the app enforces this regardless of what you propose, so always check the Structural Units So Far grounding before requesting a status change on an existing unit. Separately, if you recognize that a unit's proposed content contradicts an already-locked Project 1, 2, or 3 fact it cites (for example, a proposed scene that requires changing a character's Core Wound), do not silently accept the new idea - report it as a canon_contradiction instead. Either situation opens a Canon Revision Path conflict: while one is open (see your grounding for the current one), present exactly the three choices given there, in your own words, and develop no other structural content until the author picks one and you report their choice as resolution on your next turn.

  10. OPENING TURN
  Review the attached canon-ingestion grounding below. Execute Section 7's onboarding sequence exactly — structural overview, milestone checklist, routing prompt, in your own words — and nothing else. No structural development of any kind on this turn.
  ```

  Also update Section 8's long `proposed_unit`-field-enumeration sentence: insert a clause for
  `canon_contradiction` right after the existing `causal_tag_reason` clause and before the
  closing `; validation_result` clause. The relevant part of that sentence currently reads:
  `` ...causal_tag_reason (a specific, concrete explanation either way); validation_result... ``.
  Insert `` and canon_contradiction (set only when this unit's content contradicts an
  already-locked Project 1-3 fact it cites, with contradicted_ref, source_project, and
  explanation - null in every ordinary turn) `` between `causal_tag_reason`'s parenthetical
  and the semicolon before `validation_result`, so the joined clause reads `causal_tag_reason
  (...) and canon_contradiction (...); validation_result (...)`.

  Finally, add one clause to Section 8 for the new top-level `resolution` field, appended after
  the existing `deferred_items` clause (the sentence's last clause): `` ; resolution ("revert",
  "accept_and_update", or "park" on the turn immediately after the author picks one of the
  three choices for an open Canon Revision Path conflict, null on every other turn) ``.

- [ ] **Step 5: Verify**

  From `web/`, run `npx tsc --noEmit -p .` and `npm run lint` - both must be clean. There is no
  route wiring yet in this task, so nothing is reachable end-to-end - verification here is
  type-correctness and a manual read-through confirming `resolveP4Conflict`'s three branches
  match the spec (trace by hand: a `unit_regression` conflict resolved `accept_and_update`
  should end with the unit's status set to `requestedStatus` and no cascade review; a
  `canon_contradiction` conflict with `sourceProject: "Project 1"` resolved `accept_and_update`
  should produce a cascade review containing only P4-internal entries, never a P3 lookup).

- [ ] **Step 6: Commit**

  ```bash
  git add web/src/lib/storyArchitectureEngine/architectureTurnSchema.ts web/src/lib/canonEngine/storyStore.ts web/src/lib/storyArchitectureEngine/canonRevision.ts web/system-prompts/sp04-sae-systemprompt.md
  git commit -m "feat: add P4 Canon Revision Path schema, storage, and resolution module (issue #64)"
  ```

---

### Task 2: Wire the two triggers into the route, surface in the UI

**Files:**
- Modify: `web/src/app/api/architecture-chat/route.ts`
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Consumes: everything Task 1 produced (`P4PendingConflict`, `setP4PendingConflict`,
  `buildP4ConflictContextMessage`, `resolveP4Conflict`, `isValidTransition`, `listDependents`/
  `WORLD_ELEMENTS_COLLECTION` — this task itself doesn't call the latter two directly, they're
  used inside `resolveP4Conflict`).

- [ ] **Step 1: Import what this task needs**

  In `web/src/app/api/architecture-chat/route.ts`, add `setP4PendingConflict` and
  `type P4PendingConflict` to the existing `storyStore` import (currently `getStory,
  normalizeP4, setP4OnboardingComplete, setP4Routing, setP4Units, appendMessage, listMessages,
  appendOutstandingQuestions, ARCHITECTURE_MESSAGES_COLLECTION`). Add a new import:
  ```ts
  import { isValidTransition } from "@/lib/canonEngine/transitions";
  import { buildP4ConflictContextMessage, resolveP4Conflict } from "@/lib/storyArchitectureEngine/canonRevision";
  ```

- [ ] **Step 2: Compute the pending conflict and inject its grounding block**

  Right after the existing line `let units = story.p4Units ?? [];`, add:
  ```ts
    const pendingConflictBefore = story.p4PendingConflict ?? null;
  ```

  `pendingConflictForResponse`/`cascadeReview` must be readable from the `NextResponse.json`
  call after the try/catch, exactly like `effectiveUnit`/`statusAttempt` already are - so they
  need to be declared with `let` *before* `try {` starts, not inside it (a `let` declared
  inside the try block would go out of scope before the response is built). Add these two
  lines right after the existing `let statusAttempt: StatusTransitionAttempt | null = null;`
  line (still before `try {`):
  ```ts
    let pendingConflictForResponse: P4PendingConflict | null = pendingConflictBefore;
    let cascadeReview: { id: string; description: string }[] | null = null;
  ```

  Right after the existing "Structural Units So Far" grounding block (after its closing `}`),
  before the `if (!p4.onboardingComplete) {` line, add:
  ```ts
      // Canon Revision Path grounding (issue #64) - only while a conflict
      // is genuinely open; cleared once resolved (Step 4 below). Shown
      // even while onboarding is incomplete would be impossible anyway -
      // a conflict can only ever be opened after onboarding completes,
      // since both triggers require delta.proposed_unit, which is
      // clamped until then.
      if (pendingConflictBefore) {
        system += buildP4ConflictContextMessage(pendingConflictBefore);
      }
  ```

- [ ] **Step 3: Restructure the try block's unit-processing section**

  Replace the entire existing block from `if (p4.onboardingComplete && delta.proposed_unit) {`
  through its matching closing `}` (i.e. everything between the routing-state block above it
  and the `} catch (stateErr) {` below it) with:

  (`pendingConflictForResponse`/`cascadeReview` themselves are NOT declared here - they were
  already declared with `let` before `try {` in Step 2 above. This block only assigns to them.)

  ```ts
      if (p4.onboardingComplete) {
        if (pendingConflictBefore && delta.resolution !== null) {
          const result = await resolveP4Conflict({
            storyId,
            conflict: pendingConflictBefore,
            resolution: delta.resolution,
            turnId,
            resolvedBy: user.uid,
            units,
          });
          units = result.units;
          cascadeReview = result.cascadeReview;
          await setP4Units(storyId, units);
          // Persist the clear before updating the in-memory value, same
          // ordering worldEngine/conflictResolution.ts's own resolution
          // flow uses: if setP4PendingConflict throws, the outer catch's
          // console.warn still fires, but pendingConflictForResponse
          // stays at its pre-resolution value rather than telling this
          // turn's response the conflict is resolved while Firestore
          // still shows it open.
          await setP4PendingConflict(storyId, null);
          pendingConflictForResponse = null;
          effectiveUnit = findUnit(units, pendingConflictBefore.unitId);
        } else if (!pendingConflictBefore && delta.proposed_unit) {
          const proposed = delta.proposed_unit;
          const existing = findUnit(units, proposed.unit_id);

          if (existing && !isValidTransition(existing.status, proposed.requested_status)) {
            const newConflict: P4PendingConflict = {
              kind: "unit_regression",
              unitId: existing.unitId,
              type: existing.type,
              requestedStatus: proposed.requested_status,
              requestedContent: proposed.content,
              requestedCanonRefs: proposed.canon_refs,
              ts: new Date().toISOString(),
            };
            await setP4PendingConflict(storyId, newConflict);
            pendingConflictForResponse = newConflict;
          } else if (proposed.canon_contradiction) {
            const newConflict: P4PendingConflict = {
              kind: "canon_contradiction",
              unitId: proposed.unit_id,
              type: proposed.type,
              sourceProject: proposed.canon_contradiction.source_project,
              contradictedRef: proposed.canon_contradiction.contradicted_ref,
              explanation: proposed.canon_contradiction.explanation,
              requestedStatus: proposed.requested_status,
              requestedContent: proposed.content,
              requestedCanonRefs: proposed.canon_refs,
              ts: new Date().toISOString(),
            };
            await setP4PendingConflict(storyId, newConflict);
            pendingConflictForResponse = newConflict;
          } else {
            const base = existing ?? createUnit(proposed.unit_id, proposed.type);
            const withContent = addCanonRefs(setUnitContent(base, proposed.content), proposed.canon_refs);

            const causalGate = evaluateCausalGate(
              proposed.requested_status,
              proposed.causal_tag,
              delta.active_step_number,
              proposed.causal_tag_reason
            );
            const coreValid = delta.validation_result === "passed";
            const combinedValid = coreValid && causalGate.ok;
            const combinedReason = !coreValid ? delta.validation_reason : causalGate.reason;

            const attempt = attemptStatusTransition(withContent, proposed.requested_status, {
              valid: combinedValid,
              reason: combinedReason,
            });
            statusAttempt = attempt;

            let finalUnit = attempt.unit;
            if (proposed.causal_tag === "Therefore" || proposed.causal_tag === "But") {
              finalUnit = setCausalTag(finalUnit, proposed.causal_tag);
            } else if (!causalGate.ok) {
              finalUnit = setCausalTag(finalUnit, "UNVALIDATED");
            }

            units = upsertUnit(units, finalUnit);
            await setP4Units(storyId, units);
            effectiveUnit = finalUnit;

            if (proposed.proposed_position_percent !== null) {
              const step = STRUCTURAL_STEPS.find((s) => s.stepNumber === delta.active_step_number);
              if (step) {
                placementFlag = checkPlacementDeviation(step, proposed.proposed_position_percent);
              }
            }
          }
        }
      }
  ```

  This preserves every line of the pre-existing ordinary-processing logic verbatim (the final
  `else` branch above) - only its trigger condition changed, from the old
  `if (p4.onboardingComplete && delta.proposed_unit)` to being the innermost `else` of the new
  two-trigger `if`/`else if` chain, still gated by the same outer `if (p4.onboardingComplete)`
  and still requiring `delta.proposed_unit` (via the `else if (!pendingConflictBefore &&
  delta.proposed_unit)` condition one level up). Do not reorder or reword the preserved lines.

- [ ] **Step 4: Add the response fields**

  In the `NextResponse.json({...})` call near the bottom of the function, add two new fields
  (after the existing `statusAccepted` line):
  ```ts
      statusAccepted: statusAttempt?.accepted ?? null,
      pendingConflict: pendingConflictForResponse,
      cascadeReview,
  ```

- [ ] **Step 5: Surface the pending conflict and cascade review in the UI**

  In `web/src/components/ArchitectureInterview.tsx`:

  Extend the `TurnResponse` interface (after the existing `statusAccepted` field) with:
  ```ts
    pendingConflict: { kind: "unit_regression" | "canon_contradiction"; unitId: string } | null;
    cascadeReview: { id: string; description: string }[] | null;
  ```
  (The response carries more fields than this on the `pendingConflict` object, but the UI only
  ever needs to know a conflict is open and which unit/kind it's about - it doesn't need to
  reconstruct the full conflict shape.)

  Add two new pieces of state, alongside the existing `validationResult`/`placementFlag` state:
  ```ts
    const [pendingConflict, setPendingConflict] = useState<{ kind: string; unitId: string } | null>(null);
    const [cascadeReview, setCascadeReview] = useState<{ id: string; description: string }[] | null>(null);
  ```

  In `sendMessage`, right after the existing `setStatusAccepted(data.statusAccepted);` line, add:
  ```ts
      setPendingConflict(data.pendingConflict);
      setCascadeReview(data.cascadeReview);
  ```

  Add a new banner, placed right after the existing rejection-reason banner block (after its
  closing `)}`), before the `{compiled && (` block:
  ```tsx
      {pendingConflict && (
        <div className="border-b border-orange-500/30 bg-orange-950/30 px-6 py-2 text-xs text-orange-200">
          Canon Revision Path open for unit "{pendingConflict.unitId}"
          {pendingConflict.kind === "unit_regression" ? " (status regression)" : " (canon contradiction)"} -
          present the three choices and wait for the author's pick.
        </div>
      )}
      {cascadeReview && cascadeReview.length > 0 && (
        <div className="border-b border-orange-500/30 bg-orange-950/20 px-6 py-2 text-xs text-orange-200">
          <p className="mb-1">Also worth reviewing:</p>
          <ul className="list-disc pl-4">
            {cascadeReview.map((entry) => (
              <li key={entry.id}>
                {entry.id} - {entry.description}
              </li>
            ))}
          </ul>
        </div>
      )}
  ```

- [ ] **Step 6: Verify**

  From `web/`, run:
  ```bash
  npx tsc --noEmit -p .
  npm run lint
  npm run build
  ```
  All three must be clean. Then trace by hand: an already-`Confirmed` unit re-proposed with
  `requested_status: "Working"` must produce a `unit_regression` conflict and leave the unit's
  stored status untouched this turn (no `setUnitStatus` call happens in the trigger-detection
  branch itself); a unit proposed with a non-null `canon_contradiction` must produce a
  `canon_contradiction` conflict and likewise leave the ledger untouched this turn; a normal
  turn with neither condition must reach the preserved `else` branch and behave exactly as
  before this plan (unchanged causal-gate/Core-Purpose behavior from #63).

- [ ] **Step 7: Commit**

  ```bash
  git add web/src/app/api/architecture-chat/route.ts web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: wire P4 Canon Revision Path triggers into the chat route and UI (issue #64)"
  ```
