# P3 World Bible Word/PDF Export — Design Spec

**Status:** Approved for planning
**Date:** 2026-09-13

## Problem

GitHub issue #52 (P3 Phase 5 — Stretch). The compiled World Bible (issue #50) currently exports to Markdown and JSON only. This issue adds `.docx` and `.pdf` export, matching the same 15-section structure, triggered from the same compile flow (no separate pipeline).

This is a low-ambiguity port, not a new design: Project 1 (`FoundationPdfDocument.tsx`, `@react-pdf/renderer`) and Project 2 (`characterBibleDocx.ts`, the `docx` npm package) already established both export patterns end to end, and ARCHITECTURE.md §4 already settled on reusing exactly these two libraries for Project 3 rather than introducing anything new. Both libraries are already real (non-dev) dependencies (`docx@^9.7.1`, `@react-pdf/renderer@^4.5.1`) — no new installs.

## Decisions

1. **One new file per format, mirroring the established precedent file-for-file**: `web/src/lib/docx/worldBibleDocx.ts` (mirrors `characterBibleDocx.ts`'s imperative `docx`-API structure) and `web/src/lib/pdf/WorldBiblePdfDocument.tsx` (mirrors `FoundationPdfDocument.tsx`'s declarative `@react-pdf/renderer` JSX structure). No shared abstraction between the two formats is introduced — the codebase's own established pattern is one bespoke renderer per format per project, not a generic multi-format engine.
2. **Both renderers consume the already-compiled `WorldBibleDocument` JSON directly** (`worldBibleDoc.json` in `WorldInterview.tsx`'s existing state, issue #50) — never re-fetching or re-compiling. This directly satisfies the AC's "triggered from the same compile flow as Markdown, not a separate pipeline": there is exactly one compile action, and all three export formats (Markdown, .docx, .pdf) render from its one output.
3. **Section order and content mirror `renderWorldBibleMarkdown` exactly**, per the already-established "the export formats can never disagree on content" principle (stated verbatim in `character-chat/bible/route.ts`'s own header comment for P2's exports). All 15 sections, in order, with the same field-to-content mapping `renderWorldBibleMarkdown` already uses as the single source of truth for "what does section N actually say."
4. **Empty-value normalization uses each format's own established convention, not Markdown's.** `docx` uses a local `docxValue(v): string` (→ `"—"` for empty, mirroring `characterBibleDocx.ts`'s own `docxValue`); PDF uses a local `pdfValue(v): string` (→ `"—"` for empty, mirroring `FoundationPdfDocument.tsx`'s own `pdfValue`). Neither reimplements `worldBibleCompiler.ts`'s `mdValue` (which additionally escapes Markdown ATX-heading-looking lines, a Markdown-specific concern issue #51 introduced — meaningless outside Markdown output, so not needed here).
5. **Both renderer functions return a `Blob` directly**, `Promise<Blob>`, matching both existing precedents' exact contract (`generateFoundationPdfBlob(doc): Promise<Blob>`, `generateCharacterBibleDocxBlob(entries): Promise<Blob>`) — `Packer.toBlob(doc)` for docx, `pdf(<Component/>).toBlob()` for PDF.
6. **UI wiring follows the exact lazy-import-on-click convention** already used identically by both `ChatInterview.tsx`'s `downloadPdf` and `CharacterInterview.tsx`'s `downloadBibleDocx`: a click handler that does `const { generateXBlob } = await import("@/lib/...")` (keeping both heavier libraries out of the initial client bundle), calls the generator, then `downloadBlob(filename, blob)` from the already-shared `web/src/lib/download.ts`. Two new buttons added to `WorldInterview.tsx`'s existing World Bible compile panel (issue #50/#51), alongside Download .md / Download .json / Mark as Confirmed / Recompile, each with its own `generating` boolean state (`docxGenerating`, `pdfGenerating`) matching the two existing precedents' naming.
7. **Filenames follow the World Bible's own already-established convention** (`world-bible-v{n}.md`/`.json`, issue #50) rather than P1's or P2's differing conventions: `world-bible-v{n}.docx`, `world-bible-v{n}.pdf`.

## Architecture

### New module `web/src/lib/docx/worldBibleDocx.ts`

```ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType } from "docx";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

function docxValue(v: string): string { return v && v.trim() ? v : "—"; }

export async function generateWorldBibleDocxBlob(doc: WorldBibleDocument): Promise<Blob> {
  // builds one Document with a TITLE paragraph ("World Bible — {working_title}")
  // followed by 15 sections in doc order, each a HeadingLevel.HEADING_1
  // ("N. Section Title") plus its content Paragraphs/Table, mirroring
  // renderWorldBibleMarkdown's exact section order/content mapping.
}
```

### New module `web/src/lib/pdf/WorldBiblePdfDocument.tsx`

```tsx
"use client";
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

const styles = StyleSheet.create({ /* page, title, h2, label, text, li, row, rowLabel, rowValue */ });

function pdfValue(v: string): string { return v && v.trim() ? v : "—"; }

export function WorldBiblePdfDocument({ doc }: { doc: WorldBibleDocument }) {
  // declarative JSX, one <Text style={styles.h2}> per numbered section
  // header + content, mirroring renderWorldBibleMarkdown's order exactly.
}

export async function generateWorldBiblePdfBlob(doc: WorldBibleDocument): Promise<Blob> {
  return pdf(<WorldBiblePdfDocument doc={doc} />).toBlob();
}
```

### `web/src/components/WorldInterview.tsx` (extended)

Two new state variables (`docxGenerating`, `pdfGenerating`), two new handlers (`downloadWorldBibleDocx`, `downloadWorldBiblePdf`) each following the exact lazy-import → generate → `downloadBlob` shape, two new buttons in the existing compile panel's button row.

## Error Handling

Matches both existing precedents exactly: a generation failure sets the panel's existing `compileError`-style inline text (or, if cleaner given issue #51 already added `confirmErrors`, a small dedicated message) rather than throwing — the same posture `downloadPdf`/`downloadBibleDocx` already use (`catch { setError("Couldn't generate the PDF."); }`).

## Testing

No automated test framework exists in this repo. Verification is `npm run lint && npm run build`, plus:
- Both generator functions called against a real compiled `WorldBibleDocument` (constructed or from an actual compile) produce a non-empty `Blob` with the correct MIME type, without throwing.
- A side-by-side content check: every section's text content that appears in `renderWorldBibleMarkdown`'s output for a given document also appears (in the same order) in both the `.docx` and `.pdf` renderers' output for the same document — confirms the "formats can never disagree on content" principle actually holds, not just that both compile without error.
- Empty-value fallback (`"—"`) traced for at least one empty section in both formats.
