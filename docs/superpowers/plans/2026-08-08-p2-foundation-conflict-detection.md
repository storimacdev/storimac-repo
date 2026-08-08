# P2 Conflict Detection vs. Story Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #30 — before any character fact reaches `Confirmed`, the model checks it against Story Foundation grounding (Story Spine, Dramatic Engine) for contradiction; on a declared conflict, the app hard-gates that fact's confirmation until the author picks one of three resolutions (revert / update Foundation canon / park), with every conflict and resolution logged.

**Architecture:** A new pure module (`foundationConflict.ts`, mirroring `characterFsm.ts`/`causalChain.ts`'s split) resolves each turn's conflict state against a new persisted singular `Story.p2PendingConflict`, layered on top of issue #28's already-shipped causal-chain enforcement output. The route injects Story Spine/Dramatic Engine grounding (previously loaded but never shown to the model) plus a resolution-mode system note when a conflict is pending, and appends every resolution to a new `characterConflictsLog` collection.

**Tech Stack:** TypeScript, Firestore (via `firebase-admin`), Zod, Anthropic tool-use.

## Global Constraints

- Conflict detection is model-declared and trusted (`conflict_detected`/`conflict_description`), never app-recomputed — there is no deterministic way to judge semantic contradiction between a character fact and Foundation content.
- Choosing "update_foundation" confirms the character fact as P2 canon and logs a downstream-impact entry — it never auto-mutates Project 1's `foundationDoc.ts` stored JSON. That is explicitly out of scope for this plan.
- Grounding injected into the system prompt is scoped to exactly `foundation.storySpine` and `foundation.dramaticEngine` — both already loaded by `ingestFoundation.ts`, nothing further ingested.
- Only one pending conflict is ever tracked at a time (`Story.p2PendingConflict`, singular — not an array), matching `StoryPendingConflict`'s own precedent. Detection only considers a turn's `state: "Confirmed"` proposals.
- The model's own `reply`/`context` are never overridden by this logic (unlike issue #26's blocked-switch redirect) — AC3's hard gate is enforced at the data layer only (a fact cannot reach `Confirmed` until resolved), trusting sp02 §4's existing narrative instructions for the conversational side.
- This logic runs on the output of issue #28's causal-chain enforcement (`enforcedUpdates`), not on raw `delta.updates` — the two are independent, composable downgrade-to-`Working` guards over the same pipeline.
- No changes to `canonStore.ts`, `factRegistry.ts`, `characterFsm.ts`, `causalChain.ts`, or any Project 1 file (`elementRegistry.ts`, `stateDelta.ts`, `conflictResolution.ts`, `web/src/app/api/chat/route.ts`).

---

### Task 1: Persist Project 2's pending conflict and conflicts log

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `P2PendingConflict` (interface), `Story.p2PendingConflict?: P2PendingConflict | null` (field), `setP2PendingConflict(storyId, conflict): Promise<void>`, `CharacterConflictLogEntry` (interface), `appendCharacterConflictLog(storyId, entry): Promise<void>` — all consumed by Task 4.

- [ ] **Step 1: Add the `P2PendingConflict` type**

Find:
```ts
export interface P2State {
  /** The locked character's charId, or null if no character is currently locked (free to start/resume anyone). */
  activeCharacterId: string | null;
  /** Keyed by charId (see character-chat/route.ts's resolveCharId). */
  characterProgress: Record<string, P2CharacterProgress>;
}

export interface Story {
```
Replace:
```ts
export interface P2State {
  /** The locked character's charId, or null if no character is currently locked (free to start/resume anyone). */
  activeCharacterId: string | null;
  /** Keyed by charId (see character-chat/route.ts's resolveCharId). */
  characterProgress: Record<string, P2CharacterProgress>;
}

/** Project 2's pending conflict vs. the Story Foundation (issue #30) - a character fact awaiting one of three author resolutions, gating that fact's confirmation until resolved. Singular, like P1's own StoryPendingConflict - only one conflict is ever open at a time. */
export interface P2PendingConflict {
  charId: string;
  characterName: string;
  field: string;
  proposedValue: unknown;
  conflictDescription: string;
  ts: string;
}

export interface Story {
```

- [ ] **Step 2: Add the `p2PendingConflict` field to `Story`**

