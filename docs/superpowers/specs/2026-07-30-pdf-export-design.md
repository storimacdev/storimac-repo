# PDF Export of Story Foundation Document — Design Spec

**GitHub issue:** #21
**Status:** Approved for planning
**Date:** 2026-07-30

## Problem

Issue #21 asks for PDF export of the Stage 8 Story Foundation Document, alongside the existing Markdown/JSON export (issue #19). Today the export UI (both `ChatInterview.tsx`'s Stage 8 document card and `ProjectDashboard.tsx`'s export menu) has Markdown and JSON download buttons; PDF is either absent (`ChatInterview.tsx`) or present but disabled with a "Coming soon" label (`ProjectDashboard.tsx`, deliberately deferred to this issue when the dashboard was built).

## Constraints

- **The `FoundationDocument` JSON schema is a frozen contract.** It's already the intended input format for downstream projects (e.g. P2's Story Foundation ingestion, P4's Canon Ingestion Module). This work must not add fields to it, change its shape, or couple PDF-rendering concerns into `foundationDoc.ts`'s existing `compileFoundationDocument`/`renderMarkdown` functions. PDF rendering reads that JSON as a pure, read-only input.
- **No server-side load.** The production Cloud Run backend runs on 512Mi memory — this session already diagnosed and fixed one production incident rooted in resource/timeout pressure on that backend (`extractTurn.ts`'s `max_tokens`, 2026-07-30). PDF generation must not add server memory or CPU load, ruling out any headless-browser approach (Puppeteer) and ruling out generating/persisting the PDF server-side at all.
- **PDF must mirror the Markdown export's structure exactly** (§10.2 section numbers and headers, per the issue's AC) — same 13 sections, same order, same headers.

## Approach

Client-side PDF generation via `@react-pdf/renderer`, rendered entirely in the browser from the same `FoundationDocument` JSON already returned by the existing `document/{version}` endpoint (no new API surface). Because the PDF's content is a pure deterministic function of a version's immutable JSON, generating it on-demand at download time — rather than persisting it server-side at generation time — satisfies the AC's "PDF is regenerated whenever a new document version is generated" by construction: whichever version's JSON is currently loaded is what gets rendered, so there's never a stale PDF to go out of sync.

This was chosen over two alternatives: `pdfmake` (similar text-based, no-headless-browser approach, but a non-React declarative API that sits awkwardly in an all-React codebase, with looser TypeScript types) and `html2canvas` + `jsPDF` (reuses the already-rendered `<Markdown>` DOM directly with the least new code, but produces a non-selectable, non-searchable, image-based PDF with likely pagination artifacts across a 13-section document — doesn't meet "mirrors the structure... exactly").

## Components

New file: `web/src/lib/pdf/FoundationPdfDocument.tsx`

- A top-level `<FoundationPdfDocument doc={FoundationDocument} />` react-pdf `<Document>` component, composed of one internal section component per section of `FoundationDocument`, using react-pdf's own primitives (`Page`, `View`, `Text` — not HTML/DOM elements). Section headers are copied verbatim from `renderMarkdown()`'s header strings ("1. Story Metadata", "2. Story DNA", ... "13. Version History") so structural parity with the Markdown export is a direct textual match, not something that can silently drift as the two renderers evolve independently.
- `pdfValue(v: unknown): string` and `pdfList(items: unknown[]): string` — small helpers mirroring `foundationDoc.ts`'s existing `mdValue`/`mdList` null/undefined/array-fallback rules exactly (same "nothing to show" semantics), just emitting plain text instead of Markdown syntax (no `_—_` italics markup, no `- ` bullet prefixes — react-pdf text nodes render literal characters, not Markdown).
- Exported `generateFoundationPdfBlob(doc: FoundationDocument): Promise<Blob>` — wraps `pdf(<FoundationPdfDocument doc={doc} />).toBlob()` (react-pdf's client-safe rendering API). This is the only export other files call.
- `FoundationDocument` is imported via `import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc"` (type-only, erased at compile time, so it adds no server dependency to the client bundle) rather than mirrored as a local client-side type. This is a deliberate departure from this codebase's usual convention of locally mirroring small ad hoc server shapes (e.g. `PanelElement`/`CanonElement`, `GuardrailFlag`/`StoredGuardrailFlag`): `FoundationDocument` is a large (13-section), deeply-nested, explicitly-stable contract type per this spec's own constraints — mirroring it would mean maintaining two definitions of the same frozen contract in sync, which is worse than importing the type directly.

## Shared download helper

`ChatInterview.tsx` and `ProjectDashboard.tsx` currently each have their own local, duplicate `download(filename, content, type)` helper for the existing Markdown/JSON exports (a pre-existing minor duplication, previously flagged as low-priority). This work adds a third export type to both files, which is the point at which the duplication is worth removing rather than tripling: extract to `web/src/lib/download.ts`, exporting:

```ts
export function downloadText(filename: string, content: string, type: string): void;
export function downloadBlob(filename: string, blob: Blob): void;
```

Both existing files switch their Markdown/JSON download call sites to `downloadText` (same behavior, just relocated), and both gain a PDF button calling `generateFoundationPdfBlob` then `downloadBlob`.

## Data flow

- `ChatInterview.tsx`: the Stage 8 document card already holds `doc.json` in its `GeneratedDoc` state (currently typed `json: unknown`; this spec narrows it to `json: FoundationDocument` for type safety at the new call site — a small, justified refinement, not a schema change to the data itself). "Download .pdf" click handler: `await generateFoundationPdfBlob(doc.json)` → `downloadBlob(...)`.
- `ProjectDashboard.tsx`: the export menu already fetches a version's full content (`GET .../document/{version}`) for the Markdown/JSON buttons; the PDF button reuses that same already-fetched `data.json` the same way.
- Both surfaces already resolve to the *latest* version's JSON before this work (Chat: the just-generated `doc`; dashboard: `versions[versions.length - 1].version`), so the PDF naturally reflects whichever version is current — no new version-tracking logic needed.

## Error handling

PDF rendering, unlike the synchronous Markdown/JSON downloads, is async and can genuinely throw (e.g. an unexpectedly-shaped nested value reaching a react-pdf `<Text>` node that expects a string). The click handler wraps the `generateFoundationPdfBlob` call in try/catch and surfaces a failure via each file's existing `error` state — the same pattern both files already use for their other async actions (document generation, rename, delete, export-version fetch).

## Testing

No automated test framework exists in this repo (established convention) — verification is `npm run lint && npm run build` plus a manual walkthrough: generate a Story Foundation Document, download the PDF from both `ChatInterview.tsx`'s document card and the dashboard's export menu, open the resulting file, and confirm all 13 sections appear in the same order with the same headers as the `.md` export, and that no internal catalog code (`[A-E]\d{2}`) appears anywhere — the JSON is already `stripCatalogCodes`-scrubbed server-side before it ever reaches the client, so this walkthrough step confirms the PDF renderer doesn't need its own scrub, not that one needs to be added.
