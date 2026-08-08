# P2 Relationship Graph & Ripple-Effect Checks — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-08

## Problem

GitHub issue #31 (P2 M3). PRD §5.5 requires a lightweight relationship graph (character → character → dynamic + trust/power trajectory) and ripple-effect surfacing: before confirming a psychological change to an already-interviewed character, the system should evaluate and surface likely effects on other characters' already-confirmed relationship dynamics.

Relationships are inherently a two-character concept and don't fit the existing single-character `FactUpdateSchema`/`CHARACTER_FIELD_IDS` shape — `factRegistry.ts`'s own header comment already anticipated this, naming issue #31 as the one that would need to extend the P2 data model rather than the existing 11-field registry. sp02 §4 ("Relational Impact: The cast is an ecosystem. Before confirming a psychological change to one character, consider its ripple effects on other cast members' relationships.") already instructs the model to do exactly what AC2 asks for — the real gap is that no relationship data is tracked or shown to the model anywhere, so there is nothing for that instruction to act on.

AC2's own wording ("evaluates and surfaces likely ripple effects") is notably softer than issue #30's AC3 ("does not proceed past a detected contradiction until...") — this is a grounding/visibility problem, not a hard-gate problem.

## Decisions (confirmed during brainstorming, 2026-08-08)

1. **No hard gate.** Ripple checks are surfaced via grounding, not enforced via a blocking mechanism like issue #30's pending-conflict flow. Matches AC2's actual wording and keeps this issue's scope proportional — a full pending-state/re-gating flow (issue #30's biggest source of complexity) isn't what the AC asks for here.
2. **Relationships reuse the Canon Engine as a third collection** (`characterRelationships`), not a new bespoke store. `canonStore.ts` was already generalized for exactly this in issue #29 ("to support a second collection") — no changes needed to that file, just a new collection constant and composite-ID usage, mirroring `CHARACTER_FACTS_COLLECTION`'s own pattern.
3. **A separate `relationship_updates` array on the turn schema, not an extension of `updates`/`CHARACTER_FIELD_IDS`.** A relationship's "field name" would have to be the other character's ID, which can't be a fixed enum (the cast is dynamic per story) — the same reason issue #29's registry is a closed vocabulary of fixed field names doesn't extend to per-character relationship keys. `depends_on`/`rationale` aren't exposed on relationship updates — causal-chain traceability (issue #28) is a Psychological Engine concept that doesn't apply to relationship dynamics.
4. **`dynamic`/`trust_trajectory`/`power_dynamic` stay free text**, matching how `value` is already free-form for psych facts — these are qualitative descriptions (e.g. "mentor-student", "growing", "A holds authority over B"), not field names needing a closed vocabulary to prevent invention.
5. **"Already interviewed" is detected via issue #26's existing `P2State.characterProgress[charId].status === "signed_off"`** — already the exact signal for "this character's core interview is complete and any further psychological proposal is a revision," no new tracking needed.
6. **Grounding is injected unconditionally for every already-signed-off character, every turn — not conditionally for "the character currently being revised."** The original brainstorm framed this as conditional on `charId`'s status, but that doesn't actually work: the system prompt is built *before* the model call, while `charId` is only known *after* the model responds with `current_character` — there's no reliable way to know in advance which character (if any) the upcoming turn will revise. (`story.p2?.activeCharacterId` can't substitute for this either — issue #26's FSM clears `activeCharacterId` to `null` the moment a character signs off, so a signed-off character is never the "locked" one going into their own revision turn.) Instead: every turn, for every character whose `characterProgress` status is `signed_off`, inject that character's own relationship entries. This is actually more consistent with this codebase's existing grounding philosophy than the original conditional idea — the Cast & Priority Matrix and Story Spine/Dramatic Engine blocks are already both injected unconditionally, every turn, trusting the model to use what's relevant. With a typically small cast, the added payload is proportional.

## Architecture

### `web/src/lib/canonEngine/canonStore.ts` (unchanged)

No code changes — already generalized in issue #29. This issue just uses the existing `collection` parameter with a new constant.

### `web/src/lib/characterEngine/factRegistry.ts` (extended)

New exported constant, `CHARACTER_RELATIONSHIPS_COLLECTION = "characterRelationships"`, alongside the existing field-vocabulary exports — same file already owns P2's canon-scoping constants (`CHARACTER_FIELD_IDS`), a natural home for this sibling constant. (Considered a new file, but this is a single constant with no logic — doesn't warrant its own module the way `causalChain.ts`/`characterFsm.ts` did for actual behavior.)

