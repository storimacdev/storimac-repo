import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

/**
 * Client-side .docx rendering of the compiled World Bible (issue #52).
 * Mirrors worldBibleCompiler.ts's renderWorldBibleMarkdown() structure and
 * section order exactly - the docx package's imperative Paragraph/Table
 * API instead of markdown syntax, same posture already established by
 * characterBibleDocx.ts (issue #35) for Project 2's export.
 */

function docxValue(v: string): string {
  return v && v.trim() ? v : "—";
}

function fieldParagraph(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(docxValue(value))],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

function pillarsSection(pillars: WorldBibleDocument["4_master_world_pillars"]): Paragraph[] {
  if (pillars.length === 0) {
    return [new Paragraph("No pillars adopted yet.")];
  }
  const result: Paragraph[] = [];
  for (const p of pillars) {
    result.push(new Paragraph({ text: p.pillar, heading: HeadingLevel.HEADING_2 }));
    result.push(new Paragraph(docxValue(p.summary)));
  }
  return result;
}

function outstandingQuestionsSection(groups: WorldBibleDocument["13_outstanding_world_questions"]): Paragraph[] {
  if (groups.length === 0) {
    return [new Paragraph("None — everything resolved.")];
  }
  const result: Paragraph[] = [];
  for (const g of groups) {
    result.push(new Paragraph({ children: [new TextRun({ text: `${g.defer_to}:`, bold: true })] }));
    for (const q of g.items) {
      result.push(new Paragraph(`${docxValue(q.item)}${q.notes ? ` — ${docxValue(q.notes)}` : ""}`));
    }
  }
  return result;
}

function referenceLogSection(refLog: WorldBibleDocument["14_cross_project_reference_log"]): Paragraph[] {
  const result: Paragraph[] = [
    fieldParagraph(
      "Project 1 (Story Foundation)",
      refLog.project_1 ? `${refLog.project_1.working_title} (${refLog.project_1.version})` : "Not yet available."
    ),
    new Paragraph({ children: [new TextRun({ text: "Project 2 (Character Bible):", bold: true })] }),
  ];
  if (refLog.project_2.length === 0) {
    result.push(new Paragraph("Not yet available."));
  } else {
    for (const c of refLog.project_2) {
      result.push(new Paragraph(`${docxValue(c.character_name)} — ${c.story_role} (${c.canon_status})`));
    }
  }
  return result;
}

function versionHistoryTable(rows: WorldBibleDocument["15_version_history"]): Table {
  const cell = (text: string, bold = false) =>
    new TableCell({
      width: { size: 33, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    });
  const headerRow = new TableRow({ children: ["Version", "Date", "Summary of Changes"].map((h) => cell(h, true)) });
  const dataRows = rows.map(
    (v) => new TableRow({ children: [cell(v.version), cell(v.date), cell(docxValue(v.summary_of_changes))] })
  );
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] });
}

export async function generateWorldBibleDocxBlob(doc: WorldBibleDocument): Promise<Blob> {
  const m = doc["1_document_metadata"];
  const children: (Paragraph | Table)[] = [
    new Paragraph({ text: `World Bible — ${m.working_title}`, heading: HeadingLevel.TITLE }),

    sectionHeading("1. Document Metadata"),
    fieldParagraph("Story ID", m.story_id),
    fieldParagraph("World Bible Version", m.world_bible_version),
    fieldParagraph("Working Title", m.working_title),
    fieldParagraph("Date", m.date),
    fieldParagraph("Status", m.status),
    fieldParagraph("Related Project 1 Version", m.related_project_1_version),
    fieldParagraph("Related Project 2 Status", m.related_project_2_status),

    sectionHeading("2. World Overview & Complexity Summary"),
    new Paragraph(docxValue(doc["2_world_overview_complexity_summary"])),

    sectionHeading("3. High-Level World Assumptions & Canon Rules"),
    new Paragraph(docxValue(doc["3_world_assumptions_canon_rules"])),

    sectionHeading("4. Master World Pillars"),
    ...pillarsSection(doc["4_master_world_pillars"]),

    sectionHeading("5. Geography & Settings Registry"),
    new Paragraph(docxValue(doc["5_geography_settings_registry"])),

    sectionHeading("6. Societal Infrastructure Manual"),
    new Paragraph(docxValue(doc["6_societal_infrastructure_manual"])),

    sectionHeading("7. Cultural & Lived Experience Profiles"),
    new Paragraph(docxValue(doc["7_cultural_lived_experience_profiles"])),

    sectionHeading("8. Narrative Lore & History"),
    new Paragraph(docxValue(doc["8_narrative_lore_history"])),

    sectionHeading("9. System Mechanics"),
    new Paragraph(docxValue(doc["9_system_mechanics"])),

    sectionHeading("10. Significant Institutions & Artifacts"),
    new Paragraph(docxValue(doc["10_significant_institutions_artifacts"])),

    sectionHeading("11. Linguistic & Communication Profile"),
    new Paragraph(docxValue(doc["11_linguistic_communication_profile"])),

    sectionHeading("12. Interconnection Map & Systems Synthesis"),
    new Paragraph(docxValue(doc["12_interconnection_map_systems_synthesis"])),

    sectionHeading("13. Outstanding World Questions"),
    ...outstandingQuestionsSection(doc["13_outstanding_world_questions"]),

    sectionHeading("14. Cross-Project Reference Log"),
    ...referenceLogSection(doc["14_cross_project_reference_log"]),

    sectionHeading("15. Version History"),
    versionHistoryTable(doc["15_version_history"]),
  ];

  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}
