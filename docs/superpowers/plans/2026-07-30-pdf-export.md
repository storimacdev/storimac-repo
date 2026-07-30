# PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF export of the Story Foundation Document (GitHub issue #21) alongside the existing Markdown/JSON export, generated entirely client-side.

**Architecture:** A new `@react-pdf/renderer`-based component renders the existing, unmodified `FoundationDocument` JSON into a PDF Blob in the browser — no server changes, no new API route. Both places that currently export Markdown/JSON (`ChatInterview.tsx`'s Stage 8 card, `ProjectDashboard.tsx`'s export menu) gain a working PDF button, replacing their duplicate local `download()` helpers with a shared utility.

**Tech Stack:** Next.js App Router (client components), TypeScript, `@react-pdf/renderer` v4.5.1 (confirmed React 19-compatible via its `peerDependencies`). No test framework exists in this repo (`web/package.json` has no test runner) — verification is `npm run lint && npm run build` per task plus a manual walkthrough in the final task.

## Global Constraints

- `FoundationDocument` (defined in `web/src/lib/canonEngine/foundationDoc.ts`) is a frozen, read-only contract consumed by downstream projects — this plan only reads it via `import type`, never modifies its shape or the functions that produce it (`compileFoundationDocument`, `renderMarkdown`).
- No server-side PDF generation, no new API route, no new Firestore fields — generation happens entirely in the browser, on demand, from JSON the client already has.
- PDF section headers and order must match `renderMarkdown()`'s exactly: "1. Story Metadata" through "13. Version History", copied verbatim, not re-derived.
- No test framework exists — do not add one. Verify with `cd web && npm run lint && npm run build` after every task, and with the manual walkthrough in the final task.

---

### Task 1: PDF renderer and shared download helper

**Files:**
- Create: `web/src/lib/download.ts`
- Create: `web/src/lib/pdf/FoundationPdfDocument.tsx`

**Interfaces:**
- Consumes: `FoundationDocument` type (`web/src/lib/canonEngine/foundationDoc.ts` — the full interface: `schema_version: string`, `"1_story_metadata": {id, version, working_title, author, date, status, medium, target_length}` (all `string`), `"2_story_dna": {core_story_promise, story_identity}` (`string`) `+ {narrative_priorities, always_emphasize, never_become, comparable_works}` (`unknown[]`), `"3_story_format": {primary_format: FormatEntry, supporting_formats: FormatEntry[]}` where `FormatEntry = {name: string, reason: string}`, `"4_premise": string`, `"5_logline": string`, `"6_genre_tone": {genre, subgenre, tone, style, audience, scale}` (all `string`), `"7_thematic_blueprint": {external_theme, internal_theme, core_dramatic_question, theme_statement, narrative_purpose}` (all `string`), `"8_dramatic_engine": {protagonist, antagonistic_force, central_conflict, primary_stakes, transformation_arc, emotional_journey}` (all `string`), `"9_principal_characters": unknown[]`, `"10_world_foundation": {time_period: string, primary_settings: unknown[], nature_of_world: string, premise_assumptions: unknown[], environmental_rules: unknown[]}`, `"11_story_spine": {opening_image, inciting_incident, first_turning_point, midpoint, second_turning_point, climax, closing_image}` (all `string`), `"12_outstanding_questions": {item: string, defer_to: string | null, notes: string}[]`, `"13_version_history": {version: string, date: string, summary_of_changes: string}[]`).
- Produces: `downloadText(filename: string, content: string, type: string): void` and `downloadBlob(filename: string, blob: Blob): void` from `web/src/lib/download.ts`. `generateFoundationPdfBlob(doc: FoundationDocument): Promise<Blob>` from `web/src/lib/pdf/FoundationPdfDocument.tsx` — the only function Tasks 2 and 3 call from this file.

- [ ] **Step 1: Install `@react-pdf/renderer`**

Run: `cd web && npm install @react-pdf/renderer`

- [ ] **Step 2: Create the shared download helper**

`web/src/lib/download.ts`:

