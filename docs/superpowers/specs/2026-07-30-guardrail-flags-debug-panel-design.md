# Questionnaire-Dump Guardrail Flags in Debug Panel — Design Spec

**GitHub issue:** #23 (final remaining acceptance criterion)
**Status:** Approved for planning
**Date:** 2026-07-30

## Problem

Issue #23 asks for a QA/debug panel surfacing `depth_mode` per element — already built (`CanonPanel.tsx`'s `debug` prop, gated behind `?debug=1`, lists every tracked element's `depth_mode` live). The one remaining acceptance criterion: "Panel surfaces the questionnaire-dump log flag (from the M1 guardrail issue) for the current session, to aid prompt-tuning review." Today, `turnGuardrails.ts`'s `evaluateTurn()` computes this flag every turn, but `logTurnHeuristics()` only `console.warn`s it and discards the result — nothing persists it or surfaces it in the app.

## Scope

**In scope:** the questionnaire-dump flag only (`TurnHeuristics.isQuestionnaireDump` / `questionCount`), matching the AC's exact wording.

**Explicitly out of scope:** `turnGuardrails.ts` also computes `narrationLeakMatches` and `promptLeakMatches` (internal-narration and system-prompt-leak detectors). Issue #23's AC does not ask for these, so this spec does not surface them — a future issue can extend the same mechanism if wanted.

**Persistence:** server-side, not just the live browser session (decided over the client-only-ephemeral alternative) — so a QA reviewer can reopen a canvas later and still see which turns were flagged, not only the turns from whatever browser tab was open when a dump happened. Also updates live during the current session without a page reload, satisfying "for the current session" without a separate fetch.

## Data model

New Firestore subcollection `stories/{storyId}/guardrail_flags`, mirroring the existing `outstanding_questions` subcollection already in `storyStore.ts` — same file, same conventions, same append/list shape:

```ts
export interface StoredGuardrailFlag {
  turnId: string;
  questionCount: number;
  ts: string; // ISO 8601
}
```

Only questionnaire-dump-flagged turns get a document — non-flagged turns write nothing (this subcollection is a flag log, not a full per-turn record).

## Write path

`web/src/app/api/chat/route.ts`, at the existing `logTurnHeuristics(delta.reply, turnId)` call site (currently the last line before assembling the response): change to capture the `TurnHeuristics` result (either have `logTurnHeuristics` return it, or call `evaluateTurn` directly and keep the existing console.warn logging as-is alongside it). When `isQuestionnaireDump` is true, call `appendGuardrailFlag(storyId, { turnId, questionCount })`.

This write is wrapped in its own try/catch, separate from the rest of the turn's error handling — a Firestore write failure here must never fail the chat turn itself or surface as a user-facing error, matching `turnGuardrails.ts`'s own documented principle ("These never block or alter the reply"). On failure, `console.error` and continue.

The route's JSON response gains one new field: `guardrailFlag: StoredGuardrailFlag | null` — the flag just written (with its real server-assigned `ts`) if this turn was flagged, `null` otherwise. The client appends this directly rather than constructing its own copy, avoiding any client/server timestamp mismatch.

## Read path

`web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (the existing resume `GET` handler): add `listGuardrailFlags(storyId)` alongside the existing `listElements`/`listMessages` calls, and include the result as `guardrailFlags` in the response. No new route — this reuses the endpoint the app already calls once on every canvas load.

## Client and rendering

`web/src/components/CanonPanel.tsx`: new exported type, mirroring the existing `PanelElement` pattern (a local, minimal client-facing shape rather than importing the server-side `StoredGuardrailFlag` type from `storyStore.ts` — this codebase's established convention, per `PanelElement` itself, which redefines a subset of `CanonElement`'s fields rather than importing it):

```ts
export type GuardrailFlag = { turnId: string; questionCount: number; ts: string };
```

New optional prop `guardrailFlags?: GuardrailFlag[]`. Rendered only when `debug` is true, as a small block above the existing per-stage list: a one-line count ("Questionnaire-dump flags this session: N") followed by a compact scrollable list of entries, each showing a shortened `turnId` (first 8 characters, enough to cross-reference against Cloud Logging/message records without taking excessive width), `questionCount`, and a short relative or HH:MM timestamp — styled consistently with the existing depth_mode debug badges (`text-[9px]`/`text-[11px]` scale already used in this file).

`web/src/components/ChatInterview.tsx`: imports `GuardrailFlag` from `@/components/CanonPanel` (exactly how it already imports `PanelElement` from the same file). New state, `const [guardrailFlags, setGuardrailFlags] = useState<GuardrailFlag[]>([])`. Seeded from the resume response's `data.guardrailFlags` (same `if (Array.isArray(...))` guard pattern already used for `data.elements`). On each `/api/chat` response, if `data.guardrailFlag` is non-null, append it to the array. Passed to `CanonPanel` as the new prop.

## Error handling

- Firestore write failure in the guardrail-flag persistence: caught, logged, turn proceeds normally (see Write path above).
- `listGuardrailFlags` failure on resume: not specially handled — it's a plain read alongside the other resume reads, and if the resume `GET` handler's existing top-level try/catch triggers, the whole resume fails exactly as it would for any other data-loading error today. No new failure mode introduced.
- Client: `guardrailFlags` defaults to `[]`, so the debug block simply shows "0" until either the resume response or a live turn populates it — no loading state needed beyond what already exists for the rest of resume.

## Testing

No automated test framework exists in this repo (established convention) — verification is `npm run lint && npm run build` plus a manual walkthrough: start (or resume) an interview with `?debug=1`, trigger a reply with more than 3 question marks (achievable by asking the model something that prompts a multi-question clarifying response, or by directly testing `evaluateTurn` logic reasoning against the `> 3` threshold), confirm the flag appears in the debug panel immediately (live, no reload), then reload the page and confirm the same flag is still shown (proving persistence, not just client-side state).
