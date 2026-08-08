# P2 Relationship Graph & Ripple-Effect Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #31 — track a lightweight character-to-character relationship graph, and surface it as grounding so the model can evaluate ripple effects before confirming a psychological change to an already-signed-off character (no hard gate — surfacing only, per AC2's own wording).

**Architecture:** Relationships reuse the already-generalized Canon Engine as a third collection (`characterRelationships`), populated via a new `relationship_updates` array on the turn schema (separate from `updates`, since a relationship's key is another character's ID, which can't be a fixed enum). The route injects every already-signed-off character's relationship entries into the system prompt every turn, unconditionally — the system prompt is built before the model reveals which character it's about to discuss, so there's no way to condition the grounding on "the character being revised" in advance.

**Tech Stack:** TypeScript, Firestore (via `firebase-admin`), Zod, Anthropic tool-use.

## Global Constraints

- No hard gate. Ripple checks are surfaced via grounding only — no pending-state tracking, no blocking, no new "resolution" concept (unlike issue #30). sp02 §4 already instructs the model to consider ripple effects; this plan only supplies the data for that instruction to act on.
- `dynamic`/`trust_trajectory`/`power_dynamic` are required together on every `relationship_updates` entry, never independently optional — `canonStore.ts`'s `applyStateDelta` replaces `value` wholesale when provided at all, it does not deep-merge sub-fields, so a partial value would silently drop previously-stored sub-fields.
- Relationship-graph grounding is injected unconditionally for every already-`signed_off` character every turn, not conditionally on which character is about to be discussed — that isn't knowable before the model call. No new schema field verifies compliance; grounding is the entire mechanism.
- No changes to `canonStore.ts`, `causalChain.ts`, `characterFsm.ts`, `foundationConflict.ts`, or any Project 1 file. This plan touches `factRegistry.ts`, `characterTurnSchema.ts`, and `character-chat/route.ts` only.

---

### Task 1: Relationship collection constant

**Files:**
- Modify: `web/src/lib/characterEngine/factRegistry.ts`

**Interfaces:**
- Produces: `CHARACTER_RELATIONSHIPS_COLLECTION: string` — consumed by Task 3.

- [ ] **Step 1: Update the header comment**

Find:
```ts
 * Deliberately scoped to only what's explicitly named in the PRD/CDRM and
 * issue #28 today: the corrected Triad+Need, and the causal psychology
 * chain. Stages 1, 3, 4, 5, and 6's field vocabularies aren't fixed in the
 * source docs yet - inventing names for them now would risk the same
 * sibling-collision bug Project 1 just had fixed, self-inflicted this
 * time. Extend this array (don't create a parallel one) when a later
 * issue (#31 relationships, #34 compiler, or whichever issue covers
 * Stage 1/3/5's fields) defines more fields.
 */
```
Replace:
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

- [ ] **Step 2: Add the collection constant**

Find:
```ts
export function isKnownFieldId(id: string): boolean {
  return CHARACTER_FIELD_IDS.includes(id);
}
```
Replace:
```ts
export function isKnownFieldId(id: string): boolean {
  return CHARACTER_FIELD_IDS.includes(id);
}

/** Project 2's relationship-graph collection name (issue #31) - a second
 * P2 collection alongside CHARACTER_FACTS_COLLECTION, keyed by composite
 * IDs {charId}.{otherCharId} rather than {charId}.{field}, since a
 * relationship's "field name" would have to be the other character's ID -
 * which can't be a fixed enum like CHARACTER_FIELD_IDS since the cast is
 * dynamic per story. */
export const CHARACTER_RELATIONSHIPS_COLLECTION = "characterRelationships";
```

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/factRegistry.ts
git commit -m "feat: add P2 relationship-graph collection constant (#31)"
```

---

### Task 2: Add relationship_updates to the Project 2 turn schema

**Files:**
- Modify: `web/src/lib/characterEngine/characterTurnSchema.ts`

**Interfaces:**
- Produces: `RelationshipUpdateSchema`, `type RelationshipUpdateInput`, `CharacterTurnSchema`/`EMIT_CHARACTER_TURN_TOOL` gaining a required `relationship_updates` array — consumed by Task 3.

Independent of Task 1 (no shared code) - order between them doesn't matter, but Task 3 depends on both.

- [ ] **Step 1: Update the file's header comment**

Find:
```ts
 * `resolution` (issue #30) mirror Project 1's stateDelta.ts equivalents,
 * but with P2's own resolution vocabulary (revert/update_foundation/park)
 * since P2's conflict is against another project's document, not against
 * its own prior canon - see docs/superpowers/specs/2026-08-08-p2-foundation-conflict-detection-design.md.
 */
```
Replace:
```ts
 * `resolution` (issue #30) mirror Project 1's stateDelta.ts equivalents,
 * but with P2's own resolution vocabulary (revert/update_foundation/park)
 * since P2's conflict is against another project's document, not against
 * its own prior canon - see docs/superpowers/specs/2026-08-08-p2-foundation-conflict-detection-design.md.
 * `relationship_updates` (issue #31) is a separate array from `updates`,
 * not an extension of it - a relationship's key is the other character's
 * ID, which can't be a closed enum like CHARACTER_FIELD_IDS since the
 * cast is dynamic per story. See docs/superpowers/specs/2026-08-08-p2-relationship-graph-design.md.
 */
```

- [ ] **Step 2: Add `RelationshipUpdateSchema` and extend `CharacterTurnSchema`**

Find:
```ts
export type FactUpdateInput = z.infer<typeof FactUpdateSchema>;

export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  switch_override: z.boolean(),
  context: z.string().min(1),
  updates: z.array(FactUpdateSchema),
  conflict_detected: z.boolean(),
  conflict_description: z.string().optional(),
  resolution: z.enum(["revert", "update_foundation", "park"]).optional(),
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;
```
Replace:
```ts
export type FactUpdateInput = z.infer<typeof FactUpdateSchema>;

export const RelationshipUpdateSchema = z.object({
  with: z.string().min(1),
  dynamic: z.string().min(1),
  trust_trajectory: z.string().min(1),
  power_dynamic: z.string().min(1),
  state: z.enum(["Exploring", "Working", "Confirmed", "Deferred"]).optional(),
});

export type RelationshipUpdateInput = z.infer<typeof RelationshipUpdateSchema>;

export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  switch_override: z.boolean(),
  context: z.string().min(1),
  updates: z.array(FactUpdateSchema),
  conflict_detected: z.boolean(),
  conflict_description: z.string().optional(),
  resolution: z.enum(["revert", "update_foundation", "park"]).optional(),
  relationship_updates: z.array(RelationshipUpdateSchema),
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;
```

- [ ] **Step 3: Add the `relationship_updates` tool property and update `required`**

Find:
```ts
      resolution: {
        type: "string",
        enum: ["revert", "update_foundation", "park"],
        description:
          "Only set this during a Conflict Resolution turn (a system note will tell you when you're in one), after the author picks one of the three choices you presented: revert the proposal, update Story Foundation canon, or park the idea for later.",
      },
    },
    required: [
      "reply",
      "current_character",
      "current_stage",
      "character_signed_off",
      "switch_override",
      "context",
      "updates",
      "conflict_detected",
    ],
  },
};
```
Replace:
```ts
      resolution: {
        type: "string",
        enum: ["revert", "update_foundation", "park"],
        description:
          "Only set this during a Conflict Resolution turn (a system note will tell you when you're in one), after the author picks one of the three choices you presented: revert the proposal, update Story Foundation canon, or park the idea for later.",
      },
      relationship_updates: {
        type: "array",
        description:
          "Relationship-graph changes proposed this turn, for current_character's relationship to another cast member. Empty array if none - most turns will have none; this is primarily populated during Stage 4 (Relationship Integration). All of dynamic/trust_trajectory/power_dynamic are required together whenever an entry is proposed at all - always restate the full current snapshot, never just the part that changed.",
        items: {
          type: "object",
          properties: {
            with: {
              type: "string",
              description: "The other character's full name, exactly as it appears in the Story Foundation's cast list.",
            },
            dynamic: { type: "string", description: "The relationship's core nature (e.g. mentor-student, rivals, found family)." },
            trust_trajectory: { type: "string", description: "How trust between them is moving (e.g. growing, eroding, stable)." },
            power_dynamic: { type: "string", description: "Who holds power/authority in the dynamic, and how." },
            state: {
              type: "string",
              enum: ["Exploring", "Working", "Confirmed", "Deferred"],
              description: "This relationship entry's canon state, same meaning as a fact's state.",
            },
          },
          required: ["with", "dynamic", "trust_trajectory", "power_dynamic"],
        },
      },
    },
    required: [
      "reply",
      "current_character",
      "current_stage",
      "character_signed_off",
      "switch_override",
      "context",
      "updates",
      "conflict_detected",
      "relationship_updates",
    ],
  },
};
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/characterEngine/characterTurnSchema.ts
git commit -m "feat: add relationship_updates to the Project 2 turn schema (#31)"
```

---

### Task 3: Wire relationship persistence and ripple-check grounding into the chat route

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `CHARACTER_RELATIONSHIPS_COLLECTION` from `@/lib/characterEngine/factRegistry` (Task 1); `type RelationshipUpdateInput` from `@/lib/characterEngine/characterTurnSchema` (Task 2, already on the validated turn as `delta.relationship_updates`); `listElements` from `@/lib/canonEngine/canonStore` (already exists, not yet imported in this file).

- [ ] **Step 1: Add the new imports**

Find:
```ts
import { applyStateDelta, CanonConflictError, CHARACTER_FACTS_COLLECTION, type ElementUpdate } from "@/lib/canonEngine/canonStore";
```
Replace:
```ts
import { applyStateDelta, listElements, CanonConflictError, CHARACTER_FACTS_COLLECTION, type ElementUpdate } from "@/lib/canonEngine/canonStore";
```

Find:
```ts
import { isKnownFieldId } from "@/lib/characterEngine/factRegistry";
```
Replace:
```ts
import { isKnownFieldId, CHARACTER_RELATIONSHIPS_COLLECTION } from "@/lib/characterEngine/factRegistry";
```

Find:
```ts
import {
  CharacterTurnSchema,
  EMIT_CHARACTER_TURN_TOOL,
  type FactUpdateInput,
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
```

- [ ] **Step 2: Add the `toRelationshipUpdate` mapper**

Find:
```ts
function toFactUpdate(u: FactUpdateInput, charId: string): ElementUpdate {
  const patch: ElementUpdate["patch"] = {};
  if (u.value !== undefined) patch.value = u.value;
  if (u.state !== undefined) patch.status = u.state === "Deferred" ? "Parked" : u.state;
  if (u.rationale !== undefined) patch.rationale = u.rationale;
  if (u.depends_on !== undefined) patch.depends_on = u.depends_on.map((f) => `${charId}.${f}`);
  return { element_id: `${charId}.${u.field}`, patch };
}
```
Replace:
```ts
function toFactUpdate(u: FactUpdateInput, charId: string): ElementUpdate {
  const patch: ElementUpdate["patch"] = {};
  if (u.value !== undefined) patch.value = u.value;
  if (u.state !== undefined) patch.status = u.state === "Deferred" ? "Parked" : u.state;
  if (u.rationale !== undefined) patch.rationale = u.rationale;
  if (u.depends_on !== undefined) patch.depends_on = u.depends_on.map((f) => `${charId}.${f}`);
  return { element_id: `${charId}.${u.field}`, patch };
}

// Unlike toFactUpdate, value is always a complete { dynamic, trust_trajectory,
// power_dynamic } object - all three are schema-required together (issue
// #31's design decision: canonStore.ts replaces `value` wholesale, it
// doesn't deep-merge sub-fields, so a partial value here would silently
// drop whichever sub-fields weren't provided).
function toRelationshipUpdate(u: RelationshipUpdateInput, charId: string, withCharId: string): ElementUpdate {
  const patch: ElementUpdate["patch"] = {
    value: { dynamic: u.dynamic, trust_trajectory: u.trust_trajectory, power_dynamic: u.power_dynamic },
  };
  if (u.state !== undefined) patch.status = u.state === "Deferred" ? "Parked" : u.state;
  return { element_id: `${charId}.${withCharId}`, patch };
}
```

- [ ] **Step 3: Move `p2State` earlier and add ripple-check grounding**

Find:
```ts
    const foundation = foundationResult.foundation;

    const turnId = randomUUID();
```
Replace:
```ts
    const foundation = foundationResult.foundation;
    const p2State: P2State = story.p2 ?? { activeCharacterId: null, characterProgress: {} };

    const turnId = randomUUID();
```

Find:
```ts
    const charId = resolveCharId(delta.current_character, foundation.cast, turnId);
    const p2State: P2State = story.p2 ?? { activeCharacterId: null, characterProgress: {} };
    const resolution = resolveCharacterTurn(
```
Replace:
```ts
    const charId = resolveCharId(delta.current_character, foundation.cast, turnId);
    const resolution = resolveCharacterTurn(
```

Find:
```ts
    system += `\n\n[Story Foundation grounding (Story Spine + Dramatic Engine) - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Check every proposed Confirmed fact against this for contradiction (conflict_detected).]\nStory Spine:\n${spineLines}\n\nDramatic Engine:\n${engineLines}`;

    if (story.p2PendingConflict) {
```
Replace:
```ts
    system += `\n\n[Story Foundation grounding (Story Spine + Dramatic Engine) - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Check every proposed Confirmed fact against this for contradiction (conflict_detected).]\nStory Spine:\n${spineLines}\n\nDramatic Engine:\n${engineLines}`;

    // Relationship-graph grounding for ripple-effect checks (issue #31) -
    // injected unconditionally for every already-signed-off character every
    // turn (not conditionally on "the character currently being revised":
    // the system prompt is built before the model reveals current_character,
    // so there's no reliable way to know in advance who that will be).
    // Matches this file's existing grounding philosophy (Cast & Priority
    // Matrix, Story Foundation) of injecting broadly and trusting the model
    // to use what's relevant.
    const signedOffCharIds = Object.entries(p2State.characterProgress)
      .filter(([, progress]) => progress.status === "signed_off")
      .map(([id]) => id);
    if (signedOffCharIds.length > 0) {
      const relationshipElements = await listElements(storyId, CHARACTER_RELATIONSHIPS_COLLECTION);
      const relationshipLines = signedOffCharIds
        .map((id) => {
          const characterName = p2State.characterProgress[id].characterName;
          const entries = relationshipElements.filter((e) => e.element_id.startsWith(`${id}.`));
          if (entries.length === 0) return `- ${characterName}: no relationships recorded yet.`;
          const entryLines = entries
            .map((e) => {
              const v = (e.value ?? {}) as { dynamic?: string; trust_trajectory?: string; power_dynamic?: string };
              const otherCharId = e.element_id.slice(id.length + 1);
              const otherName = p2State.characterProgress[otherCharId]?.characterName ?? otherCharId;
              return `  - with ${otherName}: ${v.dynamic ?? "?"} (trust: ${v.trust_trajectory ?? "?"}, power: ${v.power_dynamic ?? "?"})`;
            })
            .join("\n");
          return `- ${characterName}:\n${entryLines}`;
        })
        .join("\n");
      system += `\n\n[Relationship Graph (already-signed-off characters only) - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Consider ripple effects on these relationships before confirming a psychological change to any of these characters.]\n${relationshipLines}`;
    }

    if (story.p2PendingConflict) {
```

- [ ] **Step 4: Persist relationship updates after fact updates**

Find:
```ts
    const factUpdates = resolvedEnforcedUpdates.map((u) => toFactUpdate(u, charId));
    if (factUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, factUpdates, turnId, CHARACTER_FACTS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying fact updates on turn ${turnId}:`, err.message);
      }
    }

    if (conflictResult.logEntry) {
```
Replace:
```ts
    const factUpdates = resolvedEnforcedUpdates.map((u) => toFactUpdate(u, charId));
    if (factUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, factUpdates, turnId, CHARACTER_FACTS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying fact updates on turn ${turnId}:`, err.message);
      }
    }

    const relationshipUpdates = delta.relationship_updates.map((u) => {
      const withCharId = resolveCharId(u.with, foundation.cast, turnId);
      return toRelationshipUpdate(u, charId, withCharId);
    });
    if (relationshipUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, relationshipUpdates, turnId, CHARACTER_RELATIONSHIPS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying relationship updates on turn ${turnId}:`, err.message);
      }
    }

    if (conflictResult.logEntry) {
```

- [ ] **Step 5: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Manual read-through check**

Confirm by reading the edited function:
- `p2State` is now declared once, before the system prompt is built, and reused (not redeclared) at the `resolveCharacterTurn` call site.
- A session with no signed-off characters yet: `signedOffCharIds` is empty, the relationship-grounding `if` block is skipped entirely, `system` is unaffected — today's behavior preserved for every session before its first character signs off.
- A session with one signed-off character who has one Confirmed relationship entry: the grounding block lists that character's name, the entry's `dynamic`/`trust_trajectory`/`power_dynamic`, and the other character's name (resolved from `characterProgress` if that other character has also been interviewed, else falls back to their raw charId).
- A session with TWO signed-off characters, each with their own relationship entries: `signedOffCharIds` contains both, and the `.map()` over them produces one block per character (via the `id.startsWith` filter scoping each character's `entries` to only their own `${id}.`-prefixed elements) — confirm the two characters' entries are never mixed into a single undifferentiated list.
- A turn proposing `relationship_updates: [{ with: "Kade", dynamic: "rivals", trust_trajectory: "eroding", power_dynamic: "evenly matched" }]` for `current_character: "Deva"`: `withCharId` resolves via the same `resolveCharId` logic already proven for `current_character`, the written `element_id` is `deva.kade` (or whatever `resolveCharId` returns for "Kade"), `patch.value` is the complete three-field object, and the write targets `CHARACTER_RELATIONSHIPS_COLLECTION` (via the `applyStateDelta` call's fourth argument) - a distinct collection from `CHARACTER_FACTS_COLLECTION`, so this element can never collide with a same-`charId` psych-fact element even though both use `charId`-prefixed composite IDs.
- An empty `relationship_updates: []` (the common case) results in no `applyStateDelta` call for `CHARACTER_RELATIONSHIPS_COLLECTION` at all.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: wire P2 relationship persistence and ripple-check grounding into the chat route (#31)"
```
