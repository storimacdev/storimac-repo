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
