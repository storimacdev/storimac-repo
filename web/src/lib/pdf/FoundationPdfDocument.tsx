"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";

/**
 * Client-side PDF rendering of the Story Foundation Document (issue #21).
 * Mirrors foundationDoc.ts's renderMarkdown() structure and headers
 * exactly - FoundationDocument itself is a frozen downstream contract and
 * is only ever read here, never modified.
 */

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 14 },
  h2: { fontSize: 12, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  label: { fontWeight: 700 },
  text: { marginBottom: 4, lineHeight: 1.4 },
  li: { marginLeft: 10, marginBottom: 2, lineHeight: 1.4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#d1d5db" },
  rowLabel: { width: 130, padding: 4, fontWeight: 700 },
  rowValue: { flex: 1, padding: 4 },
});

function pdfValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function pdfList(items: unknown[]): string[] {
  if (!items.length) return ["—"];
  return items.map((i) => (typeof i === "string" ? i : JSON.stringify(i)));
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <Text style={styles.text}>
      <Text style={styles.label}>{label}: </Text>
      {pdfValue(value)}
    </Text>
  );
}

function ListField({ label, items }: { label: string; items: unknown[] }) {
  return (
    <View>
      <Text style={styles.label}>{label}:</Text>
      {pdfList(items).map((line, i) => (
        <Text key={i} style={styles.li}>
          • {line}
        </Text>
      ))}
    </View>
  );
}

function TableRow({ label, value }: { label: string; value: unknown }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{pdfValue(value)}</Text>
    </View>
  );
}

