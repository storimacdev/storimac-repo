# P2 Stage 6 Sign-Off Compiler — Design Spec

**Status:** Approved for planning
**Date:** 2026-08-09

## Problem

GitHub issue #34 (P2 M4). CDRM §7 ("Character Bible Documentation Specification") defines a fixed 8-part structure every signed-off character must compile into: Metadata, Story Function & Integration Map, The Psychological Engine, Behavior & Audible Voice Profile, Ensemble Interconnection Registry, Milestone Arc Timeline, Continuity & Canon Rules, Outstanding Character Questions. The compiled entry appends to a running master Character Bible — prior characters' entries are never overwritten.

Three of the eight sections have no data source today. `factRegistry.ts`'s `CHARACTER_FIELD_IDS` only covers Stage 2's 11 Psychological Engine fields — Stages 1 (Story Function & Integration Map), 3 (Behavior & Audible Voice Profile), and 5 (Milestone Arc Timeline) have always been conversational-only, exactly as `factRegistry.ts`'s own header comment anticipated ("Extend this array... when a later issue (#34 compiler...) defines more fields"). The other five sections already have real data sources: Psychological Engine ← Stage 2's 11 facts (#29), Ensemble Interconnection Registry ← the relationship graph (#31), Outstanding Character Questions ← the outstanding-questions log (#32), and most of Metadata ← already-computed cast/tier/depth data (`foundation.cast`, `computePriorityMatrix`, `getDepthLabel`).

CDRM §7's own descriptions of the three missing sections are precise enough to derive field vocabularies directly, rather than guessing:
- **Story Function & Integration Map**: "narrative purpose, structural relationship to the protagonist, conflict contribution, and exact thematic thesis."
- **Behavior & Audible Voice Profile**: "behavioral tendencies under stress, physical body language, and linguistic signature configurations."
- **Milestone Arc Timeline**: "Sequential layout of internal changes across the 7 milestones of the Story Spine" — CDRM §5 names all seven explicitly: Initial Worldview → Inciting Disruption → Failed Resistance → Midpoint Realization → Crisis Choice → Action-Proven Transformation → New Identity. CDRM §5 also names three closed Arc Types (Positive Change, Negative Change/Fall, Flat) feeding Metadata's "Arc Type" field.

## Decisions (confirmed during brainstorming, 2026-08-09)

1. **Full scope: define Stage 1/3/5/6 field vocabularies now**, rather than compiling placeholder/partial sections. This was flagged as #34's job from the start (`factRegistry.ts`'s own comment) and CDRM §7 is precise enough to do properly.
2. **Compilation is append-only, not P1-style live regeneration.** `foundationDoc.ts` (issue #18) regenerates its *entire* document fresh from live canon state on every call, with full version history. That model doesn't fit here: AC3 explicitly requires prior characters' entries to never be overwritten, and the natural cadence is "one character's profile becomes permanent the moment they sign off" — not "the whole Bible re-derives itself from current state." A new `characterBibleEntries` collection holds one doc per `charId`, written exactly once.
3. **Persistence uses a check-then-write pattern, not `DocumentReference.create()`'s atomic-but-unverified error semantics.** There's no local precedent for `.create()`'s exact "already exists" error shape in this codebase, and no way to verify it against a live Firestore instance during this session. The established, already-proven pattern from issues #28/#30/#31 (`isAlreadyConfirmed`-style: read first, skip-and-log if already present) is safer and consistent with how this codebase already handles "never re-litigate an already-settled thing." The realistic race window (two sign-off turns for the same character within milliseconds) is not a practical concern for a human typing in a chat interface.
4. **New field values stay free text**, including the closed-vocabulary-sounding `arc_type` (Positive Change Arc / Negative Change-Fall Arc / Flat Arc) — matches the established Stage 2 precedent where only field *names* are a closed enum (`CHARACTER_FIELD_IDS`), never values. sp02 instructs the model to pick one of the three named types; nothing validates the value at the app level, the same posture already used for `dynamic`/`power_dynamic` etc.
5. **`StoredOutstandingQuestion` gets a retrofitted optional `charId` field.** Issue #32 shipped without one — the outstanding-questions log is currently story-scoped, not character-scoped, which means Outstanding Character Questions can't be filtered to the signing-off character. `charId` is optional (backward compatible with every P1-originated entry and every #32 entry written before this retrofit); #32's own P2 write path in the route also starts populating it as part of this issue, since it's the same file already being touched.
6. **Compilation and rendering are split across #34 and #35, as their titles already imply.** #34 compiles structured data and persists it; rendering to Markdown/docx for author-facing export is #35's explicit job. No `renderMarkdown`-equivalent function is built here.
7. **`Canon Status` in Metadata is a literal constant** (`"Signed Off"`), not a captured fact — it's definitionally true at the moment of compilation, nothing to ask the model for.

## Architecture

### `web/src/lib/characterEngine/factRegistry.ts` (extended)

19 new field IDs added to `CHARACTER_FIELD_IDS`, grouped by stage with comments (extending the single array per the file's own established guidance, not creating a parallel vocabulary):

- **Stage 1** (Story Function & Integration Map + basic identity): `age`, `occupation`, `narrative_purpose`, `protagonist_relationship`, `conflict_contribution`, `thematic_thesis`
- **Stage 3** (Behavior & Audible Voice Profile): `physical_description`, `habits`, `voice_signature`, `behavior_under_stress`
- **Stage 5** (Milestone Arc Timeline): `arc_type`, `initial_worldview`, `inciting_disruption`, `failed_resistance`, `midpoint_realization`, `crisis_choice`, `action_proven_transformation`, `new_identity`
- **Stage 6** (Continuity & Canon Rules, captured as part of sign-off itself): `continuity_notes`

`isKnownFieldId` is unchanged (already generic over whatever's in the array).

### `web/system-prompts/sp02-cdc-systemprompt.md` (extended)

Stage 1/3/5/6 descriptions (§5) updated to name their new trackable fields explicitly, mirroring how Stage 2's description already names its causal chain. Section 7 (Structured Output Contract) is unaffected — `updates`' mechanism doesn't change, only which field names are valid for it. The turn schema's `updates` tool-property description ("most turns during Stages 1, 3, 4, 5, and 6 will have none, since only the Psychological Engine's fields (Stage 2) are tracked as facts today") becomes false once this ships and must be corrected in the same pass.

### `web/src/lib/canonEngine/storyStore.ts` (extended)

`StoredOutstandingQuestion` gains `charId?: string`.

New collection and functions, mirroring `appendCharacterConflictLog`'s shape:
```ts
export interface CharacterBibleEntry {
  charId: string;
  metadata: {
    character_name: string;
    age: string;
    occupation: string;
    story_role: string;
    narrative_importance: string; // tier, e.g. "Critical"
    development_depth: string;   // depth label, e.g. "Exhaustive"
    arc_type: string;
    canon_status: "Signed Off";
  };
  story_function: {
    narrative_purpose: string;
    protagonist_relationship: string;
    conflict_contribution: string;
    thematic_thesis: string;
  };
  psychological_engine: {
    want: string; personality_how: string; need: string; values: string;
    life_experience: string; core_wound: string; false_belief: string;
    core_flaw: string; dominant_fear: string; defense_mechanisms: string;
    behavioral_trajectory: string;
  };
  behavior_voice_profile: {
    physical_description: string; habits: string; voice_signature: string;
    behavior_under_stress: string;
  };
  ensemble_interconnection_registry: {
    with: string; dynamic: string; trust_trajectory: string; power_dynamic: string;
  }[];
  milestone_arc_timeline: {
    initial_worldview: string; inciting_disruption: string; failed_resistance: string;
    midpoint_realization: string; crisis_choice: string;
    action_proven_transformation: string; new_identity: string;
  };
  continuity_canon_rules: string;
  outstanding_questions: { item: string; defer_to: string | null; notes: string }[];
  signed_off_at: string;
}
```
`appendCharacterBibleEntry(storyId, entry): Promise<{ ok: true } | { ok: false; alreadyExists: true }>` — reads the doc first (keyed by `charId`); if present, returns `{ ok: false, alreadyExists: true }` without writing (caller logs, doesn't crash the turn); else writes and returns `{ ok: true }`.
`listCharacterBibleEntries(storyId): Promise<CharacterBibleEntry[]>` — for #35's later consumption.

### New module `web/src/lib/characterEngine/characterBibleCompiler.ts`

Pure function, mirroring `foundationDoc.ts`'s `confirmedValue`-style helpers (only `status === "Confirmed"` elements contribute a value; everything else renders as an empty string — matching AC2's "only Confirmed facts appear"):

```ts
export function compileCharacterBibleEntry(params: {
  charId: string;
  characterName: string;
  storyRole: string;
  tier: string;
  depthLabel: string;
  facts: CanonElement[];        // this character's characterFacts elements
  relationships: CanonElement[]; // this character's characterRelationships elements
  outstandingQuestions: StoredOutstandingQuestion[]; // pre-filtered to this charId
  signedOffAt: string;
}): CharacterBibleEntry
```

### `web/src/app/api/character-chat/route.ts` (extended)

On a turn where `resolution.status === "signed_off"` and the character was **not** already `signed_off` before this turn (a fresh transition — checked against `p2State.characterProgress[charId]?.status`, which already holds the pre-turn snapshot since `p2State` is loaded once from `story.p2` before the model call and `resolveCharacterTurn` is pure, the same "before" pattern issue #30 already established for `pendingConflictBefore`): fetch this character's Confirmed facts (`listElements(storyId, CHARACTER_FACTS_COLLECTION)`, filtered to `element_id` starting with `${charId}.`), relationships (same pattern against `CHARACTER_RELATIONSHIPS_COLLECTION`), and outstanding questions (`listOutstandingQuestions(storyId)`, filtered to `charId`); compile via `compileCharacterBibleEntry`; persist via `appendCharacterBibleEntry`. On `{ ok: false, alreadyExists: true }`, log a warning and continue — never surfaces as an error to the author.

**Ordering requirement:** this fetch-compile-persist step must run *after* this same turn's own `applyStateDelta` calls for facts and relationships have completed (not before). A character can plausibly confirm their final psychological fact or relationship entry on the exact same turn they sign off (Stage 6 is "Sign-Off & Compile," immediately after Stage 5) — compiling from stale, pre-this-turn `listElements` results would silently omit that turn's own confirmations from the permanent entry.

Also: the `deferred_items` → `appendOutstandingQuestions` call (issue #32) starts populating the new `charId` field with the current turn's `charId`, closing decision 5's retrofit in the same file.

## Error Handling

No new failure modes beyond the already-established `alreadyExists` no-op. If fact/relationship/outstanding-question fetches fail, that's an existing infrastructure failure mode (Firestore read error), not something this issue introduces new handling for.

## Testing

No automated test framework exists in this repo (established convention). Verification is `npm run lint && npm run build`, plus a manual read-through confirming:
- A character with all 11 Stage 2 facts Confirmed, one relationship entry Confirmed, and zero Stage 1/3/5/6 facts captured: `psychological_engine` and `ensemble_interconnection_registry` are fully populated, `story_function`/`behavior_voice_profile`/`milestone_arc_timeline`/`continuity_canon_rules` render as empty strings (not missing keys, not thrown errors) — the compiler is total over whatever's actually been captured.
- A fact that's `Working` (not `Confirmed`) for a new Stage 1/3/5/6 field does not appear in the compiled entry (matches AC2).
- Compiling the same `charId` a second time (simulating a re-triggered sign-off) results in `{ ok: false, alreadyExists: true }`, no write, and the original entry's content is byte-for-byte unchanged (matches AC3).
- `Outstanding Character Questions` in one character's compiled entry only includes items whose `charId` matches that character — not another character's deferred items, and not P1-originated items (which have no `charId` at all).
- The turn schema/route change (#32 retrofit) confirms newly-deferred items from this point forward carry the correct `charId`; pre-existing entries without one are simply excluded from every character's compiled Outstanding Questions section (not an error, not a crash).
