# P2 Session Persistence & Resume — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-10

## Problem

GitHub issue #36 (P2 M4). Acceptance criteria: session state persists (priority matrix, per-character stage/status, all fact states, relationship graph, outstanding-questions log — the `Session` data model in PRD §7); resuming a session mid-character does not re-ask already-Confirmed material; state is re-derivable from the persisted session object, not solely from conversation memory. A collaborator comment on the issue (2026-07-23) says this should reuse the shared engine's session persistence (reference implementation: issue #12), scoped to Project 2, not an independent build.

An audit (2026-08-09/10) found this issue is much smaller than it reads: P2 already reuses #12's exact mechanism — the same `/stories/{storyId}` document plus a fixed set of named subcollections, using #12/#6's generic `collection`-parameterized read/write functions (`appendMessage`/`listMessages`/`applyStateDelta`/`listElements`) rather than any independent persistence build. This happened incrementally, as a side effect of issues #26 through #35:

- Per-character stage/status: `Story.p2` (`P2State.characterProgress`), written by `setP2State`.
- All fact states: `/stories/{id}/characterFacts/{charId}.{field}` (`CanonElement`, issue #28/#29).
- Relationship graph: `/stories/{id}/characterRelationships/{charId}.{otherCharId}` (issue #31).
- Outstanding-questions log: `/stories/{id}/outstanding_questions`, now `charId`-tagged (issue #34's retrofit).
- Priority matrix: deliberately **not** persisted — `computePriorityMatrix` is a pure, I/O-free recompute over Project 1's exported cast every turn (ratified in ARCHITECTURE.md §7 / issue #37: it must stay recomputable since the matrix is user-editable).

Two real, concrete gaps remain against the three ACs:

1. **AC "does not re-ask already-Confirmed material"**: the backend has a hard *write* guard (`applyStateDelta` throws on changing an already-Confirmed element without override) that prevents corruption, but nothing tells the *model* a fact is already settled once it scrolls out of the 20-message replay window (`CHARACTER_MESSAGE_WINDOW`) — which happens on any sufficiently long interview, and always happens on a resumed session that reopens with a fresh, short window. Issue #31 already solved the equivalent problem for relationships (an unconditional grounding block); no equivalent exists for a character's own facts.
2. **AC "state re-derivable from the persisted session object, not solely from conversation memory"**: the resume API (`GET .../canvases/[canvasId]?characterMessages=1`) already returns `story` in full, including the authoritative `p2` field — but `CharacterInterview.tsx`'s resume effect never reads it, and instead re-derives `currentCharacter`/`currentStage` by scanning the last assistant message's metadata. This usually agrees with the persisted state but is, by construction, deriving from conversation memory rather than the session object the AC asks for.

## Decisions (confirmed during brainstorming, 2026-08-09/10)

1. **Scope is exactly these two gaps.** No P2-side canon panel (surfacing facts/relationships/outstanding questions visually) — that's a UI-completeness nice-to-have the ACs don't ask for, not a persistence/resume correctness issue. Keeping this issue tightly scoped.
2. **The Confirmed-facts grounding block is injected unconditionally, for every character with a `characterProgress` entry** — not conditionally scoped to "the current character." This mirrors issue #31's own resolved lesson: the system prompt is built *before* the model reveals `current_character` for a given turn, so there is no way to know in advance which character's grounding will be relevant. Inject broadly (same posture as the existing Cast & Priority Matrix, Story Spine, and Relationship Graph blocks) and trust the model to use what applies.
3. **Only `status === "Confirmed"` facts appear in the block** — Working/Exploring facts are still legitimately being explored and shouldn't be presented as settled.
4. **Raw field IDs, not pretty labels.** This grounding block is internal-only (never narrated to the author, per the existing convention on every other grounding block in this route) and consumed by the same model that already uses these exact field IDs in its own tool calls — a label-lookup table would be pure overhead with no reader who needs it.
5. **`context` (the Notes card's free-text content) keeps coming from message-scanning**, not from `P2State`. It's ephemeral conversational reasoning with no structured equivalent in the persisted session object — the AC's concern is stage/status/facts being re-derivable from session state, not the model's prose commentary, so this doesn't conflict with the AC's intent.
6. **Message-scanning stays as a defensive fallback** for `currentCharacter`/`currentStage` only in the edge case where `p2.activeCharacterId` is unset but chat history exists (shouldn't happen in practice, but costs nothing to guard).

## Architecture

### `web/src/app/api/character-chat/route.ts` (extended)

A new grounding block, inserted immediately after the existing Relationship Graph block (issue #31) and before the `story.p2PendingConflict` check, reusing the same `relationshipGroundedIds` array already computed for that block (both blocks iterate the identical `Object.keys(p2State.characterProgress)` set, so there's no reason to recompute it twice):

```ts
if (relationshipGroundedIds.length > 0) {
  const factElements = await listElements(storyId, CHARACTER_FACTS_COLLECTION);
  const factLines: string[] = [];
  for (const id of relationshipGroundedIds) {
    const progress = p2State.characterProgress[id];
    const confirmed = factElements.filter((e) => e.element_id.startsWith(`${id}.`) && e.status === "Confirmed");
    if (confirmed.length === 0) continue;
    const fieldLines = confirmed
      .map((e) => `  - ${e.element_id.slice(id.length + 1)}: ${typeof e.value === "string" ? e.value : JSON.stringify(e.value)}`)
      .join("\n");
    factLines.push(`- ${progress.characterName}:\n${fieldLines}`);
  }
  if (factLines.length > 0) {
    system += `\n\n[Confirmed Facts So Far - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Do not re-ask about any fact listed here as Confirmed - treat it as already settled and move the interview forward.]\n${factLines.join("\n")}`;
  }
}
```

No new imports needed — `listElements` and `CHARACTER_FACTS_COLLECTION` are both already imported in this file.

### `web/src/components/CharacterInterview.tsx` (extended)

The resume effect's existing message-scanning logic is supplemented with a read of `data.story.p2` (already present in the response payload, just unused today):

```ts
const p2 = data.story?.p2 as P2State | undefined;
const activeProgress = p2?.activeCharacterId ? p2.characterProgress[p2.activeCharacterId] : undefined;
if (activeProgress) {
  setCurrentCharacter(activeProgress.characterName);
  setCurrentStage(activeProgress.stage);
  setCharacterSignedOff(activeProgress.status === "signed_off");
}
const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant" && m.current_character);
if (lastAssistant) {
  setContext(lastAssistant.context ?? null);
}
if (!activeProgress && lastAssistant) {
  setCurrentCharacter(lastAssistant.current_character ?? null);
  setCurrentStage(lastAssistant.current_stage ?? null);
}
```

`P2State` is imported as a type-only import from `@/lib/canonEngine/storyStore` (safe in a client component — that module is server-only via `firebase-admin`, but a `type`-only import is erased at compile time, the same pattern already used for `CharacterBibleEntry` in this same file, issue #35).

## Error Handling

No new failure modes. The grounding block's Firestore read reuses infrastructure already exercised every turn elsewhere in this route (the same `listElements` call already used for the fact-update pipeline). The resume fix adds no new fetch — it reads a field already present in an existing response; if `data.story.p2` is absent or malformed, `activeProgress` is simply `undefined` and the existing message-scanning fallback takes over, exactly as it does today.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A fixture `p2State.characterProgress` with two characters — one with 3 Confirmed facts and 2 Working facts, one with zero facts at all — produces a grounding block listing only the first character, and only its 3 Confirmed fields (the 2 Working fields and the zero-fact character are both absent).
- A fixture `p2State.characterProgress` where every character has zero Confirmed facts produces no grounding block at all (the `if (factLines.length > 0)` guard), matching the Relationship Graph block's identical empty-case behavior.
- A resumed session's response payload with `p2.activeCharacterId` set and a matching `characterProgress` entry populates `currentCharacter`/`currentStage`/`characterSignedOff` from that entry, not from scanning `rawMessages`; `context` still comes from the last assistant message regardless.
- A resumed session's response payload with `p2` present but `activeCharacterId: null` (a session that's created a Story Canvas but never actually started a P2 turn) falls through cleanly to the message-scanning fallback without throwing (there's no `lastAssistant` in that case either, so both `currentCharacter` and `context` stay at their initial `null` state, matching today's brand-new-session behavior).