export function FoundationPdfDocument({ doc }: { doc: FoundationDocument }) {
  const m = doc["1_story_metadata"];
  const dna = doc["2_story_dna"];
  const fmt = doc["3_story_format"];
  const gt = doc["6_genre_tone"];
  const tb = doc["7_thematic_blueprint"];
  const de = doc["8_dramatic_engine"];
  const wf = doc["10_world_foundation"];
  const sp = doc["11_story_spine"];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Story Foundation Document — {m.working_title}</Text>

        <Text style={styles.h2}>1. Story Metadata</Text>
        <TableRow label="ID" value={m.id} />
        <TableRow label="Version" value={m.version} />
        <TableRow label="Working Title" value={m.working_title} />
        <TableRow label="Author" value={m.author} />
        <TableRow label="Date" value={m.date} />
        <TableRow label="Status" value={m.status} />
        <TableRow label="Medium" value={m.medium} />
        <TableRow label="Target Length" value={m.target_length} />

        <Text style={styles.h2}>2. Story DNA</Text>
        <Field label="Core Story Promise" value={dna.core_story_promise} />
        <Field label="Story Identity" value={dna.story_identity} />
        <ListField label="Narrative Priorities" items={dna.narrative_priorities} />
        <ListField label="Always Emphasize" items={dna.always_emphasize} />
        <ListField label="Never Become" items={dna.never_become} />
        <ListField label="Comparable Works" items={dna.comparable_works} />

        <Text style={styles.h2}>3. Story Format</Text>
        <Field label="Primary Format" value={fmt.primary_format.name} />
        <Field label="Why" value={fmt.primary_format.reason} />
        {fmt.supporting_formats.length > 0 && (
          <ListField
            label="Supporting Formats"
            items={fmt.supporting_formats.map((f) => (f.reason ? `${f.name} — ${f.reason}` : f.name))}
          />
        )}

        <Text style={styles.h2}>4. Premise</Text>
        <Text style={styles.text}>{pdfValue(doc["4_premise"])}</Text>

        <Text style={styles.h2}>5. Logline</Text>
        <Text style={styles.text}>{pdfValue(doc["5_logline"])}</Text>

        <Text style={styles.h2}>6. Genre & Tone</Text>
        <TableRow label="Genre" value={gt.genre} />
        <TableRow label="Subgenre" value={gt.subgenre} />
        <TableRow label="Tone" value={gt.tone} />
        <TableRow label="Style" value={gt.style} />
        <TableRow label="Audience" value={gt.audience} />
        <TableRow label="Scale" value={gt.scale} />

        <Text style={styles.h2}>7. Thematic Blueprint</Text>
        <Field label="External Theme" value={tb.external_theme} />
        <Field label="Internal Theme" value={tb.internal_theme} />
        <Field label="Core Dramatic Question" value={tb.core_dramatic_question} />
        <Field label="Theme Statement" value={tb.theme_statement} />
        <Field label="Narrative Purpose" value={tb.narrative_purpose} />

        <Text style={styles.h2}>8. Dramatic Engine</Text>
        <Field label="Protagonist" value={de.protagonist} />
        <Field label="Antagonistic Force" value={de.antagonistic_force} />
        <Field label="Central Conflict" value={de.central_conflict} />
        <Field label="Primary Stakes" value={de.primary_stakes} />
        <Field label="Transformation Arc" value={de.transformation_arc} />
        <Field label="Emotional Journey" value={de.emotional_journey} />

        <Text style={styles.h2}>9. Principal Characters</Text>
        {doc["9_principal_characters"].length === 0 ? (
          <Text style={styles.text}>—</Text>
        ) : (
          doc["9_principal_characters"].map((c, i) => {
            if (c && typeof c === "object") {
              const o = c as Record<string, unknown>;
              const role = typeof o.story_role === "string" ? o.story_role : "role TBD";
              const desc = typeof o.description === "string" ? o.description : "";
              const fn = typeof o.primary_function === "string" ? ` Function: ${o.primary_function}` : "";
              return (
                <Text key={i} style={styles.li}>
                  • {String(o.name ?? "?")} ({role}) — {desc}
                  {fn}
                </Text>
              );
            }
            return (
              <Text key={i} style={styles.li}>
                • {String(c)}
              </Text>
            );
          })
        )}

        <Text style={styles.h2}>10. World Foundation</Text>
        <Field label="Time Period" value={wf.time_period} />
        <ListField label="Primary Settings" items={wf.primary_settings} />
        <Field label="Nature of World" value={wf.nature_of_world} />
        <ListField label="Premise Assumptions" items={wf.premise_assumptions} />
        <ListField label="Environmental Rules" items={wf.environmental_rules} />

        <Text style={styles.h2}>11. Story Spine</Text>
        <Text style={styles.li}>1. Opening Image: {pdfValue(sp.opening_image)}</Text>
        <Text style={styles.li}>2. Inciting Incident: {pdfValue(sp.inciting_incident)}</Text>
        <Text style={styles.li}>3. First Turning Point: {pdfValue(sp.first_turning_point)}</Text>
        <Text style={styles.li}>4. Midpoint: {pdfValue(sp.midpoint)}</Text>
        <Text style={styles.li}>5. Second Turning Point: {pdfValue(sp.second_turning_point)}</Text>
        <Text style={styles.li}>6. Climax: {pdfValue(sp.climax)}</Text>
        <Text style={styles.li}>7. Closing Image: {pdfValue(sp.closing_image)}</Text>

        <Text style={styles.h2}>12. Outstanding Questions</Text>
        {doc["12_outstanding_questions"].length === 0 ? (
          <Text style={styles.text}>None — everything resolved.</Text>
        ) : (
          doc["12_outstanding_questions"].map((q, i) => (
            <Text key={i} style={styles.li}>
              • {q.item} (defer to: {q.defer_to ?? "TBD"}){q.notes ? ` — ${q.notes}` : ""}
            </Text>
          ))
        )}

        <Text style={styles.h2}>13. Version History</Text>
        {doc["13_version_history"].map((v, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.rowLabel}>{v.version}</Text>
            <Text style={styles.rowValue}>
              {v.date} — {v.summary_of_changes}
            </Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function generateFoundationPdfBlob(doc: FoundationDocument): Promise<Blob> {
  return pdf(<FoundationPdfDocument doc={doc} />).toBlob();
}
