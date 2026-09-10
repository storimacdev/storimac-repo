import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_ACTS, STRUCTURAL_STEPS } from "./structuralFramework";
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
      `- ID: ${storyId}\n` +
      "- Working Title: (not yet exposed by ingestCanon - see issue #55)\n" +
      "- Version: (not yet tracked - issue #70's scope)\n" +
      "- Date: (not yet tracked - issue #70's scope)\n" +
      "- Status: (not yet tracked - issue #70's scope)\n" +
      "- Author: (not yet tracked - issue #70's scope)\n" +
      "- Diagnosed Complexity: N/A (Complexity Level diagnosis removed in Framework v3.0 - see issue #56)\n" +
      `- Projected Scene Count & Estimated Runtime: ${confirmed.length} Confirmed unit(s) so far (target range: 75-150 scenes; Estimated Runtime not yet tracked - issue #70's scope)`
  );

  sections.push(
    "## 2. Story DNA Blueprint\n" +
      (canon.p1
        ? `- Summary of Core Promise: ${canon.p1.storyDna.core_story_promise || "(not yet Confirmed)"}\n` +
          "- Genre: (not yet exposed by ingestCanon - see issue #55)\n" +
          "- Tone: (not yet exposed by ingestCanon - see issue #55)\n" +
          `- Theme: ${canon.p1.thematicBlueprint.theme_statement || canon.p1.thematicBlueprint.external_theme || "(not yet Confirmed)"}\n` +
          `- Core Dramatic Question: ${canon.p1.thematicBlueprint.core_dramatic_question || "(not yet Confirmed)"}\n` +
          `- Format (supplementary context, not one of issue #70's listed fields): ${canon.p1.format.primary_format.name || "(not yet Confirmed)"}`
        : "- Project 1 (Story Foundation) is not yet complete.")
  );

  sections.push(
    "## 3. Structural Act & Set Piece Overview\n" +
      STRUCTURAL_ACTS.map((act) => {
        const setPieceTitles = STRUCTURAL_STEPS.filter(
          (step) => act.stepNumbers.includes(step.stepNumber) && step.type === "Set Piece"
        ).map((step) => step.title);
        return `- Act ${act.id} (${act.name}): Steps ${act.stepNumbers.join(", ")}${
          setPieceTitles.length > 0
            ? ` (anchoring Set Piece${setPieceTitles.length > 1 ? "s" : ""}: ${setPieceTitles.join("; ")})`
            : ""
        }`;
      }).join("\n")
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
