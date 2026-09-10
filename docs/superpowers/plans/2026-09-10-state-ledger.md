# State Ledger Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the per-structural-unit state ledger (issue #62) —
a pure, in-memory TypeScript module tracking each scene/sequence/set
piece/plot point's `Exploring`/`Working`/`Confirmed`/`Parked` status,
with a Confirmed-only filter for the future compiler and `canon_refs`
tracking.

**Architecture:** One new file, `web/src/lib/storyArchitectureEngine/stateLedger.ts`.
Reuses `CanonStatus` from `canonEngine/types.ts` rather than redefining
an identical status union. Every update function is a pure,
immutable-update function (returns a new object/array, never mutates
its argument), matching `canonStore.ts`'s established convention.

**Tech Stack:** TypeScript. No test runner is configured in this repo
(`npm test` has no script) — verification is `npm run lint` (must be
clean), `npm run build` (must succeed), and manual/code-trace
verification against concrete input/output pairs.

## Global Constraints

- Reuse `CanonStatus` from `@/lib/canonEngine/types` for `StructuralUnit.status`
  — never redefine an equivalent union.
- Every update function returns a new object/array; none mutate their
  input arguments.
- No Firestore read/write, no LLM call — this is pure, synchronous,
  in-memory data.
- No causality validation, canon-revision, thematic-anchor-audit, or
  scene-register-format logic — those belong to issues #63/#64/#65/#66,
  not this module.
- No `routing_choice`, `outstanding_decisions`, or `canon_revision_log`
  fields/state — this module owns only the `units[]` ledger itself.

---

### Task 1: Types and per-unit update functions

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/stateLedger.ts`

**Interfaces:**
- Consumes: `type CanonStatus` from `@/lib/canonEngine/types`.
- Produces (used by Task 2): `export type StructuralUnitType = "Scene" | "Sequence" | "SetPiece" | "PlotPoint";`; `export type CausalTag = "Therefore" | "But" | "UNVALIDATED";`; `export interface StructuralUnit { unitId: string; type: StructuralUnitType; status: CanonStatus; content: unknown; causalTag: CausalTag; canonRefs: string[]; lastUpdated: string; }`; `export function createUnit(unitId: string, type: StructuralUnitType, now?: string): StructuralUnit`; `export function setUnitStatus(unit: StructuralUnit, status: CanonStatus, now?: string): StructuralUnit`; `export function setUnitContent(unit: StructuralUnit, content: unknown, now?: string): StructuralUnit`; `export function addCanonRefs(unit: StructuralUnit, refs: string[], now?: string): StructuralUnit`.

- [ ] **Step 1: Create the file with types and per-unit functions**

```ts
import type { CanonStatus } from "@/lib/canonEngine/types";

/**
 * The state ledger for Project 4's structural units — GitHub issue #62,
 * PRD §7.6 FR-6.1/FR-6.2, §9's `session_state.json` `units[]` shape.
 * Pure, in-memory, immutable-update functions - no Firestore, no LLM
 * call (P4 session state is in-memory only for this phase; persistence
 * is issue #69). `causalTag` exists per §9's shape but is never computed
 * or validated here - that's issue #63 (Causality Validation).
 */

export type StructuralUnitType = "Scene" | "Sequence" | "SetPiece" | "PlotPoint";
export type CausalTag = "Therefore" | "But" | "UNVALIDATED";

export interface StructuralUnit {
  unitId: string;
  type: StructuralUnitType;
  status: CanonStatus;
  content: unknown;
  causalTag: CausalTag;
  canonRefs: string[];
  lastUpdated: string;
}

function nowOrDefault(now?: string): string {
  return now ?? new Date().toISOString();
}

/** A brand-new unit starts `Exploring`, matching the same "every new
 * thing starts Exploring" convention Projects 1-3 already use. */
export function createUnit(unitId: string, type: StructuralUnitType, now?: string): StructuralUnit {
  return {
    unitId,
    type,
    status: "Exploring",
    content: null,
    causalTag: "UNVALIDATED",
    canonRefs: [],
    lastUpdated: nowOrDefault(now),
  };
}

export function setUnitStatus(unit: StructuralUnit, status: CanonStatus, now?: string): StructuralUnit {
  return { ...unit, status, lastUpdated: nowOrDefault(now) };
}

export function setUnitContent(unit: StructuralUnit, content: unknown, now?: string): StructuralUnit {
  return { ...unit, content, lastUpdated: nowOrDefault(now) };
}

/** Appends and de-duplicates - `canonRefs` is a set of justifications,
 * not a log of every time one was cited. */
