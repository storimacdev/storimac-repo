import type { CharacterBibleEntry } from "@/lib/canonEngine/storyStore";

/**
 * Renders the compiled Character Bible (every signed-off character so
 * far, issue #34) to Markdown - GitHub issue #35. Mirrors
 * foundationDoc.ts's renderMarkdown() in style and its mdValue() empty-
 * value convention, applied here to characterBibleCompiler.ts's already-
 * total CharacterBibleEntry shape (every field is always present, blank
 * string when not yet captured - see that file's own "total over missing
 * data" comment). Pure, no I/O.
 */

function mdValue(v: string): string {
  return v === "" ? "_—_" : v;
}

function fieldLines(fields: [string, string][]): string[] {
  return fields.map(([label, value]) => `- **${label}:** ${mdValue(value)}`);
}

function renderEntry(entry: CharacterBibleEntry): string[] {
  const m = entry.metadata;
  return [
    `## ${m.character_name}`,
    `_${m.story_role || "role not set"} · ${m.narrative_importance || "tier not set"} tier · ${m.development_depth || "depth not set"} depth · ${m.arc_type || "arc type not set"} · ${m.canon_status}_`,
    "",
    `### Metadata`,
    ...fieldLines([
      ["Age", m.age],
      ["Occupation", m.occupation],
    ]),
    "",
    `### Story Function & Integration Map`,
    ...fieldLines([
      ["Narrative Purpose", entry.story_function.narrative_purpose],
      ["Protagonist Relationship", entry.story_function.protagonist_relationship],
      ["Conflict Contribution", entry.story_function.conflict_contribution],
      ["Thematic Thesis", entry.story_function.thematic_thesis],
    ]),
    "",
    `### The Psychological Engine`,
    ...fieldLines([
      ["Want", entry.psychological_engine.want],
      ["Personality (How)", entry.psychological_engine.personality_how],
      ["Need", entry.psychological_engine.need],
      ["Values", entry.psychological_engine.values],
      ["Life Experience", entry.psychological_engine.life_experience],
      ["Core Wound", entry.psychological_engine.core_wound],
      ["False Belief", entry.psychological_engine.false_belief],
      ["Core Flaw", entry.psychological_engine.core_flaw],
      ["Dominant Fear", entry.psychological_engine.dominant_fear],
      ["Defense Mechanisms", entry.psychological_engine.defense_mechanisms],
      ["Behavioral Trajectory", entry.psychological_engine.behavioral_trajectory],
    ]),
    "",
    `### Behavior & Audible Voice Profile`,
    ...fieldLines([
      ["Physical Description", entry.behavior_voice_profile.physical_description],
      ["Habits", entry.behavior_voice_profile.habits],
      ["Voice Signature", entry.behavior_voice_profile.voice_signature],
      ["Behavior Under Stress", entry.behavior_voice_profile.behavior_under_stress],
    ]),
    "",
    `### Ensemble Interconnection Registry`,
    ...(entry.ensemble_interconnection_registry.length
      ? [
          `| With | Dynamic | Trust Trajectory | Power Dynamic |`,
          `| --- | --- | --- | --- |`,
          ...entry.ensemble_interconnection_registry.map(
            (r) => `| ${r.with} | ${mdValue(r.dynamic)} | ${mdValue(r.trust_trajectory)} | ${mdValue(r.power_dynamic)} |`
          ),
        ]
      : ["_No relationships recorded._"]),
    "",
    `### Milestone Arc Timeline`,
    ...fieldLines([
      ["Initial Worldview", entry.milestone_arc_timeline.initial_worldview],
      ["Inciting Disruption", entry.milestone_arc_timeline.inciting_disruption],
      ["Failed Resistance", entry.milestone_arc_timeline.failed_resistance],
      ["Midpoint Realization", entry.milestone_arc_timeline.midpoint_realization],
      ["Crisis Choice", entry.milestone_arc_timeline.crisis_choice],
      ["Action-Proven Transformation", entry.milestone_arc_timeline.action_proven_transformation],
      ["New Identity", entry.milestone_arc_timeline.new_identity],
    ]),
    "",
    `### Continuity & Canon Rules`,
    mdValue(entry.continuity_canon_rules),
    "",
    `### Outstanding Character Questions`,
    ...(entry.outstanding_questions.length
      ? entry.outstanding_questions.map(
          (q) => `- ${q.item} _(defer to: ${q.defer_to ?? "TBD"})_${q.notes ? ` — ${q.notes}` : ""}`
        )
      : ["_None — everything resolved._"]),
    "",
  ];
}

export function renderCharacterBibleMarkdown(entries: CharacterBibleEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.signed_off_at.localeCompare(b.signed_off_at));
  const lines: string[] = [`# Character Bible`, ""];
  for (const entry of sorted) {
    lines.push(...renderEntry(entry));
  }
  return lines.join("\n");
}
