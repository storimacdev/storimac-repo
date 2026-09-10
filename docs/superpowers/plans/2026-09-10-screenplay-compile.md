# Manual Screenplay Architecture Document Compile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the manual Markdown compile (issue #60) — assemble
the fixed 7-section Screenplay Architecture Document skeleton
(structure per issue #70's list), with only `Confirmed` units in Section
4 and every non-Confirmed unit routed to Section 7's Outstanding
Decisions, never silently dropped.

**Architecture:** One new file, `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts`,
consuming `IngestedCanon` (#55), `STRUCTURAL_ACTS` (#58), and
`StructuralUnit`/`getConfirmedUnits` (#62). Sections needing data no
other issue has built yet (per-scene formatting #66, Critical Beat
Index #70, Setup & Payoff Ledger #72, Version History #70) get an
honest placeholder naming the future issue — never fabricated content.

**Tech Stack:** TypeScript. No test runner configured — verification is
`npm run lint`, `npm run build`, and manual/code-trace verification.

## Global Constraints

- Section 4 (Scene Register) contains only `Confirmed` units, via
  issue #62's own `getConfirmedUnits` — never re-derive that filter.
- Every unit in the input `units` array lands in exactly one of
  Section 4 (if `Confirmed`) or Section 7's Outstanding Decisions (if
  anything else) — never both, never neither.
- No fabricated content for sections whose underlying data model
  doesn't exist yet (Critical Beat Index, Setup & Payoff Ledger,
  Version History) — an explicit placeholder naming the responsible
  future issue instead.
- No Firestore read/write, no LLM call, no `.docx` generation.

---

### Task 1: Compile function, all 7 sections

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts`

**Interfaces:**
- Consumes: `type IngestedCanon` from `./ingestCanon`; `STRUCTURAL_ACTS` from `./structuralFramework`; `getConfirmedUnits`, `type StructuralUnit` from `./stateLedger`.
- Produces: `export interface CompiledDocument { markdown: string; outstandingCount: number; }`; `export function compileScreenplayArchitectureDocument(storyId: string, canon: IngestedCanon, units: StructuralUnit[]): CompiledDocument`.

- [ ] **Step 1: Create the file**

```ts
import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_ACTS } from "./structuralFramework";
import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";

/**
 * Manual Screenplay Architecture Document compile — GitHub issue #60,
 * PRD §7.8 FR-8.1/FR-8.3 (superseded numbering; issue #70 owns the
 * exact 7-section list this follows). Full formatting fidelity is NOT
 * required until Phase 3 (issue #70) - this builds the 7-section
 * skeleton and the two rules AC actually requires now (Confirmed-only
 * Section 4, non-Confirmed routed to Section 7), with an honest
 * placeholder for every section whose underlying data model (per-scene
 * format #66, Critical Beat Index/Version History #70, Setup & Payoff
 * Ledger #72) doesn't exist yet - never fabricated content.
 */

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

  const sections: string[] = [];

  sections.push(
    "## 1. Screenplay Metadata\n" +
      `- Story ID: ${storyId}\n` +
      "- Diagnosed Complexity: N/A (Complexity Level diagnosis removed in Framework v3.0 - see issue #56)\n" +
      `- Projected Scene Count: ${confirmed.length} Confirmed unit(s) so far (target range: 75-150 scenes)`
  );

  sections.push(
    "## 2. Story DNA Blueprint\n" +
      (canon.p1
        ? `- Core Promise: ${canon.p1.storyDna.core_story_promise || "(not yet Confirmed)"}\n` +
          `- Format: ${canon.p1.format.primary_format.name || "(not yet Confirmed)"}\n` +
          `- Core Dramatic Question: ${canon.p1.thematicBlueprint.core_dramatic_question || "(not yet Confirmed)"}`
        : "- Project 1 (Story Foundation) is not yet complete.")
  );

  sections.push(
    "## 3. Structural Act & Set Piece Overview\n" +
      STRUCTURAL_ACTS.map((act) => `- Act ${act.id} (${act.name}): Steps ${act.stepNumbers.join(", ")}`).join("\n")
  );

  sections.push(
    "## 4. Complete Approved Scene Register\n" +
      (confirmed.length > 0
        ? confirmed.map((u) => `- [${u.unitId}] (${u.type}) - causal tag: ${u.causalTag}`).join("\n")
        : "_No units are Confirmed yet._")
  );

  sections.push(
    "## 5. Critical Beat Earmark Index\n" +
      "_Not yet populated - scene-to-critical-beat assignment tracking is issue #70's scope._"
  );

  sections.push(
    "## 6. Setup & Payoff Ledger\n" + "_Not yet tracked - setup/payoff tracking is issue #72's scope._"
  );

  sections.push(
    "## 7. Outstanding Decisions & Version History\n" +
      (outstanding.length > 0
        ? outstanding.map((u) => `- [${u.unitId}] status: ${u.status}`).join("\n")
        : "_No outstanding items._") +
      "\n\nVersion History: not yet tracked - issue #70's scope."
  );

  return {
    markdown: sections.join("\n\n"),
    outstandingCount: outstanding.length,
  };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build`
from `web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these by hand:

- **`units: []`** (brand-new session), any `canon`: confirm
  `outstandingCount: 0`, Section 4 reads "No units are Confirmed yet.",
  Section 7 reads "No outstanding items."
- **`units` has 2 Confirmed and 1 Working unit**: confirm `confirmed`
  has exactly the 2 Confirmed units, `outstanding` has exactly the 1
  Working unit, `outstandingCount: 1`, Section 4 lists only the 2
  Confirmed units (by `unitId`/`type`/`causalTag`), Section 7 lists
  only the 1 Working unit (by `unitId`/`status`) — confirm no unit
  appears in both sections, and no unit is missing from both.
- **`canon.p1` is `null`**: confirm Section 2 reads "Project 1 (Story
  Foundation) is not yet complete." without throwing on a null-field
  dereference.
- **`canon.p1` is populated**: confirm Section 2 reads the real
  `core_story_promise`/`primary_format.name`/`core_dramatic_question`
  values.
- **Section 3**: confirm all 4 acts appear (`"1"`, `"2A"`, `"2B"`,
  `"3"`), each listing its own `stepNumbers` (e.g. Act "1" lists "Steps
  1, 2, 3").
- **`markdown`**: confirm it's exactly the 7 section strings joined
  with `"\n\n"`, in order 1 through 7.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts
git commit -m "feat: add manual Screenplay Architecture Document compile (7-section skeleton)"
```
