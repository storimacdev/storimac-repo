import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import type { CharacterBibleEntry } from "@/lib/canonEngine/storyStore";

/**
 * Client-side .docx rendering of the compiled Character Bible - GitHub
 * issue #35. Mirrors characterBibleMarkdown.ts's renderCharacterBibleMarkdown()
 * structure and section order exactly, built with the `docx` package's
 * imperative Paragraph/Table API instead of markdown syntax - there's no
 * JSX-declarative equivalent for docx the way @react-pdf/renderer has for
 * PDF (FoundationPdfDocument.tsx's Field/ListField/TableRow components are
 * the closest precedent, translated here to plain functions).
 */

function docxValue(v: string): string {
  return v === "" ? "—" : v;
}

function fieldParagraph(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(docxValue(value))],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function relationshipsSection(rows: CharacterBibleEntry["ensemble_interconnection_registry"]): (Paragraph | Table)[] {
  if (rows.length === 0) {
    return [new Paragraph("No relationships recorded.")];
  }
  const cell = (text: string, bold = false) =>
    new TableCell({
      width: { size: 25, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    });
  const headerRow = new TableRow({
    children: ["With", "Dynamic", "Trust Trajectory", "Power Dynamic"].map((h) => cell(h, true)),
  });
  const dataRows = rows.map(
    (r) => new TableRow({ children: [cell(r.with), cell(docxValue(r.dynamic)), cell(docxValue(r.trust_trajectory)), cell(docxValue(r.power_dynamic))] })
  );
  return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] })];
}

function renderEntry(entry: CharacterBibleEntry): (Paragraph | Table)[] {
  const m = entry.metadata;
  return [
    new Paragraph({ text: m.character_name, heading: HeadingLevel.HEADING_1 }),
    new Paragraph({
      children: [
        new TextRun({
          text: `${m.story_role || "role not set"} · ${m.narrative_importance || "tier not set"} tier · ${m.development_depth || "depth not set"} depth · ${m.arc_type || "arc type not set"} · ${m.canon_status}`,
          italics: true,
        }),
      ],
    }),
    sectionHeading("Metadata"),
    fieldParagraph("Age", m.age),
    fieldParagraph("Occupation", m.occupation),
    sectionHeading("Story Function & Integration Map"),
    fieldParagraph("Narrative Purpose", entry.story_function.narrative_purpose),
    fieldParagraph("Protagonist Relationship", entry.story_function.protagonist_relationship),
    fieldParagraph("Conflict Contribution", entry.story_function.conflict_contribution),
    fieldParagraph("Thematic Thesis", entry.story_function.thematic_thesis),
    sectionHeading("The Psychological Engine"),
    fieldParagraph("Want", entry.psychological_engine.want),
    fieldParagraph("Personality (How)", entry.psychological_engine.personality_how),
    fieldParagraph("Need", entry.psychological_engine.need),
    fieldParagraph("Values", entry.psychological_engine.values),
    fieldParagraph("Life Experience", entry.psychological_engine.life_experience),
    fieldParagraph("Core Wound", entry.psychological_engine.core_wound),
    fieldParagraph("False Belief", entry.psychological_engine.false_belief),
    fieldParagraph("Core Flaw", entry.psychological_engine.core_flaw),
    fieldParagraph("Dominant Fear", entry.psychological_engine.dominant_fear),
    fieldParagraph("Defense Mechanisms", entry.psychological_engine.defense_mechanisms),
    fieldParagraph("Behavioral Trajectory", entry.psychological_engine.behavioral_trajectory),
    sectionHeading("Behavior & Audible Voice Profile"),
    fieldParagraph("Physical Description", entry.behavior_voice_profile.physical_description),
    fieldParagraph("Habits", entry.behavior_voice_profile.habits),
    fieldParagraph("Voice Signature", entry.behavior_voice_profile.voice_signature),
    fieldParagraph("Behavior Under Stress", entry.behavior_voice_profile.behavior_under_stress),
    sectionHeading("Ensemble Interconnection Registry"),
    ...relationshipsSection(entry.ensemble_interconnection_registry),
    sectionHeading("Milestone Arc Timeline"),
    fieldParagraph("Initial Worldview", entry.milestone_arc_timeline.initial_worldview),
    fieldParagraph("Inciting Disruption", entry.milestone_arc_timeline.inciting_disruption),
    fieldParagraph("Failed Resistance", entry.milestone_arc_timeline.failed_resistance),
    fieldParagraph("Midpoint Realization", entry.milestone_arc_timeline.midpoint_realization),
    fieldParagraph("Crisis Choice", entry.milestone_arc_timeline.crisis_choice),
    fieldParagraph("Action-Proven Transformation", entry.milestone_arc_timeline.action_proven_transformation),
    fieldParagraph("New Identity", entry.milestone_arc_timeline.new_identity),
    sectionHeading("Continuity & Canon Rules"),
    new Paragraph(docxValue(entry.continuity_canon_rules)),
    sectionHeading("Outstanding Character Questions"),
    ...(entry.outstanding_questions.length
      ? entry.outstanding_questions.map(
          (q) => new Paragraph(`${q.item} (defer to: ${q.defer_to ?? "TBD"})${q.notes ? ` — ${q.notes}` : ""}`)
        )
      : [new Paragraph("None — everything resolved.")]),
  ];
}

export async function generateCharacterBibleDocxBlob(entries: CharacterBibleEntry[]): Promise<Blob> {
  const sorted = [...entries].sort((a, b) => a.signed_off_at.localeCompare(b.signed_off_at));
  const children: (Paragraph | Table)[] = [new Paragraph({ text: "Character Bible", heading: HeadingLevel.TITLE })];
  for (const entry of sorted) {
    children.push(...renderEntry(entry));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}
