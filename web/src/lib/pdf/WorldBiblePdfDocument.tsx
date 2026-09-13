"use client";

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

/**
 * Client-side PDF rendering of the compiled World Bible (issue #52).
 * Mirrors worldBibleCompiler.ts's renderWorldBibleMarkdown() structure and
 * headers exactly - same posture already established by
 * FoundationPdfDocument.tsx (issue #21) for Project 1's export.
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
    <Text style={styles.text}>
      <Text style={styles.label}>{label}: </Text>
      {pdfValue(value)}
    </Text>
  );
}

function TableRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{pdfValue(value)}</Text>
    </View>
  );
}

export function WorldBiblePdfDocument({ doc }: { doc: WorldBibleDocument }) {
  const m = doc["1_document_metadata"];
  const refLog = doc["14_cross_project_reference_log"];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>World Bible — {m.working_title}</Text>

        <Text style={styles.h2}>1. Document Metadata</Text>
        <TableRow label="Story ID" value={m.story_id} />
        <TableRow label="World Bible Version" value={m.world_bible_version} />
        <TableRow label="Working Title" value={m.working_title} />
        <TableRow label="Date" value={m.date} />
        <TableRow label="Status" value={m.status} />
        <TableRow label="Related Project 1 Version" value={m.related_project_1_version} />
        <TableRow label="Related Project 2 Status" value={m.related_project_2_status} />

        <Text style={styles.h2}>2. World Overview & Complexity Summary</Text>
        <Text style={styles.text}>{pdfValue(doc["2_world_overview_complexity_summary"])}</Text>

        <Text style={styles.h2}>3. High-Level World Assumptions & Canon Rules</Text>
        <Text style={styles.text}>{pdfValue(doc["3_world_assumptions_canon_rules"])}</Text>

        <Text style={styles.h2}>4. Master World Pillars</Text>
        {doc["4_master_world_pillars"].length === 0 ? (
          <Text style={styles.text}>No pillars adopted yet.</Text>
        ) : (
          doc["4_master_world_pillars"].map((p, i) => (
            <View key={i}>
              <Text style={styles.h3}>{p.pillar}</Text>
              <Text style={styles.text}>{pdfValue(p.summary)}</Text>
            </View>
          ))
        )}

        <Text style={styles.h2}>5. Geography & Settings Registry</Text>
        <Text style={styles.text}>{pdfValue(doc["5_geography_settings_registry"])}</Text>

        <Text style={styles.h2}>6. Societal Infrastructure Manual</Text>
        <Text style={styles.text}>{pdfValue(doc["6_societal_infrastructure_manual"])}</Text>

        <Text style={styles.h2}>7. Cultural & Lived Experience Profiles</Text>
        <Text style={styles.text}>{pdfValue(doc["7_cultural_lived_experience_profiles"])}</Text>

        <Text style={styles.h2}>8. Narrative Lore & History</Text>
        <Text style={styles.text}>{pdfValue(doc["8_narrative_lore_history"])}</Text>

        <Text style={styles.h2}>9. System Mechanics</Text>
        <Text style={styles.text}>{pdfValue(doc["9_system_mechanics"])}</Text>

        <Text style={styles.h2}>10. Significant Institutions & Artifacts</Text>
        <Text style={styles.text}>{pdfValue(doc["10_significant_institutions_artifacts"])}</Text>

        <Text style={styles.h2}>11. Linguistic & Communication Profile</Text>
        <Text style={styles.text}>{pdfValue(doc["11_linguistic_communication_profile"])}</Text>

        <Text style={styles.h2}>12. Interconnection Map & Systems Synthesis</Text>
        <Text style={styles.text}>{pdfValue(doc["12_interconnection_map_systems_synthesis"])}</Text>

        <Text style={styles.h2}>13. Outstanding World Questions</Text>
        {doc["13_outstanding_world_questions"].length === 0 ? (
          <Text style={styles.text}>None — everything resolved.</Text>
        ) : (
          doc["13_outstanding_world_questions"].map((g, i) => (
            <View key={i}>
              <Text style={styles.label}>{g.defer_to}:</Text>
              {g.items.map((q, j) => (
                <Text key={j} style={styles.li}>
                  • {pdfValue(q.item)}
                  {q.notes ? ` — ${pdfValue(q.notes)}` : ""}
                </Text>
              ))}
            </View>
          ))
        )}

        <Text style={styles.h2}>14. Cross-Project Reference Log</Text>
        <Field
          label="Project 1 (Story Foundation)"
          value={
            refLog.project_1 ? `${refLog.project_1.working_title} (${refLog.project_1.version})` : "Not yet available."
          }
        />
        <Text style={styles.label}>Project 2 (Character Bible):</Text>
        {refLog.project_2.length === 0 ? (
          <Text style={styles.text}>Not yet available.</Text>
        ) : (
          refLog.project_2.map((c, i) => (
            <Text key={i} style={styles.li}>
              • {pdfValue(c.character_name)} — {c.story_role} ({c.canon_status})
            </Text>
          ))
        )}

        <Text style={styles.h2}>15. Version History</Text>
        {doc["15_version_history"].map((v, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.rowLabel}>{v.version}</Text>
            <Text style={styles.rowValue}>
              {v.date} — {pdfValue(v.summary_of_changes)}
            </Text>
          </View>
        ))}
      </Page>
    </Document>
  );
}

export async function generateWorldBiblePdfBlob(doc: WorldBibleDocument): Promise<Blob> {
  return pdf(<WorldBiblePdfDocument doc={doc} />).toBlob();
}
