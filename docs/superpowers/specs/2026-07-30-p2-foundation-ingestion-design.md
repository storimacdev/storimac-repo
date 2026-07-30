# P2 Story Foundation Ingestion — Design Spec

**GitHub issue:** #24 (narrowed scope — see Scope Changes below)
**Status:** Approved for planning
**Date:** 2026-07-30

## Problem

Project 2 (Character Development Consultant) needs to read Project 1's Story Foundation Document and turn it into structured, queryable data before any character interview can begin — a cast list to build the priority matrix from, and the Story Spine to later map character arcs onto. Issue #24 originally scoped this alongside two other input paths (CDRM ingestion, prose-fallback parsing for hand-authored Story Foundations) that don't fit how this app actually works — see Scope Changes.

## Scope Changes (decided during brainstorming, 2026-07-30)

1. **CDRM ingestion is dropped entirely, not built.** The actual CDRM reference doc is 56 lines, and the existing P2 system prompt draft (`project-docs/storimac-prompts/P2-Prompt2...md`) already bakes its rules in directly — the Priority Budget table, the psychological chain, the 6 stages, the 8-part Bible spec. This mirrors exactly how Project 1's system prompt encodes its own methodology rather than requiring the author to upload a rules document each session. No CDRM upload/ingestion step exists anywhere in this design.
2. **Prose-fallback parsing (a hand-authored Story Foundation as `.txt`/`.md`/`.docx`, for use without ever running Project 1) is deferred, not built.** This app has no generic "upload a document" flow anywhere today — Project 1 is fully conversational and produces its own JSON internally. Building a first-of-its-kind upload+parse pipeline for this edge case is out of scope until someone actually needs to bring an external Story Foundation. When no JSON version exists, the system flags this clearly and directs the user to complete Project 1 first, rather than attempting to parse a nonexistent upload.
3. **"Optional prior Character Bible for resume" is deferred to issue #36 (session persistence), not built here.** There's no P2-generated Character Bible to resume from until Project 2 has run at least once — this AC item is fundamentally about resuming a P2 session, which is #36's concern, not something #24 can meaningfully build or test in isolation.

With these three removed, #24 is exactly one thing: ingest the Story Foundation Document JSON and produce what Project 2 needs from it, flagging gaps honestly.

## Architecture

New file: `web/src/lib/characterEngine/ingestFoundation.ts` — a new directory (`characterEngine/`), parallel to the existing `canonEngine/`, for Project-2-specific code.

This deliberately does not attempt to generalize `canonEngine/`'s P1-specific modules (`CanonElement`, `PROJECT1_STAGES`, etc.) into the shared, config-driven library `ARCHITECTURE.md` §2 describes as the eventual end-state. That's a larger, separate refactor this issue doesn't ask for and shouldn't take on unprompted. `ingestFoundation.ts` is new code that reads P1's existing, unmodified `FoundationDocument` type and `getDocumentVersion`/`listDocumentVersions` functions (`web/src/lib/canonEngine/foundationDoc.ts`) — nothing in that file changes.

## Data model

```ts
export interface CastMember {
  name: string;
  story_role: string;
  description: string;
}

export interface IngestedFoundation {
  storyId: string;
  version: number;
  workingTitle: string;
  cast: CastMember[];
  storySpine: FoundationDocument["11_story_spine"];
}

export type IngestFoundationResult =
  | { status: "ok"; foundation: IngestedFoundation }
  | { status: "missing" }
  | { status: "incomplete"; reason: string; foundation: IngestedFoundation };
```

`storySpine` is carried through unchanged (not reshaped) since later P2 work (#28's Want/Need/Wound chain, #31's relationship/arc mapping) needs the full spine, not a summary of it.

## Function behavior

`ingestFoundation(storyId: string): Promise<IngestFoundationResult>`:

1. Calls `listDocumentVersions(storyId)`. If empty, return `{ status: "missing" }` — no Foundation Document has ever been generated for this Story (Stage 8 was never reached in Project 1).
2. Fetches the highest-numbered version via `getDocumentVersion`.
3. Reads `doc.json["9_principal_characters"]` (typed `unknown[]` in `FoundationDocument` — entries are whatever shape Project 1's model produced, not strictly schema-validated) and defensively extracts each entry into a `CastMember`: `name` is required (an entry with no usable string name is not silently dropped — it's excluded from `cast` and its absence is reflected in the `incomplete` reason if the result ends up empty); `story_role`/`description` default to empty strings if missing or non-string, matching the defensive-coercion pattern already established in `foundationDoc.ts`'s own `str()`/`formatEntry()` helpers.
4. If the resulting `cast` array is empty (whether because the section was empty, malformed, or every entry lacked a name), return `{ status: "incomplete", reason: "...", foundation: {...} }` — the caller decides how to surface this (e.g. block session start, or prompt the author to name a cast in Project 1 first). The `reason` string is human-readable, not an error code.
5. Otherwise return `{ status: "ok", foundation: {...} }`.

## Error handling

- No Firestore/network error handling beyond what `listDocumentVersions`/`getDocumentVersion` already provide (both existing, unmodified functions that throw on genuine failures — this function doesn't add a new try/catch layer, callers handle failures the same way they already handle other store-layer calls).
- The three-state result type (`ok`/`missing`/`incomplete`) is the actual gap-flagging mechanism the issue's AC calls for — a caller can never mistake "no data" for "some data," since both `missing` and `incomplete` are distinct, named states rather than an empty/null `ok` result.

## Testing

No automated test framework exists in this repo (established convention). No UI route consumes this function yet (that's issue #27's job) — verification is `npm run lint && npm run build` plus a small manual/scripted check: run the function against a real Story in Firestore that has a generated Foundation Document (confirm `ok` with a correctly-extracted cast), against a Story that has never reached Stage 8 (confirm `missing`), and — if reasonably constructible — a Story whose Foundation Document has an empty or malformed cast section (confirm `incomplete` with a sensible `reason`).
