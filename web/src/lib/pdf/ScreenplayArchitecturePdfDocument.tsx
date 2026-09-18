"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { ScreenplayArchitectureDocument } from "@/lib/canonEngine/storyStore";

/**
 * Client-side PDF rendering of the Screenplay Architecture Document
 * (issue #70). Mirrors WorldBiblePdfDocument.tsx's style constants,
 * heading levels, and bordered field-row table styling exactly.
 */

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111827" },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 14 },
  h2: { fontSize: 12, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  h3: { fontSize: 11, fontWeight: 700, marginTop: 8, marginBottom: 4 },
  label: { fontWeight: 700 },
  text: { marginBottom: 4, lineHeight: 1.4 },
  li: { marginLeft: 10, marginBottom: 2, lineHeight: 1.4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#d1d5db" },
  rowLabel: { width: 130, padding: 4, fontWeight: 700 },
  rowValue: { flex: 1, padding: 4 },
});

function pdfValue(v: string): string {
  return v && v.trim() ? v : "—";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{pdfValue(value)}</Text>
    </View>
  );
}

export function ScreenplayArchitecturePdfDocument({ doc }: { doc: ScreenplayArchitectureDocument }) {
  const meta = doc["1_screenplay_metadata"];
  const dna = doc["2_story_dna_blueprint"];
  const outstandingSection = doc["7_outstanding_decisions_version_history"];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Screenplay Architecture Document</Text>

        <Text style={styles.h2}>1. Screenplay Metadata</Text>
        <Field label="ID" value={meta.story_id} />
        <Field label="Version" value={meta.screenplay_architecture_version} />
        <Field label="Working Title" value={meta.working_title} />
        <Field label="Date" value={meta.date} />
        <Field label="Status" value={meta.status} />
        <Field label="Author" value={meta.author} />
        <Field label="Diagnosed Complexity" value={meta.diagnosed_complexity} />
        <Field label="Projected Scene Count" value={String(meta.projected_scene_count)} />
        <Field label="Estimated Runtime" value={meta.estimated_runtime} />

        <Text style={styles.h2}>2. Story DNA Blueprint</Text>
        <Field label="Summary of Core Promise" value={dna.summary_of_core_promise} />
        <Field label="Genre" value={dna.genre} />
        <Field label="Tone" value={dna.tone} />
        <Field label="Theme" value={dna.theme} />
        <Field label="Core Dramatic Question" value={dna.core_dramatic_question} />

        <Text style={styles.h2}>3. Structural Act & Set Piece Overview</Text>
        {doc["3_structural_act_set_piece_overview"].map((act) => (
          <Text key={act.act_id} style={styles.li}>
            Act {act.act_id} ({act.act_name}): Steps {act.step_numbers.join(", ")}
            {act.anchoring_set_pieces.length > 0 ? ` — ${act.anchoring_set_pieces.join("; ")}` : ""}
          </Text>
        ))}

        <Text style={styles.h2}>4. Complete Approved Scene Register</Text>
        {doc["4_complete_approved_scene_register"].length === 0 ? (
          <Text style={styles.text}>No units are Confirmed yet.</Text>
        ) : (
          doc["4_complete_approved_scene_register"].map((s) => (
            <View key={s.unit_id} style={{ marginBottom: 6 }}>
              <Text style={styles.label}>
                {s.scene_number}. {s.slugline}
                {s.critical_beat_tag ? `  [CRITICAL BEAT: ${s.critical_beat_tag}]` : ""} — causal tag: {s.causal_tag}
              </Text>
              <Text style={styles.text}>{s.paragraph}</Text>
            </View>
          ))
        )}

        <Text style={styles.h2}>5. Critical Beat Earmark Index</Text>
        {doc["5_critical_beat_earmark_index"].map((e) => (
          <Text key={e.tag} style={styles.li}>
            {e.tag} — Scene {e.scene_number ?? "missing"} — {e.slugline ?? "missing"}
          </Text>
        ))}

        <Text style={styles.h2}>6. Setup & Payoff Ledger</Text>
        <Text style={styles.text}>{doc["6_setup_payoff_ledger"]}</Text>

        <Text style={styles.h2}>7. Outstanding Decisions & Version History</Text>
        {outstandingSection.outstanding.length === 0 ? (
          <Text style={styles.text}>No outstanding items.</Text>
        ) : (
          outstandingSection.outstanding.map((u) => (
            <Text key={u.unit_id} style={styles.li}>
              {u.unit_id} - status: {u.status}
            </Text>
          ))
        )}
        <Text style={styles.h3}>Version History</Text>
        {outstandingSection.version_history.map((v) => (
          <Text key={v.version} style={styles.li}>
            {v.version} ({v.date}): {v.summary_of_changes}
          </Text>
        ))}
      </Page>
    </Document>
  );
}

export async function generateScreenplayArchitecturePdfBlob(doc: ScreenplayArchitectureDocument): Promise<Blob> {
  return pdf(<ScreenplayArchitecturePdfDocument doc={doc} />).toBlob();
}