Find:
```ts
  /**
   * Project 2's per-character interview lock/progress (issue #26).
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2?: P2State | null;
}
```
Replace:
```ts
  /**
   * Project 2's per-character interview lock/progress (issue #26).
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2?: P2State | null;
  /**
   * Project 2's pending conflict vs. the Story Foundation (issue #30),
   * cleared once the author picks one of the three resolution choices.
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2PendingConflict?: P2PendingConflict | null;
}
```

- [ ] **Step 3: Add the `setP2PendingConflict` setter**

Find:
```ts
/** Stores Project 2's per-character lock/progress (issue #26) - whole-object replace, same convention as setStage7Audit. */
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2, updatedAt: new Date().toISOString() });
}
```
Replace:
```ts
/** Stores Project 2's per-character lock/progress (issue #26) - whole-object replace, same convention as setStage7Audit. */
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2, updatedAt: new Date().toISOString() });
}

/** Records or clears Project 2's pending Story Foundation conflict (issue #30); pass null to clear once resolved. */
export async function setP2PendingConflict(
  storyId: string,
  conflict: P2PendingConflict | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2PendingConflict: conflict, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Add the conflicts log type, collection, and appender**

Find:
```ts
export async function listGuardrailFlags(storyId: string): Promise<StoredGuardrailFlag[]> {
  const snap = await guardrailFlagsCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as StoredGuardrailFlag);
}

/** Appends an author-type re-assessment (issue #8 calls this) without clobbering prior history. */
```
Replace:
```ts
export async function listGuardrailFlags(storyId: string): Promise<StoredGuardrailFlag[]> {
  const snap = await guardrailFlagsCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as StoredGuardrailFlag);
}

/** Project 2's canon_conflicts_log (issue #30, PRD §7) - one entry per resolved Story Foundation conflict. */
export interface CharacterConflictLogEntry {
  charId: string;
  field: string;
  conflictDescription: string;
  resolution: "revert" | "update_foundation" | "park";
  resolvedBy: string;
  ts: string;
  turnId: string;
}

function characterConflictsLogCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("characterConflictsLog");
}

/** Appends a resolved conflict to Project 2's conflicts log (issue #30). */
export async function appendCharacterConflictLog(
  storyId: string,
  entry: CharacterConflictLogEntry
): Promise<void> {
  await characterConflictsLogCollection(storyId).add(entry);
}

/** Appends an author-type re-assessment (issue #8 calls this) without clobbering prior history. */
```

- [ ] **Step 5: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: persist P2 pending Story Foundation conflict and conflicts log (#30)"
```

---

### Task 2: Add conflict fields to the Project 2 turn schema

**Files:**
- Modify: `web/src/lib/characterEngine/characterTurnSchema.ts`

**Interfaces:**
- Produces: `CharacterTurnSchema`/`CharacterTurn`/`EMIT_CHARACTER_TURN_TOOL` all gaining `conflict_detected: boolean` (required), `conflict_description?: string`, `resolution?: "revert" | "update_foundation" | "park"` — consumed by Task 4.

Independent of Task 1 (no shared code) - order between them doesn't matter, but Task 4 depends on both.

- [ ] **Step 1: Update the file's header comment**

Find:
```ts
 * `updates`' `field` enum is deliberately scoped to only the Psychological
 * Engine's 11 known fields (factRegistry.ts) - see that file's own comment
 * for why the other 5 interview stages aren't covered yet. `switch_override`
 * (issue #26) is consumed by characterFsm.ts's resolveCharacterTurn, not
 * used directly in this file.
 */
```
Replace:
```ts
 * `updates`' `field` enum is deliberately scoped to only the Psychological
 * Engine's 11 known fields (factRegistry.ts) - see that file's own comment
 * for why the other 5 interview stages aren't covered yet. `switch_override`
 * (issue #26) is consumed by characterFsm.ts's resolveCharacterTurn, not
 * used directly in this file. `conflict_detected`/`conflict_description`/
 * `resolution` (issue #30) mirror Project 1's stateDelta.ts equivalents,
 * but with P2's own resolution vocabulary (revert/update_foundation/park)
 * since P2's conflict is against another project's document, not against
 * its own prior canon - see docs/superpowers/specs/2026-08-08-p2-foundation-conflict-detection-design.md.
 */
```