### `web/src/lib/characterEngine/characterTurnSchema.ts` (extended)

`CharacterTurnSchema`/`EMIT_CHARACTER_TURN_TOOL` gain `relationship_updates: RelationshipUpdateSchema[]` (required, empty array the common case — mirrors `updates`'s own "empty most turns" convention). New `RelationshipUpdateSchema`:
```ts
export const RelationshipUpdateSchema = z.object({
  with: z.string().min(1),
  dynamic: z.string().min(1),
  trust_trajectory: z.string().min(1),
  power_dynamic: z.string().min(1),
  state: z.enum(["Exploring", "Working", "Confirmed", "Deferred"]).optional(),
});
```
`with` is free text (the other character's name, exactly as `current_character` already is) — resolved via the existing `resolveCharId` helper, not a new closed enum. `dynamic`/`trust_trajectory`/`power_dynamic` are all **required together** whenever a relationship update is proposed at all — deliberately not independently optional. `canonStore.ts`'s `applyStateDelta` replaces `value` wholesale when `patch.value` is provided at all (`nextValue = update.patch.value !== undefined ? update.patch.value : existing?.value` — confirmed by reading the actual merge logic, not assumed), it does not deep-merge nested object sub-fields. An independently-optional sub-field would let the model update just `dynamic` and silently wipe out a previously-stored `trust_trajectory`/`power_dynamic`. Requiring all three together means every relationship update is a complete, self-contained snapshot — the same posture P1 already takes toward its own compound `value` objects (e.g. `dramatic_engine`) elsewhere in this codebase.

### `web/src/app/api/character-chat/route.ts` (extended)

**Relationship persistence**: a new `toRelationshipUpdate(u, charId, withCharId)` mapper (mirrors `toFactUpdate`), where `withCharId` is `u.with` resolved via the existing `resolveCharId`. Builds `element_id: ${charId}.${withCharId}`, and always sets `patch.value = { dynamic: u.dynamic, trust_trajectory: u.trust_trajectory, power_dynamic: u.power_dynamic }` as a complete object — all three source fields are schema-required together (decision above), so there is never a partial value to worry about; this mapper does not need, and must not attempt, any merge-with-existing logic. `patch.status` follows the same `Deferred`→`Parked` translation `toFactUpdate` already uses. Applied via `applyStateDelta(storyId, relationshipUpdates, turnId, CHARACTER_RELATIONSHIPS_COLLECTION)`, alongside (not merged into) the existing psych-fact `applyStateDelta` call — two separate calls, two separate collections, same turn.

**Ripple-check grounding**: every turn, list every character in `p2State.characterProgress` whose `status === "signed_off"`. For each, fetch their existing relationship entries (`listElements(storyId, CHARACTER_RELATIONSHIPS_COLLECTION)` once per turn, filtered client-side to `element_id` starting with `${thatCharId}.`) and inject them into the system prompt as grounding, framed the same way existing grounding blocks are ("computed by the app... internal grounding only"), grouped per character so the model can tell whose relationships are whose. If no character has signed off yet, this block is simply omitted (nothing to ground). No new schema field to verify compliance — the existing sp02 §4 instruction plus this grounding is the entire mechanism, matching decision 1.

## Error Handling

No new failure modes. Relationship updates go through the exact same `applyStateDelta`/`CanonConflictError` handling already established for psych facts — a second, independent try/catch around the relationship `applyStateDelta` call, so a conflict on one collection doesn't abort the other.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A `relationship_updates` entry with `with: "Kade"` for a session whose cast includes "Kade Ashworth" resolves to the correct `withCharId` via the existing `resolveCharId` logic.
- The relationship element is written to `characterRelationships`, not `characterFacts`, with a composite ID distinct from any psych-fact ID for the same `charId`.
- A turn where no character in `characterProgress` is `signed_off` yet gets no ripple-check grounding block at all.
- A turn where one character is `signed_off` gets that character's own relationship entries injected, grouped/labeled by character.
- A turn where two characters are both `signed_off` gets both characters' relationship entries injected, each clearly attributed to the right character - not merged together.
- An empty `relationship_updates: []` (the common case) results in no `applyStateDelta` call for the relationships collection at all — mirrors the existing `factUpdates.length > 0` guard.
