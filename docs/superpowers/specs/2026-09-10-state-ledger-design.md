# State Ledger Module (Issue #62) — Design

## Problem

PRD §7.6 FR-6.1/FR-6.2 and §9's `session_state.json` require a per-structural-unit
state ledger (scene, sequence, set piece, plot point) carrying an
`Exploring`/`Working`/`Confirmed`/`Parked` status, with only `Confirmed`
units eligible for a compiled document's binding sections, and each
entry recording `canon_refs` back to the Project 1-3 fields that justify
it.

## Scope boundary

This issue is the **data structure and its transition operations only**.
Explicitly out of scope, each belonging to its own already-filed issue:
- Causality Validation (tagging transitions `Therefore`/`But`/flagging
  `And Then`) — issue #63. This module's `causalTag` field exists (per
  §9's `units[]` shape) and defaults to `"UNVALIDATED"`; nothing in this
  issue computes or validates it.
- Relational Impact Check / Canon Revision — issue #64.
- Thematic Anchor Audit — issue #65.
- Scene Register content format — issue #66.
- `routing_choice`, `outstanding_decisions`, `canon_revision_log` (the
  OTHER top-level fields of `session_state.json` besides `units[]`) —
  each belongs to the issue that owns that concern (#57 for routing,
  #68 for deferral logging, #64 for the revision log). This module
  exports only the unit ledger itself; a future session-state issue
  assembles the full `session_state.json` shape by composing this
  module's `StructuralUnit[]` with those other issues' own state.

## Decision: reuse `CanonStatus`, don't redefine it

§9's `units[]` status values (`Exploring`/`Working`/`Confirmed`/`Parked`)
are byte-identical to the existing `CanonStatus` type
(`web/src/lib/canonEngine/types.ts`), already the shared status
vocabulary Projects 1-3 all use for their own canon elements. Reusing it
here means a structural unit's status and a canon element's status are
provably the same four-state machine — no risk of the two vocabularies
drifting apart, and no new type to keep in sync.

## Architecture

New file: `web/src/lib/storyArchitectureEngine/stateLedger.ts`. Pure,
synchronous, in-memory data functions — no Firestore, no LLM call. (Per
issue #59's own explicit scoping, P4 session state is in-memory only for
this phase; persistence is issue #69, later.) Every update function
returns a new `StructuralUnit`/array rather than mutating in place,
matching this codebase's established immutable-update convention
(`canonStore.ts`'s `applyStateDelta`, `characterFsm.ts`'s
`resolveCharacterTurn`).

### Types

```ts
import type { CanonStatus } from "@/lib/canonEngine/types";

export type StructuralUnitType = "Scene" | "Sequence" | "SetPiece" | "PlotPoint";
export type CausalTag = "Therefore" | "But" | "UNVALIDATED";

export interface StructuralUnit {
  unitId: string;
  type: StructuralUnitType;
  status: CanonStatus;
  content: unknown;
  causalTag: CausalTag;
  canonRefs: string[];
  lastUpdated: string; // ISO 8601
}
```

### Functions

```ts
export function createUnit(unitId: string, type: StructuralUnitType, now?: string): StructuralUnit;
export function setUnitStatus(unit: StructuralUnit, status: CanonStatus, now?: string): StructuralUnit;
export function setUnitContent(unit: StructuralUnit, content: unknown, now?: string): StructuralUnit;
export function addCanonRefs(unit: StructuralUnit, refs: string[], now?: string): StructuralUnit;
export function upsertUnit(units: StructuralUnit[], unit: StructuralUnit): StructuralUnit[];
export function findUnit(units: StructuralUnit[], unitId: string): StructuralUnit | null;
export function getConfirmedUnits(units: StructuralUnit[]): StructuralUnit[];
```

- `createUnit` starts a unit at `status: "Exploring"`, `causalTag:
  "UNVALIDATED"`, `content: null`, `canonRefs: []` — the same "every new
  thing starts Exploring" convention Projects 1-3 already use.
- `setUnitStatus`/`setUnitContent`/`addCanonRefs` each return a **new**
  object (spread + override), updating `lastUpdated` to `now` (an
  optional injected ISO string, defaulting to `new Date().toISOString()`
  — injectable so callers/tests can pass a fixed value instead of
  depending on wall-clock time). `addCanonRefs` appends and de-duplicates
  (a `Set` union) rather than replacing, since a unit can accumulate
  justifying canon references from multiple turns.
- `upsertUnit` replaces the array entry whose `unitId` matches, or
  appends if none does — the one array-level operation a caller needs to
  maintain a `StructuralUnit[]` session ledger immutably turn-by-turn.
- `getConfirmedUnits` is a plain filter — this satisfies AC2 directly: a
  future compiler (issue #60) calls this instead of re-deriving the
  Confirmed-only rule itself.

## Edge cases

- **`addCanonRefs` called with a ref already present:** de-duplicated,
  not appended twice — a unit's `canonRefs` is a set of justifications,
  not a log of every time one was cited.
- **`upsertUnit` on an empty array:** appends as the array's only entry
  (falls through the "no match found" branch the same as any other
  miss).
- **`findUnit` for a `unitId` that doesn't exist:** returns `null`, never
  throws — callers (a future onboarding/dev-loop module) are expected to
  handle "not yet created" as a normal case, not an error.

## Out of scope

- No Firestore persistence (issue #69, later phase).
- No causality validation, canon-revision, thematic-anchor-audit, or
  scene-register-format logic (issues #63/#64/#65/#66).
- No `routing_choice`/`outstanding_decisions`/`canon_revision_log` state
  — this module owns only `units[]`.
- No live chat route or system prompt — this is a backend logic module
  a future P4 conversational agent will import and call, the same
  relationship `ingestCanon.ts` (#55) and `structuralFramework.ts` (#58)
  already have to their own future consumers.