- [ ] **Step 2: Add the fields to `CharacterTurnSchema`**

Find:
```ts
export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
  switch_override: z.boolean(),
  context: z.string().min(1),
  updates: z.array(FactUpdateSchema),
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;
```
Replace:
```ts
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

- [ ] **Step 3: Add the tool schema properties and update `required`**

Find:
```ts
            depends_on: {
              type: "array",
              items: { type: "string", enum: CHARACTER_FIELD_IDS },
              description:
                "Other field names (from this same character) this fact causally depends on - e.g. core_flaw depends on core_wound or false_belief. Used to verify the psychological chain stays traceable.",
            },
          },
          required: ["field"],
        },
      },
    },
    required: ["reply", "current_character", "current_stage", "character_signed_off", "switch_override", "context", "updates"],
  },
};
```
Replace:
```ts
            depends_on: {
              type: "array",
              items: { type: "string", enum: CHARACTER_FIELD_IDS },
              description:
                "Other field names (from this same character) this fact causally depends on - e.g. core_flaw depends on core_wound or false_belief. Used to verify the psychological chain stays traceable.",
            },
          },
          required: ["field"],
        },
      },
      conflict_detected: {
        type: "boolean",
        description:
          "True if any of this turn's proposed Confirmed facts contradict the Story Foundation grounding (Story Spine, Dramatic Engine) shown above. False otherwise.",
      },
      conflict_description: {
        type: "string",
        description:
          "Required when conflict_detected is true: plain-language explanation of the contradiction, naming both the proposed fact and the specific Foundation content it conflicts with. Omit otherwise.",
      },
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

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/characterEngine/characterTurnSchema.ts
git commit -m "feat: add conflict fields to the Project 2 turn schema (#30)"
```

---

### Task 3: Conflict processing module (`foundationConflict.ts`)

**Files:**
- Create: `web/src/lib/characterEngine/foundationConflict.ts`

**Interfaces:**
- Consumes: `type FactUpdateInput` from `./characterTurnSchema` (already exists); `type P2PendingConflict` from `@/lib/canonEngine/storyStore` (Task 1).
- Produces: `ConflictResolutionChoice` (type), `ConflictLogEntryDraft`/`ConflictProcessingResult` (interfaces), `processConflict(...)`, `buildConflictContextMessage(conflict)` — all consumed by Task 4.

This task depends on Task 1 (imports `P2PendingConflict`) but not Task 2.

- [ ] **Step 1: Create the file**

```ts
import type { FactUpdateInput } from "./characterTurnSchema";
import type { P2PendingConflict } from "@/lib/canonEngine/storyStore";

/**
 * Project 2 conflict detection vs. the Story Foundation — GitHub issue
 * #30, design: docs/superpowers/specs/2026-08-08-p2-foundation-conflict-detection-design.md.
 * Pure, I/O-free (mirrors characterFsm.ts's/causalChain.ts's split from
 * their own I/O-bound callers). Detection itself is model-declared and
 * trusted (there's no deterministic way to judge whether a Core Wound
 * "contradicts" a Story Spine beat) - this module only enforces the
 * consequence of a declared conflict: gating canon status and tracking
 * the singular pending conflict/resolution lifecycle.
 */

export type ConflictResolutionChoice = "revert" | "update_foundation" | "park";

export interface ConflictLogEntryDraft {
  charId: string;
  field: string;
  conflictDescription: string;
  resolution: ConflictResolutionChoice;
}

export interface ConflictProcessingResult {
  enforcedUpdates: FactUpdateInput[];
  nextPendingConflict: P2PendingConflict | null;
  logEntry: ConflictLogEntryDraft | null;
}

/**
 * Resolves this turn's conflict state against `pendingConflict`:
 * - A pending conflict plus a `resolution` this turn resolves it (revert
 *   drops the field entirely; update_foundation confirms it; park stores
 *   it as Deferred) and produces a log entry.
 * - No pending conflict, but `conflictDetected` is true and at least one
 *   Confirmed update exists: the first Confirmed update becomes the new
 *   pending conflict, and every Confirmed update this turn is downgraded
 *   to Working (conservative - no partial confirmation while a conflict
 *   is open).
 * - Otherwise: `enforcedUpdates` passes through unchanged, and
 *   `pendingConflict` (if any) stays open, still awaiting a resolution.
 */