export function addCanonRefs(unit: StructuralUnit, refs: string[], now?: string): StructuralUnit {
  return {
    ...unit,
    canonRefs: Array.from(new Set([...unit.canonRefs, ...refs])),
    lastUpdated: nowOrDefault(now),
  };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings).
Run `npm run build` from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these against the code by hand:

- **`createUnit("PP1-OpeningImage", "PlotPoint", "2026-01-01T00:00:00.000Z")`**
  → `{ unitId: "PP1-OpeningImage", type: "PlotPoint", status: "Exploring", content: null, causalTag: "UNVALIDATED", canonRefs: [], lastUpdated: "2026-01-01T00:00:00.000Z" }`.
- **`setUnitStatus(unit, "Confirmed", "2026-01-02T00:00:00.000Z")`** on the
  unit above → same object except `status: "Confirmed"` and
  `lastUpdated: "2026-01-02T00:00:00.000Z"`; confirm the ORIGINAL `unit`
  object passed in is unchanged (not mutated) — read back its `status`
  after the call and confirm it's still `"Exploring"`.
- **`addCanonRefs(unit, ["project1.story_spine.opening_image"])`** then
  **`addCanonRefs(that result, ["project1.story_spine.opening_image", "project2.rhea.milestones.opening_image"])`**
  → final `canonRefs` is `["project1.story_spine.opening_image", "project2.rhea.milestones.opening_image"]`
  (the duplicate first ref appears only once).
- **`createUnit(..., undefined)`** (no `now` passed) → `lastUpdated` is a
  real, current ISO 8601 timestamp string (the `nowOrDefault` fallback
  fired), not `undefined` or a literal `"undefined"` string.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/stateLedger.ts
git commit -m "feat: add per-unit types and update functions to the state ledger module"
```

---

### Task 2: Array-level operations (`upsertUnit`, `findUnit`, `getConfirmedUnits`)

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/stateLedger.ts`

**Interfaces:**
- Consumes: `StructuralUnit` (Task 1).
- Produces (the module's remaining public API, consumed by a future
  onboarding/dev-loop module and by issue #60's compiler):
  `export function upsertUnit(units: StructuralUnit[], unit: StructuralUnit): StructuralUnit[]`;
  `export function findUnit(units: StructuralUnit[], unitId: string): StructuralUnit | null`;
  `export function getConfirmedUnits(units: StructuralUnit[]): StructuralUnit[]`.

- [ ] **Step 1: Add the array-level functions**

Add at the end of the file, after `addCanonRefs`:

```ts
/** Replaces the array entry whose `unitId` matches, or appends if none
 * does - the one array-level operation a caller needs to maintain a
 * `StructuralUnit[]` session ledger immutably, turn by turn. */
export function upsertUnit(units: StructuralUnit[], unit: StructuralUnit): StructuralUnit[] {
  const index = units.findIndex((u) => u.unitId === unit.unitId);
  if (index === -1) {
    return [...units, unit];
  }
  return units.map((u, i) => (i === index ? unit : u));
}

export function findUnit(units: StructuralUnit[], unitId: string): StructuralUnit | null {
  return units.find((u) => u.unitId === unitId) ?? null;
}

/** AC2: only `Confirmed` units are eligible for a compiled document's
 * binding sections - a future compiler (issue #60) calls this instead
 * of re-deriving the Confirmed-only rule itself. */
export function getConfirmedUnits(units: StructuralUnit[]): StructuralUnit[] {
  return units.filter((u) => u.status === "Confirmed");
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

- **`upsertUnit([], unitA)`** → `[unitA]` (append-on-empty-array branch).
- **`upsertUnit([unitA, unitB], updatedUnitA)`** (same `unitId` as
  `unitA`, different `status`) → `[updatedUnitA, unitB]` — `unitA` is
  replaced in place, `unitB` untouched, and the ORIGINAL input array is
  unchanged (confirm by reading it back after the call).
  `[unitA, unitB]` unaffected — confirm this too.
- **`findUnit([unitA, unitB], unitB.unitId)`** → `unitB`.
- **`findUnit([unitA, unitB], "nonexistent-id")`** → `null`, no throw.
- **`getConfirmedUnits([confirmedUnit, workingUnit, exploringUnit, parkedUnit])`**
  → `[confirmedUnit]` only.
- **`getConfirmedUnits([])`** → `[]`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/stateLedger.ts
git commit -m "feat: add array-level upsert/find/confirmed-filter operations to the state ledger module"
```
