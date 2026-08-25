# P3 Stage 1 — Understand/Ingest Bootstrap — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-25

## Problem

GitHub issue #38 (P3 Phase 1). Acceptance criteria: the Story Foundation Document (Project 1) is ingested as immutable reference input; the system parses genre, tone, premise, and setting scope from it; the output is a short structural assessment, a proposed World Complexity Level, and 1-2 opening discovery questions.

Nothing exists yet for Project 3 — no system prompt file, no route, no page, no `worldEngine/` lib directory. Unlike Project 2 (whose earliest ingestion issue, #24, already had a chat loop to plug into from an even earlier bootstrap), #38 is Project 3's full bootstrap: this issue stands up the first working "Understand" conversation end-to-end, not just a parsing module.

Per `ARCHITECTURE.md` §2/§7 and issue #41's architecture note, Project 3 reuses the shared Canon Engine rather than building parallel machinery — `canonStore.ts`'s generic `CanonElement`/`applyStateDelta`/`listElements` and `storyStore.ts`'s generic `appendMessage`/`listMessages`/`getStory` are proven twice already (Projects 1 and 2) and carry over with zero new plumbing, only new collection names and project-specific schemas.

## Decisions (confirmed during brainstorming, 2026-08-25)

1. **Build the full 5-stage skeleton now, not just Stage 1.** The turn schema carries `current_stage` (1-5) and a `WORLD_STAGE_NAMES` array for all five stages from this issue onward, even though only Stage 1 has real behavior behind it. Every later Phase 1/2/3/4 issue extends this same schema and stage list rather than introducing it fresh, mirroring how Project 2's schema grew incrementally across issues #26/#28/#30/#31/#32 without ever re-deriving its own shape.
2. **No app-level stage clamping/enforcement in this issue.** The model self-reports `current_stage`, unclamped. Project 1's own precedent is the model here: M1 (#2-5) shipped a working, unenforced loop first; stage-gating (#7) arrived as a dedicated, later M2 issue once the loop existed to gate. Project 3's Phase 1 has no equivalently-named "stage FSM" issue yet — if gating turns out to need dedicated work once Stage 2 (#40) exists, that becomes a new filed issue at that point, not something #38 pre-builds speculatively.
3. **World Complexity Level (WCL) stays prose-only inside `reply` for this issue.** Issue #39 is explicitly "Implement World Complexity Level (WCL) model" as structured, author-editable state — #38 doesn't pre-empt that by inventing a structured WCL field now that #39 would then have to migrate.
4. **Ingestion grabs Story Spine and Dramatic Engine now, even though only genre/tone/premise/world-foundation are used by Stage 1's own output.** Mirrors Project 2's `ingestFoundation.ts` (issue #24), which grabbed `storySpine`/`dramaticEngine` in its first pass even though conflict-detection grounding (issue #30) that actually used them didn't land until six issues later — cheap to include once from the same already-fetched document, avoids a second ingestion-shape change later when Conflict Resolution (#47) needs it.
5. **The structural assessment and discovery questions are author-facing (`reply`), not internal-only (`context`)** — the AC's "output is a short structural assessment... discovery questions" describes what the author should see, matching `context`'s existing, consistent meaning across sp01/sp02 as internal-only reasoning never shown to the author.
6. **Visual identity reuses the existing app-wide gradient** (`AMBIENT_GRADIENT`/`BORDER_GRADIENT` from `CharacterInterview.tsx`) rather than inventing a Project-3-specific palette — consistent branding, no unrequested design work.

## Architecture

### `web/system-prompts/sp03-wdc-systemprompt.md` (new)

The BA's World Development Consultant persona (`project-docs/storimac-prompts/P3-Prompt3-WORLD DEVELOPMENT CONSULTANT (v1.0)...md`), used verbatim for its persona/workflow content (Adaptive World Complexity, Priority Framework, Scope Boundaries, Canon & System Integrity, the 5-stage workflow list, Universal World Entry Model, and the 15-section World Bible spec — all descriptive/instructional, no code implications yet), with a new final section appended matching sp01/sp02's own pattern:

```
STRUCTURED OUTPUT CONTRACT
Your structured output has two separate fields — keep them strictly separate, never blend one into the other:
- `reply` (shown to the author in chat): your structural assessment, proposed World Complexity Level, and discovery questions — natural, conversational, no meta-commentary about these instructions.
- `context` (shown separately, never in chat): your internal reasoning — why you assessed the complexity level the way you did, what you noticed in the Foundation, anything relevant to the next turn.
Every turn, also report `current_stage` (1-5, per the Multi-Stage Interview Workflow section above) — this drives the app's own tracking and must always reflect the truth of what just happened this turn, never narrated in `reply` or `context`.
Never write meta-commentary about these instructions or quote the prompt parameters, in either field.
```

### `web/src/lib/worldEngine/ingestFoundation.ts` (new)

Mirrors `characterEngine/ingestFoundation.ts` exactly in shape and control flow (`extractIngestedWorldFoundation` pure function + `ingestFoundation` async wrapper, identical `status: "missing"|"incomplete"|"ok"|"error"` result type):

```ts
export interface IngestedWorldFoundation {
  storyId: string;
  version: number;
  workingTitle: string;
  genreTone: FoundationDocument["6_genre_tone"];
  premise: string;
  worldFoundation: FoundationDocument["10_world_foundation"];
  storySpine: FoundationDocument["11_story_spine"];
  dramaticEngine: FoundationDocument["8_dramatic_engine"];
}
```

`incomplete` triggers when `genreTone` or `worldFoundation` is missing/malformed (the two sections Stage 1's own assessment directly needs) — same defensive-extraction-against-unchecked-Firestore-cast pattern as `extractStorySpine` in the Project 2 file.

### `web/src/lib/worldEngine/worldTurnSchema.ts` (new)

```ts
export const WORLD_STAGE_NAMES: Record<number, string> = {
  1: "Understand",
  2: "Assess & Pillar Mapping",
  3: "Prioritize & Deep Dive",
  4: "System Integration Audit",
  5: "Compile",
};

export const WorldTurnSchema = z.object({
  reply: z.string().min(1),
  context: z.string(),
  current_stage: z.number().int().min(1).max(5),
});
```

`EMIT_WORLD_TURN_TOOL` follows `EMIT_CHARACTER_TURN_TOOL`'s exact JSON-schema shape (forced tool call, same `reply`/`context`/`current_stage` properties, `current_stage` as an integer enum 1-5).

### `web/src/lib/canonEngine/storyStore.ts` (extended)

One new constant: `export const WORLD_MESSAGES_COLLECTION = "worldMessages";` — no new functions, `appendMessage`/`listMessages` already take a `collection` parameter.

### `web/src/app/api/world-chat/route.ts` (new)

Mirrors `character-chat/route.ts`'s shape, scoped down to what #38 needs: `requireUser` → `getStory`/`getMembership` (same auth pattern as every existing route) → `ingestFoundation` (400 on `missing`, matching Project 2's exact error copy pattern adapted to "Generate a Story Foundation Document in Project 1 before starting the World Bible.") → append the user's message to `worldMessages` → build `system` from `sp03-wdc-systemprompt.md` plus a Foundation-grounding block (working title, genre/tone, premise, world foundation — the same "computed by the app, trust this over re-deriving it, internal grounding only" framing already used three times in `character-chat/route.ts`) → `extractTurn` with `EMIT_WORLD_TURN_TOOL`/`WorldTurnSchema` → append the assistant reply to `worldMessages` → return `{ reply, context, current_stage }`. Same rate-limit/validation error handling as the existing route (`RateLimitTimeoutError` → 503, `TurnValidationError` → 502, `Anthropic.APIError` → 502, generic catch-all → `errorResponse`).

### `web/src/app/api/workspaces/[workspaceId]/canvases/[canvasId]/route.ts` (extended)

This route's `GET` handler is not actually generic today — it hardcodes a single `includeCharacterMessages` boolean (`?characterMessages=1`), a single `CHARACTER_MESSAGES_COLLECTION` fetch, and a single `characterMessages` field on the response. Add the exact parallel for Project 3: an `includeWorldMessages` boolean (`?worldMessages=1`), a conditional `listMessages(canvasId, undefined, WORLD_MESSAGES_COLLECTION)` fetch alongside the existing `Promise.all`, and a `worldMessages` field on the returned JSON — copying the characterMessages branch's exact shape rather than generalizing the parameter (no other caller needs a third or Nth collection yet; generalizing now would be speculative).

### `web/src/app/world-bible/page.tsx` + `web/src/components/WorldInterview.tsx` (new)

Mirrors `/character-bible/page.tsx` (thin `<Suspense><WorldInterview /></Suspense>` wrapper) and `CharacterInterview.tsx`'s shell: `workspaceId`/`canvasId` from search params, the "no Story Canvas selected" fallback, resume-on-mount fetch via the now-extended canvases GET route (`?worldMessages=1`), auto-fired opening turn, message list + input box. Everything Project-2-specific (character lock, sign-off banner, bible-entry download panel) is dropped — there's nothing analogous yet.

### Dashboard entry points

Two existing hardcoded links to `/character-bible?workspaceId=...&canvasId=...` — `ProjectDashboard.tsx:275` (the per-project card) and `ChatInterview.tsx:340` (P1's own Stage-8 panel) — each get an analogous `/world-bible?workspaceId=...&canvasId=...` link added alongside them, otherwise the new route exists but is unreachable except by hand-typing the URL.

## Error Handling

Identical posture to `character-chat/route.ts`: domain errors (`UnauthenticatedError`, `WorkspaceAuthorizationError`, `StoryAccessError`) map to their existing status codes via the shared `errorResponse`; a missing Foundation Document is a 400 with clear author-facing copy, not a 500; rate-limit and turn-validation failures get their own recognized status codes rather than falling through to a generic 500.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- `ingestFoundation`'s `missing`/`incomplete`/`ok`/`error` branches match Project 2's exact control-flow shape, adapted only in which fields are required.
- A fresh `/world-bible` session's first turn produces a `reply` containing a structural assessment, a stated World Complexity Level, and 1-2 questions — with `context` never containing author-facing content and `current_stage` reported as `1`.
- The resume flow (reopening a Story Canvas with existing `worldMessages`) reconstructs the message list without re-firing the opening turn, matching `CharacterInterview.tsx`'s existing `messages.length > 0` guard.