export function processConflict(
  enforcedUpdates: FactUpdateInput[],
  pendingConflict: P2PendingConflict | null,
  charId: string,
  characterName: string,
  conflictDetected: boolean,
  conflictDescription: string | undefined,
  resolution: ConflictResolutionChoice | undefined,
  ts: string
): ConflictProcessingResult {
  if (pendingConflict && resolution) {
    const remaining = enforcedUpdates.filter((u) => u.field !== pendingConflict.field);
    const reproposed = enforcedUpdates.find((u) => u.field === pendingConflict.field);
    const value = reproposed?.value ?? pendingConflict.proposedValue;

    let resolvedUpdates: FactUpdateInput[] = remaining;
    if (resolution === "update_foundation") {
      resolvedUpdates = [...remaining, { field: pendingConflict.field, value, state: "Confirmed" }];
    } else if (resolution === "park") {
      resolvedUpdates = [...remaining, { field: pendingConflict.field, value, state: "Deferred" }];
    }
    // "revert": resolvedUpdates stays as `remaining` - the field is dropped entirely.

    return {
      enforcedUpdates: resolvedUpdates,
      nextPendingConflict: null,
      logEntry: {
        charId,
        field: pendingConflict.field,
        conflictDescription: pendingConflict.conflictDescription,
        resolution,
      },
    };
  }

  if (!pendingConflict && conflictDetected) {
    const culprit = enforcedUpdates.find((u) => u.state === "Confirmed");
    if (culprit) {
      const downgraded: FactUpdateInput[] = enforcedUpdates.map((u) =>
        u.state === "Confirmed" ? { ...u, state: "Working" } : u
      );
      return {
        enforcedUpdates: downgraded,
        nextPendingConflict: {
          charId,
          characterName,
          field: culprit.field,
          proposedValue: culprit.value,
          conflictDescription: conflictDescription ?? "The model flagged a conflict but didn't provide a description.",
          ts,
        },
        logEntry: null,
      };
    }
  }

  return { enforcedUpdates, nextPendingConflict: pendingConflict, logEntry: null };
}

/**
 * Context block to inject into the next model call once a conflict is
 * pending - mirrors conflictResolution.ts's buildConflictContextMessage
 * (Project 1, issue #10), adapted for P2's own resolution vocabulary and
 * for update_foundation's narrower scope in this issue (never auto-edits
 * the Foundation Document itself - see design decision 2).
 */
