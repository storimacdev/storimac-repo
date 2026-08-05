# P2 Per-Fact Canon State Tracking — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-05

## Problem

GitHub issue #29 (P2 M2). Project 2's Character Bible interview currently has zero canon-state tracking: `CharacterTurnSchema`/`EMIT_CHARACTER_TURN_TOOL` (from issues #26/#27) are deliberately minimal — `reply`/`current_character`/`current_stage`/`character_signed_off`/`context` only, no fact-tracking field, per that file's own comment: "no per-fact canon-tracking field yet (that's issue #29's job, milestone M2)."

PRD §5.4 requires every discrete fact proposed during a character interview to carry a state (`Exploring`/`Working`/`Confirmed`/`Deferred`), with only `Confirmed` facts eligible for the compiled Character Bible (§10.2/issue #34, later), and each fact traceable to its source turn. §7's illustrative data model: `facts: [{ field, value, state, source_turn }]`, nested per character under `Session.characters[]`.

Issue #29's own architecture note (2026-07-23) settles the biggest structural question: implement this by configuring the existing shared Canon Engine (`CanonElement` state machine, `canonStore.ts` — reference implementation #6, already proven on Project 1) with Project 2's per-fact schema, not as an independent state store.

## Decisions (confirmed during brainstorming, 2026-08-05)

1. **Facts live in a new flat Firestore collection with a composite ID**, not true nested subcollections. `canonStore.ts`'s functions (`elementsCollection`, `applyStateDelta`, `getElement`, `listElements`) gain an optional trailing `collection: string = "elements"` parameter — identical to the pattern already used for `storyStore.ts`'s message functions this session (default preserves P1's exact current behavior, zero P1 call-site changes). P2 passes a new constant, `CHARACTER_FACTS_COLLECTION = "characterFacts"`, and scopes each fact to its character via a composite `element_id`: `{charId}.{field}` (e.g. `deva.core_wound`), where `charId` is the character's name slugified (lowercase, spaces→underscores). `project_id` stays `storyId`, matching P1. This was chosen over literal nested subcollections (`/stories/{id}/characters/{charId}/facts/{factId}`) to avoid generalizing `canonStore.ts` to understand dynamic parent paths — a bigger, riskier change to shared, live production code for no functional gain over a composite key.
2. **`Deferred` is a presentation-layer label for the shared `CanonStatus.Parked` value**, not a new literal on the shared type. ARCHITECTURE.md already sanctions this: "side branch (Parked/Deferred — naming varies by PRD, values are project-specific)." Internal storage and `canonStore.ts` stay genuinely generic (untouched, still only know `Parked`); a small translation shim in the P2 layer presents `"Deferred"` in the tool schema description, the Zod schema's enum, and any API-response/UI-facing text, translating to/from `"Parked"` at the boundary where P2 code calls into `canonStore.ts`.
3. **Closed enum, scoped to only what's explicitly named in the PRD/CDRM/issue #28** — not the full eventual 6-stage vocabulary. This is the direct lesson from the freeform `element_id` field that caused the just-fixed P1 production bug (three branches to repair): a bare, undescribed string field lets the model invent IDs, and even a well-described-but-open field risks the model reusing a name meant for a different concept. `web/src/lib/characterEngine/factRegistry.ts` seeds `CHARACTER_FIELD_IDS` with exactly 11 fields:
   - The corrected Triad + Need (issue #28's corrected AC): `want`, `personality_how`, `need`, `values`
   - The causal psychology chain (PRD §5.3, CDRM §3): `life_experience`, `core_wound`, `false_belief`, `core_flaw`, `dominant_fear`, `defense_mechanisms`, `behavioral_trajectory`

   Nothing beyond these 11. Stages 1, 3, 4, 5, 6 (Position & Purpose; Outward Identity & Voice; Relationship Integration; Transformational Arc Pacing; Sign-Off & Compile) stay purely conversational under this issue — no facts get written for them yet. Their field vocabularies aren't fixed anywhere in the source docs yet; inventing names for them now would risk the same sibling-collision class of bug we just fixed in P1, self-inflicted this time. Those stages' own issues (#31 relationships, #34 compiler, and whichever issue eventually covers Stage 1/3/5's fields) extend this same registry when their field sets are actually specified. CDRM's "Blind Spots" concept is deliberately excluded too — mentioned in the reference doc but not required by any current issue's AC.
4. **`depends_on` gets populated now, validated later.** The generic `CanonElement.depends_on: string[]` field already exists (used by P1 for downstream-impact lookups) and is exactly the mechanism issue #28's causal-chain traceability check will need next (e.g. confirming `core_flaw` should record `depends_on: ["deva.core_wound"]` or `["deva.false_belief"]`). This issue has the model populate it when confirming a causally-linked fact; #28 is what will actually *enforce* traceability against it. Capturing the data now costs nothing extra (the field already exists on every `CanonElement`) and avoids a second pass over already-confirmed facts once #28 lands.

## Architecture

### `web/src/lib/canonEngine/canonStore.ts` (generalized)

`elementsCollection(storyId, collection = "elements")`, `applyStateDelta(storyId, updates, turnId, collection = "elements")`, `getElement(storyId, elementId, collection = "elements")`, `listElements(storyId, collection = "elements")` — each gains the trailing parameter, defaulting to today's exact path. `upsertElement` and `listDependents` are unaffected (not used by P2's flow in this issue). No change to `CanonElement`, `CanonElementPatch`, `CanonStatus`, or the transition/conflict logic — all of that stays exactly as-is and applies automatically once P2 reuses it (including the existing "can't silently change a Confirmed element" guard).

### `web/src/lib/characterEngine/factRegistry.ts` (new)

Exports `CHARACTER_FIELD_IDS: string[]` (the 11 fields above) and `isKnownFieldId(id: string): boolean`, mirroring `elementRegistry.ts`'s shape exactly. A comment documents which stage/issue each field group came from and instructs future editors to extend this array (not create a parallel one) when a later issue defines more fields.

### `web/src/lib/characterEngine/characterTurnSchema.ts` (extended)

`CharacterTurnSchema` gains `updates: FactUpdateSchema[]` (array, empty allowed, always required — mirrors `StateDeltaSchema.updates` exactly). `FactUpdateSchema`: `{ field: string, value: unknown, state: "Exploring"|"Working"|"Confirmed"|"Deferred", rationale?: string, depends_on?: string[] }`. `EMIT_CHARACTER_TURN_TOOL`'s `updates` property mirrors `EMIT_TURN_TOOL`'s shape: `field` gets `{ type: "string", enum: CHARACTER_FIELD_IDS, description: "..." }` (same enum-steering treatment P1's `element_id` just got), `state`'s enum is `["Exploring", "Working", "Confirmed", "Deferred"]` (the model-facing, PRD-matching labels — never "Parked").

### `web/src/app/api/character-chat/route.ts` (extended)

A `toFactUpdate(u: FactUpdateInput, charId: string): ElementUpdate` mapper (mirrors `toElementUpdate`) builds the composite `element_id` (`${charId}.${u.field}`) and translates `state: "Deferred"` → `patch.status: "Parked"` (all other states pass through unchanged, since they're spelled identically on both sides). After extracting the turn, the route computes `charId` by slugifying `delta.current_character`, maps `delta.updates` through `toFactUpdate`, and calls `applyStateDelta(storyId, updates, turnId, CHARACTER_FACTS_COLLECTION)`. Mirrors P1's `chat/route.ts` structure for the equivalent step, without P1's stage-gate/conflict-resolution machinery (that's #30/#28's job on the P2 side, not this issue's).

### Log-only unknown-field visibility

Same pattern as P1's `[chat] unknown element_id` check (already merged): right after building `updates` in `character-chat/route.ts`, log (`console.warn`, non-blocking) any `field` not in `CHARACTER_FIELD_IDS`. Defense in depth — the enum should prevent this, but if it doesn't, the write still succeeds and the warning gives visibility rather than silent, permanent invisibility of the fact.

## Error Handling

No new failure modes. `applyStateDelta`'s existing `CanonConflictError` (thrown when changing a Confirmed element without override) and invalid-transition `Error` both apply unchanged — P2 doesn't yet have a Conflict Resolution UI flow (that's issue #30), so for now a `CanonConflictError` from this path should be caught and logged the same defensive way `chat/route.ts` already does for P1's unscreened-conflict case, rather than surfacing a raw 500.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus manual review confirming: the `canonStore.ts` generalization doesn't change P1's behavior (no P1 call site passes a `collection` argument, so every P1 call keeps hitting `/stories/{storyId}/elements` exactly as today), and the enum/registry counts match (11 fields, cross-checked against issue #28's AC and PRD §5.3 line by line).
