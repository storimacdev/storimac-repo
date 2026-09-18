import type { IngestedCanon } from "./ingestCanon";
import { STRUCTURAL_ACTS, STRUCTURAL_STEPS, CRITICAL_BEAT_LOOKUP } from "./structuralFramework";
import { getConfirmedUnits, type StructuralUnit } from "./stateLedger";
import { parseSceneRegisterEntry } from "./developmentLoop";
import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";

/**
 * Screenplay Architecture Document compile — GitHub issue #70,
 * completing every placeholder issue #60's own compiler deliberately
 * left for this issue. Split into a pure JSON builder (this function)
 * and a pure markdown renderer, mirroring
 * worldEngine/worldBibleCompiler.ts's compileWorldBibleDocument/
 * renderWorldBibleMarkdown split exactly (issue #50) - the
 * versioning/persistence orchestration lives in the sibling
 * screenplayArchitectureCompiler.ts, not here. Fully deterministic
 * (issue #60's own "no fabrication" posture, unlike the World Bible
 * compiler's LLM-synthesized sections) - two fields (`author`,
 * `estimated_runtime`) have no real data source anywhere in this app
 * yet and stay honest disclosed placeholders rather than fabricated
 * values.
 */

const NOT_TRACKED_AUTHOR = "(not tracked - no per-user authorship exists in this app yet)";
const NOT_TRACKED_RUNTIME = "(not tracked - no runtime-estimation model exists yet)";
const NOT_TRACKED_LEDGER =
  "Not yet tracked - no issue currently owns Setup & Payoff tracking (see the filed follow-up).";

export interface CompileScreenplayArchitectureDocumentParams {
  storyId: string;
  canon: IngestedCanon;
  units: StructuralUnit[];
  version: number;
  versionHistory: { version: string; date: string; summary_of_changes: string }[];
}

export function compileScreenplayArchitectureDocumentJson(
  params: CompileScreenplayArchitectureDocumentParams
): ScreenplayArchitectureDocument {
  const { storyId, canon, units, version, versionHistory } = params;
  const confirmed = getConfirmedUnits(units);
  const outstanding = units.filter((u) => u.status !== "Confirmed");
  const date = new Date().toISOString().slice(0, 10);

  const sceneRegister = confirmed.map((unit, index) => {
    const content = typeof unit.content === "string" ? unit.content : "";
    const parsed = parseSceneRegisterEntry(content);
    return {
      unit_id: unit.unitId,
      type: unit.type,
      scene_number: index + 1,
      slugline: parsed.slugline,
      critical_beat_tag: parsed.criticalBeatTag,
      paragraph: parsed.paragraph,
      causal_tag: unit.causalTag,
    };
  });

  const earmarkIndex = Object.keys(CRITICAL_BEAT_LOOKUP).map((tag) => {
    const entry = sceneRegister.find((s) => s.critical_beat_tag === tag);
    return {
      tag,
      scene_number: entry?.scene_number ?? null,
      unit_id: entry?.unit_id ?? null,
      slugline: entry?.slugline ?? null,
    };
  });

  const actOverview = STRUCTURAL_ACTS.map((act) => ({
    act_id: act.id,
    act_name: act.name,
    step_numbers: act.stepNumbers,
    anchoring_set_pieces: STRUCTURAL_STEPS.filter(
      (step) => act.stepNumbers.includes(step.stepNumber) && step.type === "Set Piece"
    ).map((step) => step.title),
  }));

  return {
    schema_version: "1.0",
    "1_screenplay_metadata": {
      story_id: storyId,
      screenplay_architecture_version: `v${version}`,
      working_title: canon.p1?.workingTitle || "(not yet Confirmed)",
      date,
      status: "Compiled",
      author: NOT_TRACKED_AUTHOR,
      diagnosed_complexity: "N/A",
      projected_scene_count: confirmed.length,
      estimated_runtime: NOT_TRACKED_RUNTIME,
    },
    "2_story_dna_blueprint": {
      summary_of_core_promise: canon.p1?.storyDna.core_story_promise || "(not yet Confirmed)",
      genre: canon.p1?.genreTone.genre || "(not yet Confirmed)",
      tone: canon.p1?.genreTone.tone || "(not yet Confirmed)",
      theme:
        canon.p1?.thematicBlueprint.theme_statement ||
        canon.p1?.thematicBlueprint.external_theme ||
        "(not yet Confirmed)",
      core_dramatic_question: canon.p1?.thematicBlueprint.core_dramatic_question || "(not yet Confirmed)",
    },
    "3_structural_act_set_piece_overview": actOverview,
    "4_complete_approved_scene_register": sceneRegister,
    "5_critical_beat_earmark_index": earmarkIndex,
    "6_setup_payoff_ledger": NOT_TRACKED_LEDGER,
    "7_outstanding_decisions_version_history": {
      outstanding: outstanding.map((u) => ({ unit_id: u.unitId, status: u.status })),
      version_history: versionHistory,
    },
  };
}