export function buildConflictContextMessage(conflict: P2PendingConflict): string {
  return [
    "[CONFLICT DETECTED - system note, not from the author]",
    `${conflict.characterName}'s proposed "${conflict.field}" (${JSON.stringify(conflict.proposedValue)}) contradicts the Story Foundation: ${conflict.conflictDescription}`,
    "Stop the interview. State this contradiction explicitly, in plain language, in `context` - that's where the full explanation belongs.",
    "In `reply`, present exactly three choices as the short numbered list: (A) Revert the proposal, (B) Update Story Foundation canon (the app logs this as a downstream-impact flag for the author to revisit in Project 1 later - it does not auto-edit the Foundation Document itself), (C) Park it for later.",
    "Your next structured output must set resolution to one of revert | update_foundation | park, matching the author's pick.",
  ].join("\n");
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the function:
- `processConflict([], null, "deva", "Deva", false, undefined, undefined, "2026-01-01T00:00:00Z")` returns `{ enforcedUpdates: [], nextPendingConflict: null, logEntry: null }` (nothing happening, empty pass-through).
- `processConflict([{field: "core_wound", value: "x", state: "Confirmed"}], null, "deva", "Deva", true, "contradicts the inciting incident", undefined, "2026-01-01T00:00:00Z")` returns `enforcedUpdates: [{field: "core_wound", value: "x", state: "Working"}]` (downgraded) and `nextPendingConflict` set with `field: "core_wound"`, `conflictDescription: "contradicts the inciting incident"`.
- Calling it again with that returned `nextPendingConflict` as `pendingConflict`, and `resolution: "revert"`: `enforcedUpdates: []` (dropped), `nextPendingConflict: null`, `logEntry.resolution === "revert"`.
- The same but `resolution: "update_foundation"`: `enforcedUpdates: [{field: "core_wound", value: "x", state: "Confirmed"}]`, `nextPendingConflict: null`, `logEntry.resolution === "update_foundation"`.
- The same but `resolution: "park"`: `enforcedUpdates: [{field: "core_wound", value: "x", state: "Deferred"}]`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/foundationConflict.ts
git commit -m "feat: add P2 conflict processing module (#30)"
```

---

### Task 4: Wire Story Foundation grounding and conflict handling into the chat route

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `setP2PendingConflict`, `appendCharacterConflictLog` from `@/lib/canonEngine/storyStore` (Task 1); `delta.conflict_detected`/`delta.conflict_description`/`delta.resolution` (Task 2, already on the validated turn); `processConflict`, `buildConflictContextMessage` from `@/lib/characterEngine/foundationConflict` (Task 3).

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
} from "@/lib/canonEngine/storyStore";
```

Find:
```ts
import { resolveCharacterTurn, P2_STAGE_NAMES } from "@/lib/characterEngine/characterFsm";
```
Replace:
```ts
import { resolveCharacterTurn, P2_STAGE_NAMES } from "@/lib/characterEngine/characterFsm";
import { processConflict, buildConflictContextMessage } from "@/lib/characterEngine/foundationConflict";
```

- [ ] **Step 2: Inject Story Spine/Dramatic Engine grounding and resolution-mode note**

Find:
```ts
    let system = getSystemPrompt("sp02-cdc-systemprompt.md");
    system += `\n\n[Cast & Priority Matrix - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author - synthesize it into your own evaluation.]\n${castLines}`;
    if (foundationResult.status === "incomplete") {
      system += `\n\n[Story Foundation is incomplete: ${foundationResult.reason} Proceed with what's available; note gaps to the author naturally if relevant, don't block the interview on it.]`;
    }
```
Replace:
```ts
    let system = getSystemPrompt("sp02-cdc-systemprompt.md");
    system += `\n\n[Cast & Priority Matrix - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author - synthesize it into your own evaluation.]\n${castLines}`;

    // Story Spine & Dramatic Engine grounding (issue #30) - the only Story
    // Foundation content the model can check a proposed fact against for
    // contradiction; without this it has nothing to compare to. Scoped to
    // exactly what ingestFoundation.ts already loads (see that file's own
    // scope note on deferred CDRM/prose ingestion).
    const spine = foundation.storySpine;
    const spineLines = [
      `Opening Image: ${spine.opening_image || "(not set)"}`,
      `Inciting Incident: ${spine.inciting_incident || "(not set)"}`,
      `First Turning Point: ${spine.first_turning_point || "(not set)"}`,
      `Midpoint: ${spine.midpoint || "(not set)"}`,
      `Second Turning Point: ${spine.second_turning_point || "(not set)"}`,
      `Climax: ${spine.climax || "(not set)"}`,
      `Closing Image: ${spine.closing_image || "(not set)"}`,
    ].join("\n");
    const engineLines = [
      `Protagonist: ${foundation.dramaticEngine?.protagonist || "(not set)"}`,
      `Antagonistic Force: ${foundation.dramaticEngine?.antagonistic_force || "(not set)"}`,
      `Central Conflict: ${foundation.dramaticEngine?.central_conflict || "(not set)"}`,
      `Primary Stakes: ${foundation.dramaticEngine?.primary_stakes || "(not set)"}`,
      `Transformation Arc: ${foundation.dramaticEngine?.transformation_arc || "(not set)"}`,
    ].join("\n");
    system += `\n\n[Story Foundation grounding (Story Spine + Dramatic Engine) - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Check every proposed Confirmed fact against this for contradiction (conflict_detected).]\nStory Spine:\n${spineLines}\n\nDramatic Engine:\n${engineLines}`;

    if (story.p2PendingConflict) {
      system += `\n\n${buildConflictContextMessage(story.p2PendingConflict)}`;
    }

    if (foundationResult.status === "incomplete") {
      system += `\n\n[Story Foundation is incomplete: ${foundationResult.reason} Proceed with what's available; note gaps to the author naturally if relevant, don't block the interview on it.]`;
    }
```

- [ ] **Step 3: Process conflict state after causal-chain enforcement, before building `factUpdates`**

Find:
```ts
      if (
        enforceChain &&
        !(claimsTraceability(u.depends_on) && (await isTraceable(storyId, charId, u.depends_on, rootsConfirmedThisTurn)))
      ) {
        console.warn(
          `[character-chat] ${u.field} for ${charId} not traceable to a Confirmed Wound/Belief on turn ${turnId} - downgraded Confirmed->Working`
        );
        enforcedUpdates.push({ ...u, state: "Working" });
      } else {
        enforcedUpdates.push(u);
      }
    }
    const factUpdates = enforcedUpdates.map((u) => toFactUpdate(u, charId));
```
Replace:
```ts
      if (
        enforceChain &&
        !(claimsTraceability(u.depends_on) && (await isTraceable(storyId, charId, u.depends_on, rootsConfirmedThisTurn)))
      ) {
        console.warn(
          `[character-chat] ${u.field} for ${charId} not traceable to a Confirmed Wound/Belief on turn ${turnId} - downgraded Confirmed->Working`
        );
        enforcedUpdates.push({ ...u, state: "Working" });
      } else {
        enforcedUpdates.push(u);
      }
    }

    const pendingConflictBefore = story.p2PendingConflict ?? null;
    const conflictResult = processConflict(
      enforcedUpdates,
      pendingConflictBefore,
      charId,
      delta.current_character,
      delta.conflict_detected,
      delta.conflict_description,
      delta.resolution,
      new Date().toISOString()
    );
    if (conflictResult.logEntry) {
      console.warn(
        `[character-chat] Story Foundation conflict resolved (${conflictResult.logEntry.resolution}) for ${conflictResult.logEntry.field} on turn ${turnId}`
      );
      await appendCharacterConflictLog(storyId, {
        ...conflictResult.logEntry,
        resolvedBy: user.uid,
        ts: new Date().toISOString(),
        turnId,
      });
      await setP2PendingConflict(storyId, null);
    } else if (!pendingConflictBefore && conflictResult.nextPendingConflict) {
      console.warn(
        `[character-chat] Story Foundation conflict detected for ${conflictResult.nextPendingConflict.field} on turn ${turnId}: ${conflictResult.nextPendingConflict.conflictDescription}`
      );
      await setP2PendingConflict(storyId, conflictResult.nextPendingConflict);
    }

    const factUpdates = conflictResult.enforcedUpdates.map((u) => toFactUpdate(u, charId));
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Manual read-through check**

Confirm by reading the edited function:
- A turn with `conflict_detected: false` and no pending conflict: `conflictResult.logEntry` and `conflictResult.nextPendingConflict` are both effectively no-ops (`nextPendingConflict` equals `pendingConflictBefore`, which is `null`) — neither `appendCharacterConflictLog` nor `setP2PendingConflict` is called, `factUpdates` built from `enforcedUpdates` exactly as before this change (today's behavior preserved).
- A turn proposing a `Confirmed` fact with `conflict_detected: true`, no pending conflict yet: the fact is downgraded to `Working` inside `conflictResult.enforcedUpdates`, `setP2PendingConflict` is called with the new conflict, `appendCharacterConflictLog` is NOT called (no resolution yet).
- A later turn, with `story.p2PendingConflict` now set, where the model sets `resolution: "revert"`: `conflictResult.enforcedUpdates` excludes that field entirely, `appendCharacterConflictLog` is called with `resolution: "revert"`, `setP2PendingConflict(storyId, null)` clears it.
- The same with `resolution: "update_foundation"`: the field appears in `conflictResult.enforcedUpdates` as `Confirmed`, gets applied via `applyStateDelta` as usual, logged, conflict cleared.
- A turn where `delta.resolution` is set but `story.p2PendingConflict` is `null`: `processConflict`'s first branch requires `pendingConflict &&`, so this is a no-op — matches the design's stated posture of ignoring an out-of-context resolution.
- `delta.reply`/`delta.context` are used unmodified in the final `appendMessage`/`NextResponse.json` calls exactly as before this change - this logic never touches the reply/context path.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: wire P2 Story Foundation grounding and conflict handling into the chat route (#30)"
```
