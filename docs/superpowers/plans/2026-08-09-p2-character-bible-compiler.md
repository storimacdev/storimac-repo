# P2 Stage 6 Sign-Off Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #34 — compile a signed-off character's profile into CDRM §7's fixed 8-part specification and append it, permanently, to a running master Character Bible.

**Architecture:** Extends `factRegistry.ts`'s field vocabulary with 19 new fields (Stage 1/3/5/6, derived directly from CDRM §7's per-section descriptions and §5's named milestones/arc types) so three previously-untracked sections have real Confirmed data to compile from. A new pure compiler module builds a `CharacterBibleEntry` from already-Confirmed facts/relationships/outstanding-questions; a new `characterBibleEntries` collection persists each character's entry exactly once via a read-then-write check (never a `.create()`-and-catch pattern, since this codebase has no verified precedent for that error shape). The route triggers compilation on a fresh sign-off transition, after this turn's own writes complete.

**Tech Stack:** TypeScript, Firestore (via `firebase-admin`), Zod (unchanged — no new turn-schema fields needed; compilation reads already-existing `updates`/`relationship_updates`/`deferred_items`).

## Global Constraints

- 19 new field IDs are added to `CHARACTER_FIELD_IDS` (extending the single existing array, not creating a parallel one), grouped by stage: Stage 1 (`age`, `occupation`, `narrative_purpose`, `protagonist_relationship`, `conflict_contribution`, `thematic_thesis`), Stage 3 (`physical_description`, `habits`, `voice_signature`, `behavior_under_stress`), Stage 5 (`arc_type`, `initial_worldview`, `inciting_disruption`, `failed_resistance`, `midpoint_realization`, `crisis_choice`, `action_proven_transformation`, `new_identity`), Stage 6 (`continuity_notes`).
- New field values stay free text — no app-level enum validation on `arc_type` or anything else, matching the established Stage 2 precedent (only field *names* are a closed vocabulary).
- Only `status === "Confirmed"` elements contribute a value to the compiled entry (AC2) — everything else renders as an empty string, never a thrown error or a missing key.
- Persistence uses a read-then-write check (`appendCharacterBibleEntry`), never a `.create()`-and-catch pattern.
- Compilation triggers only on a *fresh* transition to `signed_off` this turn (not already `signed_off` before), and runs *after* this same turn's own fact/relationship/deferred-item writes — a character can confirm their final fact or relationship on the exact turn they sign off.
- `StoredOutstandingQuestion.charId` is optional — every pre-existing entry (P1-originated, and every #32 entry written before this retrofit) lacks it and must not error or be treated specially, just excluded from every character's compiled Outstanding Questions.
- Compilation and rendering stay split: this plan does not build a Markdown/docx renderer — that's issue #35.
- No changes to `canonStore.ts`, `characterFsm.ts`, `causalChain.ts`, `foundationConflict.ts`, or any Project 1 file.

---

### Task 1: Extend the field vocabulary for Stages 1, 3, 5, 6

**Files:**
- Modify: `web/src/lib/characterEngine/factRegistry.ts`

**Interfaces:**
- Produces: `CHARACTER_FIELD_IDS` gaining 19 new entries — consumed by Task 4 (compiler) and already-consumed-generically by `characterTurnSchema.ts`'s existing `enum: CHARACTER_FIELD_IDS` references (no schema code change needed there; the enum is already sourced dynamically from this array).

- [ ] **Step 1: Update the header comment**

Find:
```ts
 * Deliberately scoped to only what's explicitly named in the PRD/CDRM and
 * issue #28 today: the corrected Triad+Need, and the causal psychology
 * chain. Stages 1, 3, 4, 5, and 6's field vocabularies aren't fixed in the
 * source docs yet - inventing names for them now would risk the same
 * sibling-collision bug Project 1 just had fixed, self-inflicted this
 * time. Extend this array (don't create a parallel one) when a later
 * issue (#34 compiler, or whichever issue covers Stage 1/3/5's fields)
 * defines more single-character fields. Issue #31 (relationships) turned
 * out NOT to extend this array - a relationship's key is the other
 * character's ID, which can't be a fixed enum, so it got its own
 * collection (CHARACTER_RELATIONSHIPS_COLLECTION below) and its own turn-
 * schema shape (characterTurnSchema.ts's relationship_updates) instead.
 */
```
Replace:
```ts
 * Deliberately scoped to only what's explicitly named in the PRD/CDRM and
 * issue #28 today: the corrected Triad+Need, and the causal psychology
 * chain (Stage 2). Issue #34 (Stage 6 sign-off compiler) extended this
 * array with Stage 1/3/5/6 fields, derived directly from CDRM §7's exact
 * per-section descriptions and §5's seven named Milestone Arc Timeline
 * beats - not guessed. Issue #31 (relationships) did NOT extend this
 * array - a relationship's key is the other character's ID, which can't
 * be a fixed enum, so it got its own collection
 * (CHARACTER_RELATIONSHIPS_COLLECTION below) and its own turn-schema
 * shape (characterTurnSchema.ts's relationship_updates) instead.
 */
```

- [ ] **Step 2: Add the 19 new field IDs**

Find:
```ts
export const CHARACTER_FIELD_IDS: string[] = [
  // Corrected Triad + Need (issue #28's corrected AC, PRD §5.3)
  "want",
  "personality_how",
  "need",
  "values",
  // Causal psychology chain (PRD §5.3, CDRM §3): Life Experience ->
  // Core Wound -> False Belief -> Core Flaw -> Dominant Fear ->
  // Defense Mechanisms -> Behavioral Trajectory
  "life_experience",
  "core_wound",
  "false_belief",
  "core_flaw",
  "dominant_fear",
  "defense_mechanisms",
  "behavioral_trajectory",
];
```
Replace:
```ts
export const CHARACTER_FIELD_IDS: string[] = [
  // Corrected Triad + Need (issue #28's corrected AC, PRD §5.3)
  "want",
  "personality_how",
  "need",
  "values",
  // Causal psychology chain (PRD §5.3, CDRM §3): Life Experience ->
  // Core Wound -> False Belief -> Core Flaw -> Dominant Fear ->
  // Defense Mechanisms -> Behavioral Trajectory
  "life_experience",
  "core_wound",
  "false_belief",
  "core_flaw",
  "dominant_fear",
  "defense_mechanisms",
  "behavioral_trajectory",
  // Stage 1 - Story Function & Integration Map + basic identity (issue
  // #34, CDRM §7 section 2's exact description)
  "age",
  "occupation",
  "narrative_purpose",
  "protagonist_relationship",
  "conflict_contribution",
  "thematic_thesis",
  // Stage 3 - Behavior & Audible Voice Profile (issue #34, CDRM §7
  // section 4's exact description)
  "physical_description",
  "habits",
  "voice_signature",
  "behavior_under_stress",
  // Stage 5 - Milestone Arc Timeline + Arc Type (issue #34, CDRM §5's
  // three named arc types and seven named milestone beats)
  "arc_type",
  "initial_worldview",
  "inciting_disruption",
  "failed_resistance",
  "midpoint_realization",
  "crisis_choice",
  "action_proven_transformation",
  "new_identity",
  // Stage 6 - Continuity & Canon Rules, captured as part of sign-off
  // itself (issue #34, CDRM §7 section 7)
  "continuity_notes",
];
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/factRegistry.ts
git commit -m "feat: extend P2 field vocabulary for Stages 1, 3, 5, 6 (#34)"
```

---

### Task 2: Update sp02 prompt and correct the stale turn-schema description

**Files:**
- Modify: `web/system-prompts/sp02-cdc-systemprompt.md`
- Modify: `web/src/lib/characterEngine/characterTurnSchema.ts`

**Interfaces:**
- No new exports. Purely descriptive text changes so the model actually captures the new fields, and so the tool schema no longer claims something false about which stages produce facts.

Independent of Task 1 (no shared code) - order between them doesn't matter, but both are prerequisites for the fields to actually get populated during real use.

- [ ] **Step 1: Update sp02's Stage 1/3/5/6 descriptions**

Find:
```
Stage 1 — Position & Purpose: Narrative role, importance level, exact justification for existence. Eliminate duplicate roles.
Stage 2 — The Psychological Core: Core Wound -> False Belief -> Core Flaw -> Fear/Desire Matrix -> Want vs. Need.
Stage 3 — Outward Identity & Voice: Physical requirements, habits, distinct linguistic signature.
Stage 4 — Relationship Integration: Position within the cast network, power dynamics, trust parameters, tension sources.
Stage 5 — Transformational Arc Pacing: Internal movement across the Story Spine milestones; a brief Creative Audit for cliché or weak proactivity.
Stage 6 — Sign-Off & Compile: Present the finalized profile for the author's formal confirmation, then append to the Character Bible.
```
Replace:
```
Stage 1 — Position & Purpose: Narrative role, importance level, exact justification for existence. Eliminate duplicate roles. Track as facts: age, occupation, narrative_purpose, protagonist_relationship, conflict_contribution, thematic_thesis.
Stage 2 — The Psychological Core: Core Wound -> False Belief -> Core Flaw -> Fear/Desire Matrix -> Want vs. Need.
Stage 3 — Outward Identity & Voice: Physical requirements, habits, distinct linguistic signature. Track as facts: physical_description, habits, voice_signature, behavior_under_stress.
Stage 4 — Relationship Integration: Position within the cast network, power dynamics, trust parameters, tension sources.
Stage 5 — Transformational Arc Pacing: Internal movement across the Story Spine milestones; a brief Creative Audit for cliché or weak proactivity. Track as facts: arc_type (Positive Change Arc, Negative Change/Fall Arc, or Flat Arc), and the character's state at each of the seven milestones: initial_worldview, inciting_disruption, failed_resistance, midpoint_realization, crisis_choice, action_proven_transformation, new_identity.
Stage 6 — Sign-Off & Compile: Present the finalized profile for the author's formal confirmation, capture continuity_notes (fixed facts, hidden secrets, known history, physical/emotional boundaries the compiled Character Bible needs to stay consistent), then append to the Character Bible.
```

- [ ] **Step 2: Correct characterTurnSchema.ts's header comment**

Find:
```ts
 * `updates`' `field` enum is deliberately scoped to only the Psychological
 * Engine's 11 known fields (factRegistry.ts) - see that file's own comment
 * for why the other 5 interview stages aren't covered yet. `switch_override`
```
Replace:
```ts
 * `updates`' `field` enum is sourced from factRegistry.ts's
 * CHARACTER_FIELD_IDS, covering Stage 2's 11 Psychological Engine fields
 * plus Stage 1/3/5/6's fields added by issue #34 - see that file's own
 * comment for the full breakdown. `switch_override`
```

- [ ] **Step 3: Correct the now-stale `updates` tool-property description**

Find:
```ts
      updates: {
        type: "array",
        description:
          "Canon fact changes proposed this turn, for current_character only. Empty array if none - most turns during Stages 1, 3, 4, 5, and 6 will have none, since only the Psychological Engine's fields (Stage 2) are tracked as facts today.",
```
Replace:
```ts
      updates: {
        type: "array",
        description:
          "Canon fact changes proposed this turn, for current_character only. Empty array if none. Stage 4 (Relationship Integration) has no fields of its own here - see relationship_updates instead.",
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (the sp02 file is markdown, not compiled - this step mainly verifies the `.ts` edit).

- [ ] **Step 5: Commit**

```bash
git add web/system-prompts/sp02-cdc-systemprompt.md web/src/lib/characterEngine/characterTurnSchema.ts
git commit -m "feat: instruct P2's Stage 1/3/5/6 field capture, fix stale schema description (#34)"
```

---

### Task 3: Persist Character Bible entries and retrofit charId onto outstanding questions

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `StoredOutstandingQuestion.charId?: string`, `CharacterBibleEntry` (interface), `appendCharacterBibleEntry(storyId, entry): Promise<{ok:true}|{ok:false,alreadyExists:true}>`, `listCharacterBibleEntries(storyId): Promise<CharacterBibleEntry[]>` — all consumed by Task 4 (type only) and Task 5 (route wiring).

- [ ] **Step 1: Add `charId` to `StoredOutstandingQuestion`**

Find:
```ts
export interface StoredOutstandingQuestion {
  item: string;
  defer_to: "Project 2" | "Project 3" | "Project 4" | "Project 5" | null;
  notes: string;
  ts: string;
}
```
Replace:
```ts
export interface StoredOutstandingQuestion {
  item: string;
  defer_to: "Project 2" | "Project 3" | "Project 4" | "Project 5" | null;
  notes: string;
  ts: string;
  /** The P2 character this item was deferred from, if any (issue #34's
   * retrofit) - optional/absent on every P1-originated entry and every
   * issue #32 entry written before this field existed. */
  charId?: string;
}
```

- [ ] **Step 2: Add `CharacterBibleEntry` and its persistence functions**

Find:
```ts
/** Appends a resolved conflict to Project 2's conflicts log (issue #30). */
export async function appendCharacterConflictLog(
  storyId: string,
  entry: CharacterConflictLogEntry
): Promise<void> {
  await characterConflictsLogCollection(storyId).add(entry);
}

/** Appends an author-type re-assessment (issue #8 calls this) without clobbering prior history. */
```
Replace:
```ts
/** Appends a resolved conflict to Project 2's conflicts log (issue #30). */
export async function appendCharacterConflictLog(
  storyId: string,
  entry: CharacterConflictLogEntry
): Promise<void> {
  await characterConflictsLogCollection(storyId).add(entry);
}

/** Project 2's compiled, permanent Character Bible entries (issue #34,
 * CDRM §7) - one per signed-off character, written exactly once. */
export interface CharacterBibleEntry {
  charId: string;
  metadata: {
    character_name: string;
    age: string;
    occupation: string;
    story_role: string;
    narrative_importance: string;
    development_depth: string;
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
    want: string;
    personality_how: string;
    need: string;
    values: string;
    life_experience: string;
    core_wound: string;
    false_belief: string;
    core_flaw: string;
    dominant_fear: string;
    defense_mechanisms: string;
    behavioral_trajectory: string;
  };
  behavior_voice_profile: {
    physical_description: string;
    habits: string;
    voice_signature: string;
    behavior_under_stress: string;
  };
  ensemble_interconnection_registry: {
    with: string;
    dynamic: string;
    trust_trajectory: string;
    power_dynamic: string;
  }[];
  milestone_arc_timeline: {
    initial_worldview: string;
    inciting_disruption: string;
    failed_resistance: string;
    midpoint_realization: string;
    crisis_choice: string;
    action_proven_transformation: string;
    new_identity: string;
  };
  continuity_canon_rules: string;
  outstanding_questions: { item: string; defer_to: string | null; notes: string }[];
  signed_off_at: string;
}

function characterBibleEntriesCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("characterBibleEntries");
}

