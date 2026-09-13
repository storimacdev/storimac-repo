# P3 World/PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #52 — add `.docx` and `.pdf` export for the compiled World Bible, matching the existing Markdown export's 15-section structure exactly, triggered from the same compile flow.

**Architecture:** Two new client-side renderer modules mirror the two already-established codebase precedents file-for-file: `worldBibleDocx.ts` (imperative `docx` package API, mirroring `characterBibleDocx.ts`) and `WorldBiblePdfDocument.tsx` (declarative `@react-pdf/renderer` JSX, mirroring `FoundationPdfDocument.tsx`). Both consume the already-compiled `WorldBibleDocument` JSON directly — no new compile pipeline. Two new buttons wire into the existing World Bible compile panel in `WorldInterview.tsx`, using the same lazy-import-on-click convention already used identically by both existing precedents.

**Tech Stack:** `docx` (already a dependency, `^9.7.1`), `@react-pdf/renderer` (already a dependency, `^4.5.1`) — no new installs.

## Global Constraints

- Full design spec: `docs/superpowers/specs/2026-09-13-p3-word-pdf-export-design.md` — consult it for the reasoning behind every decision below.
- Both new renderers must mirror `renderWorldBibleMarkdown`'s (`web/src/lib/worldEngine/worldBibleCompiler.ts`, issue #50) exact 15-section order and content mapping — the "export formats can never disagree on content" principle already established for Project 2's exports (Decision 3).
- Both renderer functions return `Promise<Blob>` (`Packer.toBlob(doc)` for docx, `pdf(<Component/>).toBlob()` for PDF) — matching both existing precedents' exact contract (Decision 5).
- Empty-value fallback is `"—"` in both new renderers (each with its own small local `docxValue`/`pdfValue` helper) — NOT `worldBibleCompiler.ts`'s `mdValue`, which additionally does Markdown-heading-escaping that's meaningless outside Markdown output (Decision 4).
- UI wiring uses the lazy-import-on-click convention (`const { generateXBlob } = await import("@/lib/...")`) already used identically by `ChatInterview.tsx`'s `downloadPdf` and `CharacterInterview.tsx`'s `downloadBibleDocx` — never a static top-level import of either library (Decision 6).
- Filenames: `world-bible-v{n}.docx`, `world-bible-v{n}.pdf` — matching the World Bible's own already-established `world-bible-v{n}.md`/`.json` convention from issue #50 (Decision 7).
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, regardless of which underlying model implements the task — a fixed session-wide convention, not self-attribution.
- No automated test framework exists in this repo — verification is `npm run lint && npm run build` from `web/`, plus `tsx` trace scripts against real committed code.

---

### Task 1: `.docx` export module

**Files:**
- Create: `web/src/lib/docx/worldBibleDocx.ts`

**Interfaces:**
- Consumes: `WorldBibleDocument` type (`@/lib/canonEngine/storyStore`), `Document`/`Packer`/`Paragraph`/`TextRun`/`HeadingLevel`/`Table`/`TableRow`/`TableCell`/`WidthType` from `"docx"`.
- Produces: `generateWorldBibleDocxBlob(doc: WorldBibleDocument): Promise<Blob>`. Task 3's UI calls this.

- [ ] **Step 1: Create the file**

Create `web/src/lib/docx/worldBibleDocx.ts`:

```ts
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
```