```ts
export function downloadText(filename: string, content: string, type: string): void {
  downloadBlob(filename, new Blob([content], { type }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Create the PDF renderer**

`web/src/lib/pdf/FoundationPdfDocument.tsx`:

```tsx
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
```

- [ ] **Step 4: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (proves the new files compile and `@react-pdf/renderer`'s types resolve correctly; nothing calls `generateFoundationPdfBlob` yet, so this only verifies the module itself, not end-to-end behavior — Tasks 2/3 cover that).

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/download.ts web/src/lib/pdf/FoundationPdfDocument.tsx
git commit -m "Add client-side PDF renderer for the Story Foundation Document (#21)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire PDF export into `ChatInterview.tsx`

**Files:**
- Modify: `web/src/components/ChatInterview.tsx`

**Interfaces:**
- Consumes: `downloadText`, `downloadBlob` (Task 1, `@/lib/download`); `generateFoundationPdfBlob` (Task 1, `@/lib/pdf/FoundationPdfDocument`); `FoundationDocument` type (`@/lib/canonEngine/foundationDoc`).
- Produces: no new exports — this task only changes this file's internal behavior.

- [ ] **Step 1: Update imports**

Add these three imports near the top of the file (after the existing `import { useUser } from "@/components/UserProvider";` line):

```ts
import { downloadText, downloadBlob } from "@/lib/download";
import { generateFoundationPdfBlob } from "@/lib/pdf/FoundationPdfDocument";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";
```

- [ ] **Step 2: Narrow `GeneratedDoc`'s `json` field**

Change the existing `GeneratedDoc` type (currently `json: unknown;`) to:

```ts
type GeneratedDoc = {
  version: number;
  date: string;
  summary_of_changes: string;
  markdown: string;
  json: FoundationDocument;
};
```

- [ ] **Step 3: Remove the local `download` helper**

Delete the existing local function (currently):

```ts
  function download(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
```

Delete it entirely — `downloadText`/`downloadBlob` from Task 1 replace it.

- [ ] **Step 4: Add PDF-generation state and handler**

Add a new state declaration alongside the existing `generating` state (`const [generating, setGenerating] = useState(false);`):

```ts
  const [pdfGenerating, setPdfGenerating] = useState(false);
```

Add this new function near the existing `generateDocument` function:

```ts
  async function downloadPdf() {
    if (!doc || pdfGenerating) return;
    setPdfGenerating(true);
    setError(null);
    try {
      const blob = await generateFoundationPdfBlob(doc.json);
      downloadBlob(`story-foundation-v${doc.version}.pdf`, blob);
    } catch {
      setError("Couldn't generate the PDF.");
    } finally {
      setPdfGenerating(false);
    }
  }
```

- [ ] **Step 5: Update the two existing download buttons and add the PDF button**

Change the existing "Download .md" button's `onClick` from `() => download(...)` to `() => downloadText(...)`:

```tsx
                          <button
                            onClick={() => downloadText(`story-foundation-v${doc.version}.md`, doc.markdown, "text/markdown")}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                          >
                            Download .md
                          </button>
```

Same for "Download .json":

```tsx
                          <button
                            onClick={() => downloadText(`story-foundation-v${doc.version}.json`, JSON.stringify(doc.json, null, 2), "application/json")}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400"
                          >
                            Download .json
                          </button>
```

Add a new "Download .pdf" button immediately after the "Download .json" button and before the "Regenerate" button:

```tsx
                          <button
                            onClick={downloadPdf}
                            disabled={pdfGenerating}
                            className="rounded-lg bg-gradient-to-r from-red-600 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-500 hover:to-orange-400 disabled:opacity-40"
                          >
                            {pdfGenerating ? "Generating…" : "Download .pdf"}
                          </button>
```

- [ ] **Step 6: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/ChatInterview.tsx
git commit -m "Add PDF download to the Stage 8 document card (#21)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire PDF export into `ProjectDashboard.tsx`

**Files:**
- Modify: `web/src/components/ProjectDashboard.tsx`

**Interfaces:**
- Consumes: `downloadText`, `downloadBlob` (Task 1, `@/lib/download`); `generateFoundationPdfBlob` (Task 1, `@/lib/pdf/FoundationPdfDocument`); `FoundationDocument` type (`@/lib/canonEngine/foundationDoc`).
- Produces: `exportVersion`'s `format` parameter widens from `"md" | "json"` to `"md" | "json" | "pdf"` — no other file calls this function, so this is a purely internal signature change.

- [ ] **Step 1: Update imports**

Add these to the existing import block (after `import { useUser } from "@/components/UserProvider";`):

```ts
import { downloadText, downloadBlob } from "@/lib/download";
import { generateFoundationPdfBlob } from "@/lib/pdf/FoundationPdfDocument";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";
```

- [ ] **Step 2: Remove the local `download` helper**

Delete the existing local function (currently near the top of the file, before `export default function ProjectDashboard()`):

```ts
function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

Delete it entirely.

- [ ] **Step 3: Widen `exportVersion` to handle PDF**

Replace the existing `exportVersion` function:

```ts
  async function exportVersion(p: Project, format: "md" | "json") {
    const versions = exportVersions[p.id];
    if (!versions || versions === "loading" || versions === "error" || versions.length === 0) return;
    const latest = versions[versions.length - 1].version;
    setRowError(null);
    try {
      const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}/document/${latest}`);
      const data = await res.json();
      if (!res.ok) {
        setRowError(data.error ?? "Export failed.");
        return;
      }
      if (format === "md") {
        download(`${p.title}-v${latest}.md`, data.markdown, "text/markdown");
      } else {
        download(`${p.title}-v${latest}.json`, JSON.stringify(data.json, null, 2), "application/json");
      }
    } catch {
      setRowError("Couldn't reach the server.");
    }
  }