/** Persists a character's compiled Character Bible entry exactly once
 * (issue #34, AC: "prior characters' entries are never overwritten").
 * Uses a read-then-write check rather than a create()-and-catch pattern -
 * matches the established isAlreadyConfirmed-style convention already
 * proven in issues #28/#30/#31, and avoids relying on an unverified
 * Firestore error-code shape for "already exists". */
export async function appendCharacterBibleEntry(
  storyId: string,
  entry: CharacterBibleEntry
): Promise<{ ok: true } | { ok: false; alreadyExists: true }> {
  const ref = characterBibleEntriesCollection(storyId).doc(entry.charId);
  const existing = await ref.get();
  if (existing.exists) {
    return { ok: false, alreadyExists: true };
  }
  await ref.set(entry);
  return { ok: true };
}

export async function listCharacterBibleEntries(storyId: string): Promise<CharacterBibleEntry[]> {
  const snap = await characterBibleEntriesCollection(storyId).get();
  return snap.docs.map((d) => d.data() as CharacterBibleEntry);
}

/** Appends an author-type re-assessment (issue #8 calls this) without clobbering prior history. */
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: persist P2 Character Bible entries, retrofit charId onto outstanding questions (#34)"
```

---

### Task 4: Character Bible compiler module

**Files:**
- Create: `web/src/lib/characterEngine/characterBibleCompiler.ts`

**Interfaces:**
- Consumes: `type CanonElement` from `@/lib/canonEngine/types`; `type CharacterBibleEntry`, `type StoredOutstandingQuestion` from `@/lib/canonEngine/storyStore` (Task 3).
- Produces: `type CompileCharacterBibleEntryParams`, `compileCharacterBibleEntry(params): CharacterBibleEntry` — consumed by Task 5.

This task depends on Task 3 for its imported types (order matters: Task 3 before Task 4). Independent of Tasks 1/2.

- [ ] **Step 1: Create the file**

```ts
import type { CanonElement } from "@/lib/canonEngine/types";
import type { CharacterBibleEntry, StoredOutstandingQuestion } from "@/lib/canonEngine/storyStore";

/**
 * Project 2 Stage 6 sign-off compiler — GitHub issue #34, design:
 * docs/superpowers/specs/2026-08-09-p2-character-bible-compiler-design.md.
 * Pure, I/O-free (mirrors foundationDoc.ts's compileFoundationDocument /
 * characterFsm.ts's/causalChain.ts's split from their own I/O-bound
 * callers). Only Confirmed elements contribute a value - matches AC2
 * ("only Confirmed facts appear in the compiled entry") exactly, the
 * same posture foundationDoc.ts's confirmedValue helper already takes
 * for Project 1's Stage 8 document.
 *
 * Callers pass the FULL story-wide facts/relationships/outstanding-
 * questions lists (not pre-filtered) - this module does its own
 * charId-prefix filtering, keeping "only this character's data" as a
 * single, testable invariant rather than trusting every call site to
 * have filtered correctly upstream.
 */

type ElementMap = Map<string, CanonElement>;

function byField(elements: CanonElement[], charId: string): ElementMap {
  const map: ElementMap = new Map();
  const prefix = `${charId}.`;
  for (const e of elements) {
    if (e.element_id.startsWith(prefix)) {
      map.set(e.element_id.slice(prefix.length), e);
    }
  }
  return map;
}

function confirmedStr(byId: ElementMap, field: string): string {
  const e = byId.get(field);
  if (!e || e.status !== "Confirmed") return "";
  if (typeof e.value === "string") return e.value;
  if (e.value === null || e.value === undefined) return "";
  return JSON.stringify(e.value);
}

export interface CompileCharacterBibleEntryParams {
  charId: string;
  characterName: string;
  storyRole: string;
  tier: string;
  depthLabel: string;
  /** This story's full characterFacts elements (all characters) - filtered internally to charId. */
  facts: CanonElement[];
  /** This story's full characterRelationships elements (all characters) - filtered internally to charId. */
  relationships: CanonElement[];
  /** This story's full outstanding-questions list (all sources) - filtered internally to charId. */
  outstandingQuestions: StoredOutstandingQuestion[];
  signedOffAt: string;
}

export function compileCharacterBibleEntry(params: CompileCharacterBibleEntryParams): CharacterBibleEntry {
  const {
    charId,
    characterName,
    storyRole,
    tier,
    depthLabel,
    facts,
    relationships,
    outstandingQuestions,
    signedOffAt,
  } = params;

  const factsById = byField(facts, charId);
  const relationshipPrefix = `${charId}.`;

  const ensemble = relationships
    .filter((e) => e.status === "Confirmed" && e.element_id.startsWith(relationshipPrefix))
    .map((e) => {
      const v = (e.value ?? {}) as { dynamic?: string; trust_trajectory?: string; power_dynamic?: string };
      return {
        with: e.element_id.slice(relationshipPrefix.length),
        dynamic: v.dynamic ?? "",
        trust_trajectory: v.trust_trajectory ?? "",
        power_dynamic: v.power_dynamic ?? "",
      };
    });

  return {
    charId,
    metadata: {
      character_name: characterName,
      age: confirmedStr(factsById, "age"),
      occupation: confirmedStr(factsById, "occupation"),
      story_role: storyRole,
      narrative_importance: tier,
      development_depth: depthLabel,
      arc_type: confirmedStr(factsById, "arc_type"),
      canon_status: "Signed Off",
    },
    story_function: {
      narrative_purpose: confirmedStr(factsById, "narrative_purpose"),
      protagonist_relationship: confirmedStr(factsById, "protagonist_relationship"),
      conflict_contribution: confirmedStr(factsById, "conflict_contribution"),
      thematic_thesis: confirmedStr(factsById, "thematic_thesis"),
    },
    psychological_engine: {
      want: confirmedStr(factsById, "want"),
      personality_how: confirmedStr(factsById, "personality_how"),
      need: confirmedStr(factsById, "need"),
      values: confirmedStr(factsById, "values"),
      life_experience: confirmedStr(factsById, "life_experience"),
      core_wound: confirmedStr(factsById, "core_wound"),
      false_belief: confirmedStr(factsById, "false_belief"),
      core_flaw: confirmedStr(factsById, "core_flaw"),
      dominant_fear: confirmedStr(factsById, "dominant_fear"),
      defense_mechanisms: confirmedStr(factsById, "defense_mechanisms"),
      behavioral_trajectory: confirmedStr(factsById, "behavioral_trajectory"),
    },
    behavior_voice_profile: {
      physical_description: confirmedStr(factsById, "physical_description"),
      habits: confirmedStr(factsById, "habits"),
      voice_signature: confirmedStr(factsById, "voice_signature"),
      behavior_under_stress: confirmedStr(factsById, "behavior_under_stress"),
    },
    ensemble_interconnection_registry: ensemble,
    milestone_arc_timeline: {
      initial_worldview: confirmedStr(factsById, "initial_worldview"),
      inciting_disruption: confirmedStr(factsById, "inciting_disruption"),
      failed_resistance: confirmedStr(factsById, "failed_resistance"),
      midpoint_realization: confirmedStr(factsById, "midpoint_realization"),
      crisis_choice: confirmedStr(factsById, "crisis_choice"),
      action_proven_transformation: confirmedStr(factsById, "action_proven_transformation"),
      new_identity: confirmedStr(factsById, "new_identity"),
    },
    continuity_canon_rules: confirmedStr(factsById, "continuity_notes"),
    outstanding_questions: outstandingQuestions
      .filter((q) => q.charId === charId)
      .map((q) => ({ item: q.item, defer_to: q.defer_to, notes: q.notes })),
    signed_off_at: signedOffAt,
  };
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the function:
- A character with all 11 Stage 2 facts `Confirmed`, one relationship `Confirmed`, and zero Stage 1/3/5/6 facts: `psychological_engine` fully populated with each field's actual value; `ensemble_interconnection_registry` has one entry; `story_function`/`behavior_voice_profile`/`milestone_arc_timeline`/`continuity_canon_rules` are all empty strings (`confirmedStr` returns `""` when `byId.get(field)` is `undefined`), never a thrown error.
- A fact with `status: "Working"` for `age`: `confirmedStr(factsById, "age")` returns `""`, not the Working value (matches AC2).
- Two characters' facts both present in the `facts` array (simulating the "full story-wide list" the route will actually pass): `byField(facts, charId)` for character A only includes entries whose `element_id` starts with `"a_charid."`, never leaking character B's fields.
- An `outstandingQuestions` array containing entries with `charId: "a"`, `charId: "b"`, and no `charId` at all (a P1-originated entry): compiling for `charId: "a"` includes only the first, correctly excluding both the other character's item and the unattributed P1 item.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/characterBibleCompiler.ts
git commit -m "feat: add P2 Character Bible compiler module (#34)"
```

---

### Task 5: Wire sign-off compilation into the chat route

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `listOutstandingQuestions`, `appendCharacterBibleEntry` from `@/lib/canonEngine/storyStore` (Task 3); `compileCharacterBibleEntry` from `@/lib/characterEngine/characterBibleCompiler` (Task 4).

- [ ] **Step 1: Add the new imports**

Find:
```ts
import {
  getStory,
  appendMessage,
  listMessages,
  CHARACTER_MESSAGES_COLLECTION,
  setP2State,
  type P2State,
  setP2PendingConflict,
  appendCharacterConflictLog,
  appendOutstandingQuestions,
  type StoredOutstandingQuestion,
} from "@/lib/canonEngine/storyStore";
```
Replace:
```ts
import {
  getStory,
  appendMessage,
  listMessages,
  CHARACTER_MESSAGES_COLLECTION,
  setP2State,
  type P2State,
  setP2PendingConflict,
  appendCharacterConflictLog,
  appendOutstandingQuestions,
  type StoredOutstandingQuestion,
  listOutstandingQuestions,
  appendCharacterBibleEntry,
} from "@/lib/canonEngine/storyStore";
```

Find:
```ts
import {
  CharacterTurnSchema,
  EMIT_CHARACTER_TURN_TOOL,
  type FactUpdateInput,
  type RelationshipUpdateInput,
} from "@/lib/characterEngine/characterTurnSchema";
```
Replace:
```ts
import {
  CharacterTurnSchema,
  EMIT_CHARACTER_TURN_TOOL,
  type FactUpdateInput,
  type RelationshipUpdateInput,
} from "@/lib/characterEngine/characterTurnSchema";
import { compileCharacterBibleEntry } from "@/lib/characterEngine/characterBibleCompiler";
```

- [ ] **Step 2: Capture whether the character was already signed off before this turn**

Find:
```ts
    const charId = resolveCharId(delta.current_character, foundation.cast, turnId);
    const resolution = resolveCharacterTurn(
```
Replace:
```ts
    const charId = resolveCharId(delta.current_character, foundation.cast, turnId);
    const wasSignedOffBefore = p2State.characterProgress[charId]?.status === "signed_off";
    const resolution = resolveCharacterTurn(
```

- [ ] **Step 3: Populate `charId` on newly-deferred outstanding questions**

Find:
```ts
    if (delta.deferred_items.length > 0) {
      const outstandingQuestions: Omit<StoredOutstandingQuestion, "ts">[] = delta.deferred_items.map((d) => ({
        item: d.item,
        defer_to: d.defer_to_project,
        notes: d.notes,
      }));
```
Replace:
```ts
    if (delta.deferred_items.length > 0) {
      const outstandingQuestions: Omit<StoredOutstandingQuestion, "ts">[] = delta.deferred_items.map((d) => ({
        item: d.item,
        defer_to: d.defer_to_project,
        notes: d.notes,
        charId,
      }));
```

- [ ] **Step 4: Trigger compilation on a fresh sign-off transition**

Find:
```ts
      await appendOutstandingQuestions(storyId, outstandingQuestions);
    }

    if (conflictResult.logEntry) {
```
Replace:
```ts
      await appendOutstandingQuestions(storyId, outstandingQuestions);
    }

    // Stage 6 sign-off compilation (issue #34) - only on a FRESH
    // transition to signed_off this turn (wasSignedOffBefore captured
    // from p2State, the pre-turn snapshot, before resolveCharacterTurn
    // ran). Runs after this turn's own fact/relationship/deferred-item
    // writes above, so a character who confirms their final fact on the
    // same turn they sign off (Stage 6 immediately follows Stage 5) gets
    // a complete entry.
    if (!wasSignedOffBefore && resolution.status === "signed_off") {
      const [characterFacts, characterRelationships, outstandingQuestionsForCompile] = await Promise.all([
        listElements(storyId, CHARACTER_FACTS_COLLECTION),
        listElements(storyId, CHARACTER_RELATIONSHIPS_COLLECTION),
        listOutstandingQuestions(storyId),
      ]);
      const compiled = compileCharacterBibleEntry({
        charId,
        characterName: delta.current_character,
        storyRole: foundation.cast[castIndex]?.story_role ?? "",
        tier: tier ?? "",
        depthLabel: tier ? getDepthLabel(tier) : "",
        facts: characterFacts,
        relationships: characterRelationships,
        outstandingQuestions: outstandingQuestionsForCompile,
        signedOffAt: new Date().toISOString(),
      });
      const compileResult = await appendCharacterBibleEntry(storyId, compiled);
      if (compileResult.ok) {
        console.warn(`[character-chat] compiled Character Bible entry for ${charId} on turn ${turnId}`);
      } else {
        console.warn(
          `[character-chat] Character Bible entry for ${charId} already exists on turn ${turnId} - not overwritten`
        );
      }
    }

    if (conflictResult.logEntry) {
```

- [ ] **Step 5: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Manual read-through check**

Confirm by reading the edited function:
- A turn where `wasSignedOffBefore` is `false` and `resolution.status` is `"in_progress"`: the compilation block's `if` doesn't fire — no extra Firestore reads, no compile call. Confirms the common-case (most turns) path stays exactly as cheap as before this change.
- A turn where `wasSignedOffBefore` is `false` and `resolution.status` becomes `"signed_off"` (fresh sign-off): `characterFacts`/`characterRelationships`/`outstandingQuestionsForCompile` are fetched, `compileCharacterBibleEntry` is called with `tier`/`depthLabel` derived from the already-computed `matrix`/`castIndex` (no new tier computation), and `appendCharacterBibleEntry` persists it.
- A turn where `wasSignedOffBefore` is `true` (the character was already signed off in a prior turn) and `resolution.status` is somehow `"signed_off"` again (the re-trigger scenario characterFsm.ts's stage-clamp logic permits): the `if` condition's `!wasSignedOffBefore` is `false`, so the block doesn't fire at all — no redundant compile attempt, no log noise. (This is stricter than relying on `appendCharacterBibleEntry`'s own already-exists check alone - it avoids even the extra Firestore reads for a case the route already knows won't need them.)
- `foundation.cast[castIndex]?.story_role` - `castIndex` is the same variable already computed earlier in the function (`foundation.cast.findIndex((m) => slugifyCharacterName(m.name) === charId)`) - confirm no duplicate computation was introduced.
- The compile block sits after both `factUpdates`/`relationshipUpdates` `applyStateDelta` calls and after the `deferred_items` append - confirm by reading the surrounding code that no later addition to this plan (or dependency on this plan) accidentally moved it earlier.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: trigger P2 Character Bible compilation on Stage 6 sign-off (#34)"
```