function mdValue(v: string): string {
  return v || "—";
}

export function renderScreenplayArchitectureMarkdown(doc: ScreenplayArchitectureDocument): string {
  const sections: string[] = [];
  const meta = doc["1_screenplay_metadata"];
  sections.push(
    "## 1. Screenplay Metadata\n" +
      `- ID: ${meta.story_id}\n` +
      `- Version: ${meta.screenplay_architecture_version}\n` +
      `- Working Title: ${mdValue(meta.working_title)}\n` +
      `- Date: ${meta.date}\n` +
      `- Status: ${meta.status}\n` +
      `- Author: ${meta.author}\n` +
      `- Diagnosed Complexity: ${meta.diagnosed_complexity}\n` +
      `- Projected Scene Count: ${meta.projected_scene_count} (target range: 75-150 scenes)\n` +
      `- Estimated Runtime: ${meta.estimated_runtime}`
  );

  const dna = doc["2_story_dna_blueprint"];
  sections.push(
    "## 2. Story DNA Blueprint\n" +
      `- Summary of Core Promise: ${mdValue(dna.summary_of_core_promise)}\n` +
      `- Genre: ${mdValue(dna.genre)}\n` +
      `- Tone: ${mdValue(dna.tone)}\n` +
      `- Theme: ${mdValue(dna.theme)}\n` +
      `- Core Dramatic Question: ${mdValue(dna.core_dramatic_question)}`
  );

  sections.push(
    "## 3. Structural Act & Set Piece Overview\n" +
      doc["3_structural_act_set_piece_overview"]
        .map(
          (act) =>
            `- Act ${act.act_id} (${act.act_name}): Steps ${act.step_numbers.join(", ")}${
              act.anchoring_set_pieces.length > 0
                ? ` (anchoring Set Piece${act.anchoring_set_pieces.length > 1 ? "s" : ""}: ${act.anchoring_set_pieces.join("; ")})`
                : ""
            }`
        )
        .join("\n")
  );

  const sceneRegister = doc["4_complete_approved_scene_register"];
  sections.push(
    "## 4. Complete Approved Scene Register\n" +
      (sceneRegister.length > 0
        ? sceneRegister
            .map(
              (s) =>
                `${s.scene_number}. ${s.slugline}${s.critical_beat_tag ? ` [CRITICAL BEAT: ${s.critical_beat_tag}]` : ""} - causal tag: ${s.causal_tag}\n   ${s.paragraph}`
            )
            .join("\n")
        : "_No units are Confirmed yet._")
  );

  sections.push(
    "## 5. Critical Beat Earmark Index\n" +
      "| Critical Beat | Scene Number | Slugline |\n|---|---|---|\n" +
      doc["5_critical_beat_earmark_index"]
        .map((e) => `| ${e.tag} | ${e.scene_number ?? "_missing_"} | ${e.slugline ?? "_missing_"} |`)
        .join("\n")
  );

  sections.push("## 6. Setup & Payoff Ledger\n" + doc["6_setup_payoff_ledger"]);

  const outstandingSection = doc["7_outstanding_decisions_version_history"];
  sections.push(
    "## 7. Outstanding Decisions & Version History\n" +
      (outstandingSection.outstanding.length > 0
        ? outstandingSection.outstanding.map((u) => `- [${u.unit_id}] status: ${u.status}`).join("\n")
        : "_No outstanding items._") +
      "\n\n### Version History\n" +
      outstandingSection.version_history.map((v) => `- ${v.version} (${v.date}): ${v.summary_of_changes}`).join("\n")
  );

  return sections.join("\n\n");
}
