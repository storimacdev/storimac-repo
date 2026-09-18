import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";

/**
 * Screenplay Architecture Document .docx export - GitHub issue #70.
 * Mirrors docx/worldBibleDocx.ts's exact imperative, per-section-in-order
 * pattern (issue #50) - walks the typed JSON document directly, one
 * heading + body per section, in the same order
 * renderScreenplayArchitectureMarkdown already establishes.
 */

function docxValue(v: string): string {
  return v && v.trim() ? v : "—";
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

function fieldParagraph(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(docxValue(value))],
  });
}

export async function generateScreenplayArchitectureDocxBlob(doc: ScreenplayArchitectureDocument): Promise<Blob> {
  const children: (Paragraph | Table)[] = [];

  children.push(new Paragraph({ text: "Screenplay Architecture Document", heading: HeadingLevel.TITLE }));

  const meta = doc["1_screenplay_metadata"];
  children.push(sectionHeading("1. Screenplay Metadata"));
  children.push(fieldParagraph("ID", meta.story_id));
  children.push(fieldParagraph("Version", meta.screenplay_architecture_version));
  children.push(fieldParagraph("Working Title", meta.working_title));
  children.push(fieldParagraph("Date", meta.date));
  children.push(fieldParagraph("Status", meta.status));
  children.push(fieldParagraph("Author", meta.author));
  children.push(fieldParagraph("Diagnosed Complexity", meta.diagnosed_complexity));
  children.push(fieldParagraph("Projected Scene Count", String(meta.projected_scene_count)));
  children.push(fieldParagraph("Estimated Runtime", meta.estimated_runtime));

  const dna = doc["2_story_dna_blueprint"];
  children.push(sectionHeading("2. Story DNA Blueprint"));
  children.push(fieldParagraph("Summary of Core Promise", dna.summary_of_core_promise));
  children.push(fieldParagraph("Genre", dna.genre));
  children.push(fieldParagraph("Tone", dna.tone));
  children.push(fieldParagraph("Theme", dna.theme));
  children.push(fieldParagraph("Core Dramatic Question", dna.core_dramatic_question));

  children.push(sectionHeading("3. Structural Act & Set Piece Overview"));
  for (const act of doc["3_structural_act_set_piece_overview"]) {
    children.push(
      new Paragraph(
        `Act ${act.act_id} (${act.act_name}): Steps ${act.step_numbers.join(", ")}${
          act.anchoring_set_pieces.length > 0 ? ` — ${act.anchoring_set_pieces.join("; ")}` : ""
        }`
      )
    );
  }

  children.push(sectionHeading("4. Complete Approved Scene Register"));
  if (doc["4_complete_approved_scene_register"].length === 0) {
    children.push(new Paragraph("No units are Confirmed yet."));
  } else {
    for (const s of doc["4_complete_approved_scene_register"]) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${s.scene_number}. ${s.slugline}`, bold: true }),
            ...(s.critical_beat_tag
              ? [new TextRun({ text: `  [CRITICAL BEAT: ${s.critical_beat_tag}]`, italics: true })]
              : []),
          ],
        })
      );
      children.push(new Paragraph(s.paragraph));
    }
  }

  children.push(sectionHeading("5. Critical Beat Earmark Index"));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 33, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: "Critical Beat", bold: true })] })],
            }),
            new TableCell({
              width: { size: 33, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: "Scene #", bold: true })] })],
            }),
            new TableCell({
              width: { size: 33, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: "Slugline", bold: true })] })],
            }),
          ],
        }),
        ...doc["5_critical_beat_earmark_index"].map(
          (e) =>
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 33, type: WidthType.PERCENTAGE },
                  children: [new Paragraph(e.tag)],
                }),
                new TableCell({
                  width: { size: 33, type: WidthType.PERCENTAGE },
                  children: [new Paragraph(e.scene_number !== null ? String(e.scene_number) : "missing")],
                }),
                new TableCell({
                  width: { size: 33, type: WidthType.PERCENTAGE },
                  children: [new Paragraph(e.slugline ?? "missing")],
                }),
              ],
            })
        ),
      ],
    })
  );

  children.push(sectionHeading("6. Setup & Payoff Ledger"));
  children.push(new Paragraph(doc["6_setup_payoff_ledger"]));

  const outstandingSection = doc["7_outstanding_decisions_version_history"];
  children.push(sectionHeading("7. Outstanding Decisions & Version History"));
  if (outstandingSection.outstanding.length > 0) {
    for (const u of outstandingSection.outstanding) {
      children.push(new Paragraph(`${u.unit_id} - status: ${u.status}`));
    }
  } else {
    children.push(new Paragraph("No outstanding items."));
  }
  children.push(new Paragraph({ text: "Version History", heading: HeadingLevel.HEADING_2 }));
  for (const v of outstandingSection.version_history) {
    children.push(new Paragraph(`${v.version} (${v.date}): ${v.summary_of_changes}`));
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}
