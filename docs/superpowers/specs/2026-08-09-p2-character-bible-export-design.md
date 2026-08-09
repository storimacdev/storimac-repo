# P2 Character Bible Export (Markdown + Word) — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-09

## Problem

GitHub issue #35 (P2 M4). Issue #34 compiles each signed-off character's profile into a `CharacterBibleEntry` (CDRM §7's fixed 8-part structure) and persists it, permanently, one per character, in a new `characterBibleEntries` Firestore collection. Nothing renders these entries to a human-readable format yet, and nothing exposes them over HTTP.

Acceptance criteria:
- Markdown export is available in-session by default after any character sign-off.
- `.docx` export is available on request.
- Both export formats reflect the same compiled content (master Character Bible, append-only — i.e. every signed-off character so far, not per-character files).

PRD §5.8 names "Markdown (default, in-session)" and "Word/.docx (on request, using the docx skill/toolchain)" but doesn't pin a specific docx library or tool — it's a forward-looking reference, not a dependency. The PRD's own Open Question 3 ("local file only, or integration with the user's existing docx pipeline?") is left for this issue to resolve.

## Decisions (confirmed during brainstorming, 2026-08-09)

1. **Export scope is the whole Character Bible, not per-character.** One Markdown/docx file containing every signed-off character's entry so far, in sign-off order — mirrors P1's single running Foundation Document, and matches the AC's "master Character Bible, append-only" framing.
2. **Docx generation is entirely client-side**, using the `docx` npm package (new dependency — none exists in `web/package.json` today), lazy-imported exactly like `web/src/lib/pdf/FoundationPdfDocument.tsx`'s `@react-pdf/renderer` usage. No server-side file-streaming precedent exists anywhere in this codebase's API routes (P1's PDF/Markdown/JSON exports are all client-generated Blobs via `web/src/lib/download.ts`), so this is the path of least resistance and stays consistent.
3. **Markdown rendering is also client-side**, as a plain pure function reused for both formats' input-shaping. This differs from P1 (`foundationDoc.ts` renders markdown server-side, as part of a versioned document snapshot written to Firestore) because P2's export isn't versioned/snapshotted — it's derived on demand from live `characterBibleEntries`, so there's no reason to round-trip through the server for the string transform.
4. **UI is a persistent panel**, not a one-off inline chat chip. Appears once ≥ 1 character has signed off and stays visible for the rest of the session, showing "Character Bible ({N} characters)" plus the two download buttons. Refetches after every sign-off so the count and content stay current. (Contrast with the earlier-this-session P1 UI work's inline post-generation chips — those suited a one-time terminal event; P2 characters sign off repeatedly and indefinitely, so a persistent panel fits better.)
5. **Both formats read from the same in-memory `bibleEntries` state**, fetched once per mount/refetch. This makes AC3 ("both formats reflect the same compiled content") hold trivially — there's no window where one format could see newer data than the other, since neither format triggers its own independent fetch.
6. **Entries are sorted by `signed_off_at` ascending** before rendering (both formats), guaranteeing "append-only, in sign-off order" regardless of Firestore's unspecified default document ordering.

## Architecture

### `web/src/lib/characterEngine/characterBibleMarkdown.ts` (new)

Pure function, no I/O, mirrors `foundationDoc.ts`'s `renderMarkdown` in style:

```ts
export function renderCharacterBibleMarkdown(entries: CharacterBibleEntry[]): string
```

Sorts entries by `signed_off_at` ascending. For each entry, renders:
- `## {metadata.character_name}` heading, followed by a short metadata line (story role, narrative importance, development depth, arc type, canon status).
- One `###` subheading per CDRM section (Story Function, Psychological Engine, Behavior & Voice Profile, Milestone Arc Timeline, Continuity & Canon Rules, Outstanding Questions), each rendered as a bullet list of `**field label**: value` lines. Every field always renders its bullet, even when the value is an empty string (blank after the colon) — the compiler (issue #34) is already a total function over missing data, and the renderer stays total too rather than conditionally hiding individual empty fields. Sections themselves are never omitted, since all six are always structurally present on every `CharacterBibleEntry`.
- `ensemble_interconnection_registry` renders as a small Markdown table (`With | Dynamic | Trust Trajectory | Power Dynamic`) since it's an array of structured records, not scalar fields — one row per relationship, and the section is omitted entirely if the array is empty.

### `web/src/lib/docx/characterBibleDocx.ts` (new)

```ts
export async function generateCharacterBibleDocxBlob(entries: CharacterBibleEntry[]): Promise<Blob>
```

Same sort and section structure as the Markdown renderer, built with the `docx` package's `Document`/`Paragraph`/`HeadingLevel`/`Table` APIs instead of Markdown syntax. Returns a `Blob` via `docx`'s `Packer.toBlob(...)`, matching `FoundationPdfDocument.tsx`'s `pdf(...).toBlob()` return shape so the calling UI code can reuse the exact same `downloadBlob(...)` call.

New dependency: `docx` (npm package) added to `web/package.json`.

### `web/src/app/api/character-chat/bible/route.ts` (new)

```
GET /api/character-chat/bible?storyId=<id>
```

Same auth pattern as `character-chat/route.ts`: `requireUser()`, load the story via `getStory(storyId)`, `getMembership(story.workspaceId, user.uid)` check, 404/403 on failure exactly as the existing route does. Calls `listCharacterBibleEntries(storyId)` and returns `{ entries: CharacterBibleEntry[] }` as plain `NextResponse.json(...)` — no markdown/docx built server-side, since both renderers now run client-side on the fetched entries.

### `web/src/components/CharacterInterview.tsx` (extended)

New state: `bibleEntries: CharacterBibleEntry[] | null`, `docxGenerating: boolean`.

- Fetch `GET .../bible` once on mount, and again whenever a `POST /api/character-chat` response returns `character_signed_off: true` (the existing per-turn response shape already carries this flag — see `route.ts`'s final `NextResponse.json({..., character_signed_off: ...})`).
- When `bibleEntries && bibleEntries.length > 0`, render a persistent panel (placed near the existing Story Canon strip) titled `Character Bible ({bibleEntries.length} characters)` with two buttons:
  - **Download .md** — synchronous, always enabled: `downloadText("character-bible.md", renderCharacterBibleMarkdown(bibleEntries), "text/markdown")`, using the existing `web/src/lib/download.ts` utility (already used by `ChatInterview.tsx`, no changes needed there).
  - **Generate .docx** — on click: set `docxGenerating = true`, lazy `import("@/lib/docx/characterBibleDocx")`, call `generateCharacterBibleDocxBlob(bibleEntries)`, then `downloadBlob("character-bible.docx", blob)`, reset `docxGenerating = false` in a `finally` block — mirrors `ChatInterview.tsx`'s `downloadPdf` function shape exactly (lazy import, disabled-while-generating button state, `pdfGenerating` → `docxGenerating`).

## Error Handling

- The `GET .../bible` fetch failing (network error, story not found) simply means the panel doesn't render — logged to console, no error banner shown to the author. This is an enhancement panel, not a blocking flow step.
- Docx generation throwing (malformed input, `docx` package internal error) resets `docxGenerating` to `false` in a `finally` block and sets the existing `error` state to a short message — matches `ChatInterview.tsx`'s existing `downloadPdf` error handling shape exactly (`setError(null)` before attempting, `setError("Couldn't generate the PDF.")` in the `catch`), so #35 reuses the same pattern rather than inventing a new one.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- `renderCharacterBibleMarkdown` and `generateCharacterBibleDocxBlob`, given the same fixture `CharacterBibleEntry[]` (2+ characters, one with an empty `ensemble_interconnection_registry`, one with populated relationships), produce structurally equivalent output — same character order (by `signed_off_at`), same sections present/absent, same field values — just in different syntax (Markdown headings/bullets/table vs. docx paragraphs/headings/table).
- A `CharacterBibleEntry` with every optional-looking field as an empty string (a character compiled before any Stage 1/3/5/6 facts were captured, per issue #34's "compiler is total over missing data" design) renders without throwing and without producing a section that's just an empty shell with no content — bullets for empty-string fields still render (the value's just blank), matching the compiler's own "total function" posture rather than trying to conditionally hide individual empty fields.
- The `GET .../bible` route's auth/404/403 behavior matches `character-chat/route.ts`'s existing pattern exactly (same status codes, same error message shapes) by reading both files side by side.
- The UI panel appears only when `bibleEntries.length > 0`, refetches (and the character count updates) after a turn response includes `character_signed_off: true`, and the `docxGenerating` disabled state prevents double-clicks during generation.