- [ ] **Step 2: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace with a `tsx` script:
1. Construct a complete, realistic `WorldBibleDocument` (all 15 sections populated, at least 2 pillars, at least one outstanding-question group, both `14_cross_project_reference_log` sub-fields present, at least one version-history row) and call `generateWorldBibleDocxBlob(doc)`. Confirm it resolves to a `Blob` with `type` matching a `.docx` MIME type (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`) and a non-zero `size`, without throwing.
2. Construct a minimal/empty `WorldBibleDocument` (empty pillars array, empty outstanding-questions array, `project_1: null`, empty `project_2` array, empty version history) and confirm `generateWorldBibleDocxBlob` still resolves without throwing (the empty-array branches in `pillarsSection`/`outstandingQuestionsSection`/`referenceLogSection` must all be exercised, not just the non-empty ones).
3. Content parity check: for the realistic document from scenario 1, also call `renderWorldBibleMarkdown` (from `worldEngine/worldBibleCompiler.ts`, issue #50) on the same document. Confirm every section's actual text content that appears in the Markdown output (e.g. the working title, each pillar's name/summary, each outstanding question's item text, each version's summary) also appears somewhere in the strings passed into `docx`'s `Paragraph`/`TextRun`/`TableCell` calls for the same document — i.e., the docx renderer isn't silently dropping or mismapping any section's content relative to the Markdown renderer. Do this by reading through your own constructed calls rather than trying to extract text back out of the compiled `.docx` binary (that's excessive for this repo's established verification conventions — a `tsx` trace of the source is sufficient, matching how `characterBibleDocx.ts`/`FoundationPdfDocument.tsx` were themselves verified when first built).

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/docx/worldBibleDocx.ts
git commit -m "feat: add .docx export for the compiled World Bible (issue #52)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 2: `.pdf` export module

**Files:**
- Create: `web/src/lib/pdf/WorldBiblePdfDocument.tsx`

**Interfaces:**
- Consumes: `WorldBibleDocument` type (`@/lib/canonEngine/storyStore`), `Document`/`Page`/`Text`/`View`/`StyleSheet`/`pdf` from `"@react-pdf/renderer"`.
- Produces: `WorldBiblePdfDocument` (the JSX component), `generateWorldBiblePdfBlob(doc: WorldBibleDocument): Promise<Blob>`. Task 3's UI calls the latter.

- [ ] **Step 1: Create the file**

Create `web/src/lib/pdf/WorldBiblePdfDocument.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace with a `tsx` script (this file has a JSX/`.tsx` extension and imports a React-based renderer — running it standalone via `tsx` works the same way it does for `FoundationPdfDocument.tsx`'s own established verification pattern, since `@react-pdf/renderer`'s `pdf()`/`.toBlob()` runs synchronously in Node without a real DOM):
1. Construct the same realistic `WorldBibleDocument` used in Task 1's Step 2, scenario 1, and call `generateWorldBiblePdfBlob(doc)`. Confirm it resolves to a `Blob` with `type` `"application/pdf"` and non-zero `size`, without throwing.
2. Construct the same minimal/empty `WorldBibleDocument` used in Task 1's Step 2, scenario 2, and confirm `generateWorldBiblePdfBlob` still resolves without throwing (exercising all the empty-array conditional branches in the JSX).
3. Content parity check, same method as Task 1's Step 2 scenario 3: confirm every section's content passed into `Text`/`Field`/`TableRow` calls for the realistic document matches what `renderWorldBibleMarkdown` produces for the same document — no section silently dropped or mismapped.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/pdf/WorldBiblePdfDocument.tsx
git commit -m "feat: add PDF export for the compiled World Bible (issue #52)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 3: UI wiring in `WorldInterview.tsx`

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `generateWorldBibleDocxBlob` (Task 1), `generateWorldBiblePdfBlob` (Task 2), the existing `worldBibleDoc` state and `downloadBlob` (already imported, `@/lib/download`, from issues #50/#51).

The current World Bible compile panel (`data-testid="world-bible-compile-card"`) shows, once `worldBibleDoc` exists: a version/confirmed-status summary, then a button row with Download .md / Download .json / Mark as Confirmed / Recompile (issues #50, #51). This task adds two more buttons to that same row, following the exact `downloadPdf`/`downloadBibleDocx` lazy-import pattern already used identically in `ChatInterview.tsx`/`CharacterInterview.tsx`.

- [ ] **Step 1: Add state**

Find the existing World Bible state block (`worldBibleDoc`, `worldBibleVersions`, `compiling`, `compileError`, `confirming`, `confirmErrors`). Add two more state variables:

```ts
  const [docxGenerating, setDocxGenerating] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
```

- [ ] **Step 2: Add the two download handlers**

Add near the existing `confirmWorldBible` function:

```ts
  async function downloadWorldBibleDocx() {
    if (!worldBibleDoc || docxGenerating) return;
    setDocxGenerating(true);
    try {
      const { generateWorldBibleDocxBlob } = await import("@/lib/docx/worldBibleDocx");
      const blob = await generateWorldBibleDocxBlob(worldBibleDoc.json as WorldBibleDocument);
      downloadBlob(`world-bible-v${worldBibleDoc.version}.docx`, blob);
    } catch {
      setCompileError("Couldn't generate the .docx file.");
    } finally {
      setDocxGenerating(false);
    }
  }

  async function downloadWorldBiblePdf() {
    if (!worldBibleDoc || pdfGenerating) return;
    setPdfGenerating(true);
    try {
      const { generateWorldBiblePdfBlob } = await import("@/lib/pdf/WorldBiblePdfDocument");
      const blob = await generateWorldBiblePdfBlob(worldBibleDoc.json as WorldBibleDocument);
      downloadBlob(`world-bible-v${worldBibleDoc.version}.pdf`, blob);
    } catch {
      setCompileError("Couldn't generate the PDF.");
    } finally {
      setPdfGenerating(false);
    }
  }
```

(Reusing the existing `compileError` state for these two failure messages, rather than adding two more dedicated error-state variables, matches this panel's existing convention of one shared inline error slot for compile-adjacent failures — `confirmErrors` is kept separate only because it needs to render a list of specific lint messages, which these two simpler failures don't.)

- [ ] **Step 3: Add the `WorldBibleDocument` type import**

Add to the file's existing imports:

```ts
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";
```

(If a `type { ... }` import from `@/lib/canonEngine/storyStore` already exists elsewhere in this file — e.g. `P3Stage4Audit` from issue #49 — merge `WorldBibleDocument` into that same import statement rather than adding a second one. Read the actual current imports first.)

- [ ] **Step 4: Render the two buttons**

Find the existing button row (`<div className="flex flex-wrap gap-2">` containing Download .md / Download .json / Mark as Confirmed / Recompile — issues #50/#51). Add two more buttons immediately after "Download .json" and before "Mark as Confirmed":

```tsx
                          <button
                            onClick={downloadWorldBibleDocx}
                            disabled={docxGenerating}
                            className="rounded-lg border border-emerald-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {docxGenerating ? "Generating…" : "Download .docx"}
                          </button>
                          <button
                            onClick={downloadWorldBiblePdf}
                            disabled={pdfGenerating}
                            className="rounded-lg border border-emerald-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {pdfGenerating ? "Generating…" : "Download .pdf"}
                          </button>
```

Read the actual current JSX carefully before editing (it may have shifted slightly since this plan was written) and ensure every tag stays balanced — the same care issue #51's Task 4 already had to take editing inside this same large component.

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

For browser verification, follow the same network-mock/direct-logic-trace approach every prior UI task in this file used (no Firestore emulator/test credentials in this sandbox, no test runner). At minimum, trace by reading the code: confirm both new handlers guard against `!worldBibleDoc` and re-entry while generating (matching `confirmWorldBible`'s established guard shape), confirm both call `downloadBlob` with the exact `world-bible-v{n}.docx`/`.pdf` filenames, and confirm the lazy `import()` paths (`@/lib/docx/worldBibleDocx`, `@/lib/pdf/WorldBiblePdfDocument`) match Task 1/2's actual file locations exactly. If a way to actually invoke the handlers against a real or mocked `worldBibleDoc` state is practical in this sandbox (e.g. a react-dom/server-based trace, matching issue #51's Task 4 approach), use it and show concrete output; otherwise disclose clearly what wasn't verified end-to-end.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: add .docx/.pdf download buttons for the compiled World Bible (issue #52)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
