# Manual Screenplay Architecture Document Compile (Issue #60) — Design

## Problem

PRD §7.8 FR-8.1/FR-8.3 (superseded by P4 Prompt v3.0 §6, issue #70's
7-section list) requires: on an explicit "compile" trigger, assemble
only `Confirmed` state-ledger content; list any `Working`/`Exploring`/
`Parked` item under Outstanding Decisions, never silently dropped or
treated as confirmed; target the fixed 7-section structure even though
full formatting fidelity isn't required until Phase 3 (issue #70).

## Scope boundary: structural correctness now, formatting fidelity later

Issue #60's own AC explicitly defers "full formatting fidelity" to
Phase 3 (issue #70's full compiler). Several of the 7 sections depend on
data this phase's other modules don't populate yet:
- **Section 4** (Scene Register) needs the per-scene slugline/paragraph
  format from issue #66 — not built yet. `StructuralUnit.content` (#62)
  is intentionally opaque (`unknown`) until then.
- **Section 5** (Critical Beat Earmark Index) needs scene-to-beat
  assignment tracking — issue #70's own scope, not #62's ledger.
- **Section 6** (Setup & Payoff Ledger) needs setup/payoff tracking —
  issue #72's scope, not built anywhere yet.
- **Section 1**'s "Diagnosed Complexity" no longer exists (Framework
  v3.0 removed upfront Complexity diagnosis — see issue #56).
- **Version History auto-increment** is issue #70's AC, not #60's own
  (re-read: #60's three ACs are only the Confirmed-only filter, the
  Outstanding Decisions routing, and the 7-section skeleton itself).

**Decision (confirmed):** this issue builds the 7-section **skeleton**
and the two data-driven rules AC actually requires (Confirmed-only
Section 4, non-Confirmed → Section 7) using data that already exists
(`ingestCanon`, `structuralFramework`, `stateLedger`). Sections needing
data no other issue has built yet get an honest, explicit placeholder
naming the future issue that will populate them — never fabricated
content, matching this module family's established "never invent
canon" convention.

## Architecture

New file: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts`.

```ts
import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_ACTS } from "./structuralFramework";
import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";

export interface CompiledDocument {
  markdown: string;
  outstandingCount: number;
}

export function compileScreenplayArchitectureDocument(
  storyId: string,
  canon: IngestedCanon,
  units: StructuralUnit[]
): CompiledDocument {
  const confirmed = getConfirmedUnits(units);
  const outstanding = units.filter((u) => u.status !== "Confirmed");
  // ... assemble 7 sections, see plan for exact text ...
  return { markdown: /* joined sections */ "", outstandingCount: outstanding.length };
}
```

`confirmed`/`outstanding` reuse issue #62's own `getConfirmedUnits`
(AC1) rather than re-deriving the Confirmed-only rule; `outstanding` is
a plain `!== "Confirmed"` filter, satisfying AC2's "never silently
dropped" by construction — every unit in `units` lands in exactly one
of the two lists, never neither.

## Edge cases

- **`units` is empty** (a brand-new session): `confirmed: []`,
  `outstanding: []`, Section 4 reads "No units are Confirmed yet,"
  Section 7 reads "No outstanding items" — never an error.
- **`canon.p1` is `null`**: Section 2 (Story DNA Blueprint) reads
  "Project 1 (Story Foundation) is not yet complete" instead of
  dereferencing a null field.
- **Every unit is non-Confirmed**: `outstandingCount` equals
  `units.length`, Section 4 is empty (not fabricated), Section 7 lists
  every one of them.

## Out of scope

- Full 7-section formatting fidelity, Setup & Payoff Ledger content,
  Critical Beat Earmark Index population, Version History
  auto-increment — issue #70 (the full compiler) and #72 (Canon
  Revision cascade & Continuity Ledger).
- The actual "compile" trigger/UI action — a future live-agent
  integration issue, not this module (same relationship every other
  Phase 1 module has to a future live P4 agent).
- `.docx` export — Framework v3.0 doesn't commit to a format for this
  issue; Markdown only, matching issue #60's own title.
