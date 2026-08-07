# P2 Sequential Interview Engine — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-07

## Problem

GitHub issue #26 (P2 M1). Project 2's Character Bible interview currently trusts the model completely for both "who is being interviewed" and "what stage are they at": `character-chat/route.ts` echoes `delta.current_character`/`delta.current_stage`/`delta.character_signed_off` straight from the model's tool call into the persisted message log, with no independent app-side check. There is no persisted concept of a "locked" character at all — nothing stops the model from wandering to a different cast member mid-interview, and nothing stops it from claiming Stage 6 sign-off on turn two.

This mirrors a gap Project 1 already closed: `stageFsm.ts` (issue #7) never trusts a model-declared stage either — it independently computes `currentStage` from which canon elements are actually `Confirmed`, and hard-blocks advancement in app code (`checkStageGate`/`advanceStage`). P1's own `StateDeltaSchema` doesn't even have a `current_stage` field for the model to declare; only a `stage_ready_to_advance: boolean` signal, which the app verifies rather than trusts.

Issue #26's four ACs:
1. Refuse/redirect attempts to switch to another character before the current one signs off, unless the author explicitly overrides.
2. Fixed Stage 1–6 progression per character (already named in the tool schema; not independently enforced).
3. Question depth scales to tier (already computed and injected into the system prompt via `computePriorityMatrix`/`getDepthLabel` — no further work needed here).
4. At most 1–2 questions per turn, never a full dump — already covered by the existing shared `logTurnHeuristics` questionnaire-dump check, which already runs on every P2 turn (`character-chat/route.ts` already calls it). No further work needed here.

So this issue's real scope is ACs 1 and 2: a per-character stage-gate, and a hard-enforced single-active-character lock.

## Decisions (confirmed during brainstorming, 2026-08-07)

1. **Hard app-level enforcement of the character lock, not prompt-only trust.** On an unauthorized switch attempt, the app discards that turn's fact updates and stage change, and replaces the model's `reply` with a deterministic redirect — it does not rely on the model to self-correct. Chosen over a soft/log-only approach because the AC's language ("refuses/redirects") describes a guarantee, and this repo's precedent for PRD-mandated hard behavioral guarantees is app-level code (P1's stage-gate, the Confirmed-element conflict guard), not prompting alone. The trade-off — an occasional templated-feeling reply on the rare violation turn — is accepted.
2. **Stage progression is app-computed and clamped, never trusted raw from the model**, mirroring P1's philosophy even though P2 can't yet reuse P1's exact mechanism (P1 gates on which canon elements are `Confirmed`; P2 doesn't have a defined required-field vocabulary for Stages 1, 3, 4, 5, 6 yet — only Stage 2 has one, from issue #29). Given that, #26 enforces the one rule it *can* enforce honestly without inventing content-based gating that belongs to a later issue: forward progression is monotonic, at most one stage per turn, never regresses. Content-based gating (e.g., requiring specific facts to be `Confirmed` before leaving Stage 2) is explicitly out of scope here — that's issue #28's job, which also has to fold in tier-scaling (Critical/Major forced through the full causal chain, lower tiers not) that #26 has no reason to duplicate.
3. **A new model-declared `switch_override: boolean` field**, same pattern as the already-trusted `character_signed_off`. The model is better positioned than any app-side text heuristic to recognize "the author explicitly asked to change characters" from conversational context; the app then just enforces the boundary the model asserts, exactly as it already does for sign-off.
4. **Tier is not persisted in the new state.** `computePriorityMatrix` already recomputes it cheaply from `foundation.cast` every turn (already wired into the system-prompt injection). Persisting a second copy would risk staleness for no benefit; #26 doesn't need tier for any decision it makes (that starts with #28), and #28 can look it up live the same way the route already does today.
5. **Redirect text reuses the locked character's last stored question** rather than a fully generic canned message. `recentMessages` (already loaded for every turn) holds the assistant's prior replies with `current_character` attached; the most recent one matching the locked character's stored name is repeated verbatim under a short redirect frame. This keeps the interruption minimally jarring — the author sees the exact question they left off on, not a bare refusal.

## Architecture

### `web/src/lib/canonEngine/storyStore.ts` (extended)

New exported types:
```ts
export type P2CharacterStatus = "in_progress" | "deferred" | "signed_off";

export interface P2CharacterProgress {
  characterName: string;
  stage: number; // 1-6, app-computed ground truth
  status: P2CharacterStatus;
}

export interface P2State {
  activeCharacterId: string | null; // null = no lock, any character may start/resume
  characterProgress: Record<string, P2CharacterProgress>; // keyed by charId
}
```
`Story` gains `p2?: P2State | null` (optional/nullable, same convention as `stage7Audit`/`pendingConflict`, for backward compatibility with Stories created before this field existed). A new `setP2State(storyId: string, p2: P2State): Promise<void>` setter does a whole-object replace of the `p2` field plus `updatedAt` — same shape as `setStage7Audit`. No change to `touchStory`, `createStory`'s default shape, or any P1 code path.

### `web/src/lib/characterEngine/characterFsm.ts` (new)

Pure, I/O-free module, mirroring `stageFsm.ts`'s shape and the same reasoning for keeping it pure (testable in isolation; importable client-side later without dragging in `firebaseAdmin`).

```ts
export const P2_STAGE_NAMES: Record<number, string> = {
  1: "Position & Purpose",
  2: "Psychological Core",
  3: "Outward Identity & Voice",
  4: "Relationship Integration",
  5: "Transformational Arc Pacing",
  6: "Sign-Off & Compile",
};

export type CharacterTurnResolution =
  | { allowed: true; nextP2State: P2State; stage: number; status: P2CharacterStatus }
  | { allowed: false; activeCharId: string; activeProgress: P2CharacterProgress };

export function resolveCharacterTurn(
  p2State: P2State,
  charId: string,
  characterName: string,
  requestedStage: number,
  signedOff: boolean,
  switchOverride: boolean
): CharacterTurnResolution;
```

Decision logic inside `resolveCharacterTurn`:
- **No lock (`activeCharacterId === null`), or the lock already belongs to `charId`:** allowed. `prevStage = p2State.characterProgress[charId]?.stage ?? 1`. Clamp: `stage = requestedStage > prevStage + 1 ? prevStage + 1 : Math.max(requestedStage, prevStage)` — advances at most one stage per turn, never regresses, and simply holds at `prevStage` if the model's `requestedStage` is out of range in either direction. This clamp holds at `prevStage` on a regression/repeat claim, but advances by exactly one stage (not straight to the claimed number) on an overshoot — e.g. `prevStage=1, requestedStage=6` still yields `stage=2`, not a jump to 6. `status = signedOff && stage === 6 ? "signed_off" : "in_progress"` — sign-off is only ever honored at Stage 6; a premature `character_signed_off: true` elsewhere is silently downgraded to `"in_progress"` and logged by the caller. `nextP2State.activeCharacterId` becomes `null` if `status === "signed_off"` (unlocking for the next character), otherwise `charId`.
- **Lock belongs to a different character, `switchOverride === true`:** allowed. The previously-locked character's progress entry gets `status: "deferred"` (resumable later — its `stage` is left untouched so resuming continues where it left off, not from Stage 1). The new `charId` proceeds through the same stage-clamping logic as above (using its own prior progress if any, else Stage 1), and becomes the new lock.
- **Lock belongs to a different character, `switchOverride === false`:** `{ allowed: false, activeCharId, activeProgress }` — no state mutation.

### `web/src/app/api/character-chat/route.ts` (extended)

After `extractTurn` succeeds and `charId` is resolved (existing `resolveCharId` call, unchanged):

1. Read `const p2State = story.p2 ?? { activeCharacterId: null, characterProgress: {} };`.
2. Call `resolveCharacterTurn(p2State, charId, delta.current_character, delta.current_stage, delta.character_signed_off, delta.switch_override)`.
3. **If blocked:** skip `toFactUpdate`/`applyStateDelta` entirely for this turn. Find the most recent message in the already-loaded `recentMessages` whose `current_character === activeProgress.characterName`; if found, its `content` becomes the repeated question, else fall back to a generic nudge sentence. Build the redirect reply:
   > "Let's finish {activeProgress.characterName}'s profile first — we're at Stage {activeProgress.stage} ({P2_STAGE_NAMES[activeProgress.stage]}).\n\n{repeated question or generic nudge}"

   Append this as the assistant message (`current_character: activeProgress.characterName`, `current_stage: activeProgress.stage`) instead of `delta.reply`, log the violation (`console.warn`, same convention as the existing unknown-field/conflict logs), and return it as the API response with `character_signed_off: false`. `story.p2` is not touched.
4. **If allowed:** proceed exactly as today (fact updates via `toFactUpdate`/`applyStateDelta`, unchanged), but the persisted assistant message and the API response report `resolution.stage`/`resolution.status`-derived values instead of the model's raw `delta.current_stage`/`delta.character_signed_off` — the client always sees the clamped, app-computed truth, never a value that might get corrected a moment later. Call `setP2State(storyId, resolution.nextP2State)` alongside the existing `appendMessage` call.

### `web/src/lib/characterEngine/characterTurnSchema.ts` (extended)

`CharacterTurnSchema` and `EMIT_CHARACTER_TURN_TOOL` gain `switch_override: z.boolean()` / `{ type: "boolean" }`, required every turn (defaults to `false` in ordinary conversation) — same treatment as `character_signed_off`: "True only on a turn where the author has explicitly asked to move to a different character before signing off the current one. False every other turn."

## Error Handling

No new failure modes beyond what already exists. The blocked-switch path is not an error — it's a normal, successful turn that simply doesn't advance state; it returns `200` with a redirect reply, not an error status. `resolveCharacterTurn` is a pure function with no thrown exceptions (invalid `requestedStage` values are clamped, not rejected, since they're just an untrusted model claim, the same posture P1 takes toward malformed fact proposals).

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A first-ever turn (`activeCharacterId: null`) locks onto whichever character the model proposes, at Stage 1 (or wherever `characterProgress` already had them, e.g. resuming a `deferred` character).
- A same-character turn advances at most one stage: a claim of `prevStage + 1` or lower is honored (or held at `prevStage` if it's a repeat/regression), while a claim 2+ stages ahead is clamped down to `prevStage + 1`, not jumped straight to the claimed number.
- A `character_signed_off: true` claim at any stage other than 6 is downgraded to `"in_progress"`, not honored.
- A cross-character switch attempt with `switch_override: false` is blocked: no fact updates applied, `story.p2` unchanged, redirect reply references the correct locked character and repeats its last question.
- The same switch with `switch_override: true` succeeds: old character becomes `"deferred"` at its prior stage (not reset), new character becomes the lock.
- Sign-off at Stage 6 unlocks `activeCharacterId` back to `null`.