```

with:

```ts
  async function exportVersion(p: Project, format: "md" | "json" | "pdf") {
    const versions = exportVersions[p.id];
    if (!versions || versions === "loading" || versions === "error" || versions.length === 0) return;
    const latest = versions[versions.length - 1].version;
    setRowError(null);
    try {
      const res = await fetch(`/api/workspaces/${p.workspaceId}/canvases/${p.id}/document/${latest}`);
      const data = await res.json();
      if (!res.ok) {
        setRowError(data.error ?? "Export failed.");
        return;
      }
      if (format === "md") {
        downloadText(`${p.title}-v${latest}.md`, data.markdown, "text/markdown");
      } else if (format === "json") {
        downloadText(`${p.title}-v${latest}.json`, JSON.stringify(data.json, null, 2), "application/json");
      } else {
        const blob = await generateFoundationPdfBlob(data.json as FoundationDocument);
        downloadBlob(`${p.title}-v${latest}.pdf`, blob);
      }
    } catch {
      setRowError("Export failed.");
    }
  }
```

(The catch-all error message changes from "Couldn't reach the server." to "Export failed." — the original wording was only accurate when every branch was a synchronous, unthrowable `Blob`-from-string construction; the new PDF branch can genuinely throw for reasons unrelated to network reachability, so the message is now format-agnostic, matching the `!res.ok` branch's existing wording just above it.)

- [ ] **Step 4: Enable the PDF export button**

Replace the existing disabled placeholder button:

```tsx
                              <button
                                disabled
                                title="Coming soon"
                                className="block w-full cursor-not-allowed border-t border-neutral-800 px-3 py-2 text-left text-xs text-neutral-600"
                              >
                                PDF (Coming soon)
                              </button>
```

with a working button matching its "Markdown (.md)"/"JSON (.json)" siblings exactly:

```tsx
                              <button
                                onClick={() => exportVersion(p, "pdf")}
                                disabled={!hasDoc}
                                className="block w-full px-3 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                PDF (.pdf)
                              </button>
```

- [ ] **Step 5: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ProjectDashboard.tsx
git commit -m "Enable PDF export in the dashboard's export menu (#21)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Manual end-to-end verification

**Files:** none (verification only; fix-ups amend the relevant file(s) plus a follow-up commit)

- [ ] **Step 1: Start the dev server**

Run in `web/`: `npm run dev`.

- [ ] **Step 2: Verify PDF export from the interview screen**

- Progress an interview to Stage 8 and generate a document.
- Click "Download .pdf". Confirm a `.pdf` file downloads (not a browser error, not an empty/corrupt file).
- Open it. Confirm all 13 numbered sections appear, in the same order and with the same headers as the `.md` export of the same version.
- Confirm no internal catalog code (a letter-plus-two-digits pattern like "A05") appears anywhere in the PDF, particularly in the Story Format section.

- [ ] **Step 3: Verify PDF export from the dashboard**

- Visit `/dashboard`, open a Project that has a generated document, open its Export menu, click "PDF (.pdf)". Confirm the download succeeds and the content matches Step 2's expectations.
- Open a Project with no generated document yet. Confirm the PDF button is disabled (matching its Markdown/JSON siblings), not clickable.

- [ ] **Step 4: Verify error handling**

- With the dev server running, temporarily disconnect network access (or stop the server) and click a PDF export button. Confirm an error message appears (via the existing error banner in each surface) rather than a silent failure or an unhandled exception in the console.

- [ ] **Step 5: Fix anything that fails, re-run lint + build, commit fixes**

```bash
cd web && npm run lint && npm run build
git add -A
git commit -m "PDF export verification fixes (#21)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Skip this commit if nothing needed fixing.)
