# P2 Sequential Interview Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Project 2's Character Bible interview a hard, app-enforced single-active-character lock and app-computed stage progression (GitHub issue #26), closing the gap where `character-chat/route.ts` currently trusts the model's own `current_character`/`current_stage`/`character_signed_off` claims with zero independent verification.

**Architecture:** A new pure module (`characterFsm.ts`, mirroring Project 1's `stageFsm.ts`) resolves each turn's proposed character/stage/sign-off/override against a new persisted `Story.p2` field. An unauthorized character switch is hard-blocked: the app discards that turn's fact updates and replaces the model's reply with a deterministic redirect that repeats the locked character's last question. An authorized turn proceeds with app-clamped (not raw model-claimed) stage/status values.

**Tech Stack:** TypeScript, Firestore (via `firebase-admin`), Zod, Anthropic tool-use.

## Global Constraints

- The character-switch lock is enforced in app code (hard block + deterministic redirect), never left to prompting/logging alone — see design spec decision 1.
- Stage progression is always app-computed via `characterFsm.ts`'s clamp; `delta.current_stage` and `delta.character_signed_off` are never persisted or returned to the client raw once `resolveCharacterTurn` has run.
- This issue does **not** implement content-based (fact-completeness) stage-gating — i.e., no check on which facts are `Confirmed` before a stage advances. Only monotonic, one-stage-per-turn clamping. Content-based gating (tier-scaled) is issue #28's scope.
- `P2State` does not persist priority tier — it's always recomputed live via `computePriorityMatrix(foundation)`, already available in-route.
- No changes to `canonStore.ts`, `factRegistry.ts`, `FactUpdateSchema`, or any Project 1 file (`elementRegistry.ts`, `stateDelta.ts`, `web/src/app/api/chat/route.ts`).

---

### Task 1: Persist Project 2's per-character lock/progress on the Story document

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `P2CharacterStatus` (type), `P2CharacterProgress` (interface), `P2State` (interface), `Story.p2?: P2State | null` (field), `setP2State(storyId: string, p2: P2State): Promise<void>` — all consumed by Task 2 (`characterFsm.ts`) and Task 4 (`character-chat/route.ts`).

- [ ] **Step 1: Add the `P2CharacterStatus`/`P2CharacterProgress`/`P2State` types**

Find:
```ts
export interface StoryPendingConflict {
  element_id: string;
  old_value: unknown;
  new_value: unknown;
}

export interface Story {
```
Replace:
```ts
export interface StoryPendingConflict {
  element_id: string;
  old_value: unknown;
  new_value: unknown;
}

/** Project 2 per-character interview progress (issue #26). */
export type P2CharacterStatus = "in_progress" | "deferred" | "signed_off";

export interface P2CharacterProgress {
  characterName: string;
  /** 1-6, app-computed ground truth - never trusted raw from the model. */
  stage: number;
  status: P2CharacterStatus;
}

export interface P2State {
  /** The locked character's charId, or null if no character is currently locked (free to start/resume anyone). */
  activeCharacterId: string | null;
  /** Keyed by charId (see character-chat/route.ts's resolveCharId). */
  characterProgress: Record<string, P2CharacterProgress>;
}

export interface Story {
```

- [ ] **Step 2: Add the `p2` field to `Story`**

Find:
```ts
  /**
   * Stage 7 audit result (issue #17), written when the Project enters Stage
   * 7. Stage 8 entry is gated on `authorResponded` becoming true (the
   * author's next message after seeing the summary flips it).
   */
  stage7Audit?: import("./stage7Audit").Stage7AuditResult | null;
}
```
Replace:
```ts
  /**
   * Stage 7 audit result (issue #17), written when the Project enters Stage
   * 7. Stage 8 entry is gated on `authorResponded` becoming true (the
   * author's next message after seeing the summary flips it).
   */
  stage7Audit?: import("./stage7Audit").Stage7AuditResult | null;
  /**
   * Project 2's per-character interview lock/progress (issue #26).
   * Optional/nullable since Stories created before this field existed
   * won't have it in Firestore.
   */
  p2?: P2State | null;
}
```

- [ ] **Step 3: Add the `setP2State` setter**

Find:
```ts
/** Stores/updates the Stage 7 audit (issue #17); pass null to clear on stage revisit. */
export async function setStage7Audit(
  storyId: string,
  audit: import("./stage7Audit").Stage7AuditResult | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ stage7Audit: audit, updatedAt: new Date().toISOString() });
}
```
Replace:
```ts
/** Stores/updates the Stage 7 audit (issue #17); pass null to clear on stage revisit. */
export async function setStage7Audit(
  storyId: string,
  audit: import("./stage7Audit").Stage7AuditResult | null
): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ stage7Audit: audit, updatedAt: new Date().toISOString() });
}

/** Stores Project 2's per-character lock/progress (issue #26) - whole-object replace, same convention as setStage7Audit. */
export async function setP2State(storyId: string, p2: P2State): Promise<void> {
  await storiesCollection()
    .doc(storyId)
    .update({ p2, updatedAt: new Date().toISOString() });
}
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass. This file has no other consumers of the changed interface yet, so this just confirms the new types/field/function are syntactically sound.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts
git commit -m "feat: persist P2 per-character lock/progress on the Story document (#26)"
```

---

### Task 2: Character stage-gate/lock resolver (`characterFsm.ts`)

**Files:**
- Create: `web/src/lib/characterEngine/characterFsm.ts`

**Interfaces:**
- Consumes: `P2State`, `P2CharacterProgress`, `P2CharacterStatus` from `@/lib/canonEngine/storyStore` (Task 1).
- Produces: `P2_STAGE_NAMES: Record<number, string>`, `CharacterTurnResolution` (type), `resolveCharacterTurn(p2State, charId, characterName, requestedStage, signedOff, switchOverride): CharacterTurnResolution` — all consumed by Task 4.

This task depends on Task 1 for its imported types (order matters: Task 1 first).

- [ ] **Step 1: Create the file**

```ts
import type { P2State, P2CharacterProgress, P2CharacterStatus } from "@/lib/canonEngine/storyStore";

/**
 * Project 2 per-character stage-gate/lock — GitHub issue #26, design:
 * docs/superpowers/specs/2026-08-07-p2-sequential-interview-engine-design.md.
 * Pure, I/O-free (mirrors stageFsm.ts's split from its own I/O-bound
 * callers) - testable in isolation and importable client-side later
 * without dragging in firebaseAdmin.
 *
 * Deliberately does NOT gate on fact content (which facts must be
 * Confirmed before leaving a stage) - only Stage 2 has a defined field
 * vocabulary today (factRegistry.ts), and even that needs tier-scaling
 * this module has no reason to duplicate. That's issue #28's job. This
 * module only enforces what it can honestly enforce today: monotonic
 * one-stage-per-turn progression, and the single-active-character lock.
 */

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

// Advances at most one stage per turn, and never regresses: a claim of
// prevStage+1 or lower is honored (or held at prevStage if it's a repeat
// or a regression); a claim 2+ stages ahead is clamped down to
// prevStage+1, never jumped straight to the claimed number.
function clampStage(prevStage: number, requestedStage: number): number {
  if (requestedStage > prevStage + 1) return prevStage + 1;
  return Math.max(requestedStage, prevStage);
}

/**
 * Resolves one turn's proposed (character, stage, sign-off, override)
 * against the story's persisted P2State. Never throws - an out-of-range
 * requestedStage is clamped, not rejected, since it's just an untrusted
 * model claim (same posture Project 1 takes toward malformed fact
 * proposals).
 */
export function resolveCharacterTurn(
  p2State: P2State,
  charId: string,
  characterName: string,
  requestedStage: number,
  signedOff: boolean,
  switchOverride: boolean
): CharacterTurnResolution {
  const { activeCharacterId, characterProgress } = p2State;

  if (activeCharacterId !== null && activeCharacterId !== charId && !switchOverride) {
    // Guarded with a fallback even though activeCharacterId is only ever
    // set alongside a matching progress entry by this same function - a
    // defensive stance against a corrupted/hand-edited Story doc, same
    // idiom stageFsm.ts uses for its own Firestore-sourced reads.
    const activeProgress: P2CharacterProgress = characterProgress[activeCharacterId] ?? {
      characterName: activeCharacterId,
      stage: 1,
      status: "in_progress",
    };
    return { allowed: false, activeCharId: activeCharacterId, activeProgress };
  }

  const nextCharacterProgress = { ...characterProgress };

  if (activeCharacterId !== null && activeCharacterId !== charId && switchOverride) {
    const priorProgress = characterProgress[activeCharacterId];
    if (priorProgress) {
      nextCharacterProgress[activeCharacterId] = { ...priorProgress, status: "deferred" };
    }
  }

  const prevStage = characterProgress[charId]?.stage ?? 1;
  const stage = clampStage(prevStage, requestedStage);
  const status: P2CharacterStatus = signedOff && stage === 6 ? "signed_off" : "in_progress";

  nextCharacterProgress[charId] = { characterName, stage, status };

  const nextP2State: P2State = {
    activeCharacterId: status === "signed_off" ? null : charId,
    characterProgress: nextCharacterProgress,
  };

  return { allowed: true, nextP2State, stage, status };
}
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the function: with `p2State = { activeCharacterId: null, characterProgress: {} }`, calling `resolveCharacterTurn(p2State, "deva", "Deva", 1, false, false)` returns `{ allowed: true, stage: 1, status: "in_progress", nextP2State: { activeCharacterId: "deva", characterProgress: { deva: { characterName: "Deva", stage: 1, status: "in_progress" } } } }`.

Confirm a second call with the returned `nextP2State`, same charId, `requestedStage: 6, signedOff: true` skips straight from stage 1 to `stage: 2` (clamped, not 6) and `status: "in_progress"` (signOff ignored off-Stage-6).

Confirm a call with a *different* charId (e.g. `"kade"`) against a `p2State` where `activeCharacterId: "deva"` and Deva's status is `"in_progress"`, with `switchOverride: false`, returns `{ allowed: false, activeCharId: "deva", activeProgress: { characterName: "Deva", stage: ..., status: "in_progress" } }`.

Confirm the same call with `switchOverride: true` returns `allowed: true`, with `nextP2State.characterProgress.deva.status === "deferred"` (stage unchanged) and `nextP2State.activeCharacterId === "kade"`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/characterFsm.ts
git commit -m "feat: add P2 per-character stage-gate/lock resolver (#26)"
```

---

### Task 3: Add `switch_override` to the Project 2 turn schema

**Files:**
- Modify: `web/src/lib/characterEngine/characterTurnSchema.ts`

**Interfaces:**
- Produces: `CharacterTurnSchema`/`CharacterTurn`/`EMIT_CHARACTER_TURN_TOOL` all gaining a required `switch_override: boolean` field — consumed by Task 4.

Independent of Tasks 1-2 (no shared code) - order relative to them doesn't matter, but Task 4 depends on this one.

- [ ] **Step 1: Update the file's header comment**

Find:
```ts
 * `updates`' `field` enum is deliberately scoped to only the Psychological
 * Engine's 11 known fields (factRegistry.ts) - see that file's own comment
 * for why the other 5 interview stages aren't covered yet.
 */
```
Replace:
```ts
 * `updates`' `field` enum is deliberately scoped to only the Psychological
 * Engine's 11 known fields (factRegistry.ts) - see that file's own comment
 * for why the other 5 interview stages aren't covered yet. `switch_override`
 * (issue #26) is consumed by characterFsm.ts's resolveCharacterTurn, not
 * used directly in this file.
 */
```

- [ ] **Step 2: Add `switch_override` to `CharacterTurnSchema`**

Find:
```ts
export const CharacterTurnSchema = z.object({
  reply: z.string().min(1),
  current_character: z.string().min(1),
  current_stage: z.number().int().min(1).max(6),
  character_signed_off: z.boolean(),
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
});

export type CharacterTurn = z.infer<typeof CharacterTurnSchema>;
```

- [ ] **Step 3: Add the `switch_override` property to `EMIT_CHARACTER_TURN_TOOL`**

Find:
```ts
      character_signed_off: {
        type: "boolean",
        description:
          "True only on the turn where current_character completes Stage 6 sign-off. False every other turn, including all of Stages 1-5.",
      },
      context: {
```
Replace:
```ts
      character_signed_off: {
        type: "boolean",
        description:
          "True only on the turn where current_character completes Stage 6 sign-off. False every other turn, including all of Stages 1-5.",
      },
      switch_override: {
        type: "boolean",
        description:
          "True only on a turn where the author has explicitly asked to move to a different character before signing off the current one (e.g. 'let's switch to the antagonist for now'). False every other turn - do not set this just because the conversation touches another character in passing.",
      },
      context: {
```

- [ ] **Step 4: Add `switch_override` to the tool's `required` array**

Find:
```ts
    required: ["reply", "current_character", "current_stage", "character_signed_off", "context", "updates"],
  },
};
```
Replace:
```ts
    required: ["reply", "current_character", "current_stage", "character_signed_off", "switch_override", "context", "updates"],
  },
};
```

- [ ] **Step 5: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/characterEngine/characterTurnSchema.ts
git commit -m "feat: add switch_override to the Project 2 turn schema (#26)"
```

---

### Task 4: Wire the lock/stage-gate into the Character Bible chat route

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `setP2State`, `type P2State` from `@/lib/canonEngine/storyStore` (Task 1); `resolveCharacterTurn`, `P2_STAGE_NAMES` from `@/lib/characterEngine/characterFsm` (Task 2); `delta.switch_override: boolean` (Task 3, already on the validated turn).

- [ ] **Step 1: Update the file's header comment**

Find:
```ts
/**
 * The live Character Bible interview turn — issues #26/#27, reference:
 * web/src/app/api/chat/route.ts (Project 1's own turn handler). Deliberately
 * lighter: no stage-gate/canon-element/conflict-resolution/Stage-7-audit
 * machinery, since none of that exists for Project 2 yet (see
 * docs/superpowers/specs/2026-08-01-p2-interview-engine-design.md) - just
 * sequential-character enforcement (prompt-driven) and the reply/context
 * turn contract already proven on Project 1.
 */
```
Replace:
```ts
/**
 * The live Character Bible interview turn — issues #26/#27, reference:
 * web/src/app/api/chat/route.ts (Project 1's own turn handler). Issue #26
 * (design: docs/superpowers/specs/2026-08-07-p2-sequential-interview-engine-design.md)
 * added a hard app-level single-active-character lock and app-computed
 * stage clamping via characterFsm.ts's resolveCharacterTurn - still no
 * content-based (fact-completeness) stage-gating or conflict-resolution
 * machinery, since P2 doesn't have a defined required-field vocabulary
 * per stage yet (that's issue #28's job for Stage 2; #30 for conflict
 * resolution).
 */
```

- [ ] **Step 2: Add the new imports**

Find:
```ts
import { getStory, appendMessage, listMessages, CHARACTER_MESSAGES_COLLECTION } from "@/lib/canonEngine/storyStore";
import { applyStateDelta, CanonConflictError, CHARACTER_FACTS_COLLECTION, type ElementUpdate } from "@/lib/canonEngine/canonStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { computePriorityMatrix } from "@/lib/characterEngine/priorityMatrix";
import { getDepthLabel } from "@/lib/characterEngine/depthLabels";
import { isKnownFieldId } from "@/lib/characterEngine/factRegistry";
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
} from "@/lib/canonEngine/storyStore";
import { applyStateDelta, CanonConflictError, CHARACTER_FACTS_COLLECTION, type ElementUpdate } from "@/lib/canonEngine/canonStore";
import { extractTurn, TurnValidationError } from "@/lib/canonEngine/extractTurn";
import { RateLimitTimeoutError } from "@/lib/rateLimit/anthropicGate";
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
import { computePriorityMatrix } from "@/lib/characterEngine/priorityMatrix";
import { getDepthLabel } from "@/lib/characterEngine/depthLabels";
import { isKnownFieldId } from "@/lib/characterEngine/factRegistry";
import { resolveCharacterTurn, P2_STAGE_NAMES } from "@/lib/characterEngine/characterFsm";
```

- [ ] **Step 3: Resolve the turn against the lock/stage-gate, and branch on block vs. allow**

Find:
```ts
    const charId = resolveCharId(delta.current_character, foundation.cast, turnId);
    for (const u of delta.updates) {
      if (!isKnownFieldId(u.field)) {
        console.warn(
          `[character-chat] unknown field "${u.field}" on turn ${turnId} - not in the Project 2 canonical registry, writing as-is`
        );
      }
    }
    const factUpdates = delta.updates.map((u) => toFactUpdate(u, charId));
    if (factUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, factUpdates, turnId, CHARACTER_FACTS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying fact updates on turn ${turnId}:`, err.message);
      }
    }

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_character: delta.current_character,
        current_stage: delta.current_stage,
      },
      CHARACTER_MESSAGES_COLLECTION
    );
    logTurnHeuristics(delta.reply, delta.context, turnId);

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_character: delta.current_character,
      current_stage: delta.current_stage,
      character_signed_off: delta.character_signed_off,
    });
```
Replace:
```ts
    const charId = resolveCharId(delta.current_character, foundation.cast, turnId);
    const p2State: P2State = story.p2 ?? { activeCharacterId: null, characterProgress: {} };
    const resolution = resolveCharacterTurn(
      p2State,
      charId,
      delta.current_character,
      delta.current_stage,
      delta.character_signed_off,
      delta.switch_override
    );

    if (!resolution.allowed) {
      console.warn(
        `[character-chat] blocked switch attempt to "${delta.current_character}" on turn ${turnId} - locked to "${resolution.activeProgress.characterName}" (no switch_override)`
      );

      const lastActiveMessage = [...recentMessages]
        .reverse()
        .find((m) => m.role === "assistant" && m.current_character === resolution.activeProgress.characterName);
      const repeatedQuestion =
        lastActiveMessage?.content ?? "What would you like to explore next for this character?";
      const redirectReply = `Let's finish ${resolution.activeProgress.characterName}'s profile first — we're at Stage ${resolution.activeProgress.stage} (${P2_STAGE_NAMES[resolution.activeProgress.stage]}).\n\n${repeatedQuestion}`;

      await appendMessage(
        storyId,
        {
          role: "assistant",
          content: redirectReply,
          ts: new Date().toISOString(),
          turnId,
          current_character: resolution.activeProgress.characterName,
          current_stage: resolution.activeProgress.stage,
        },
        CHARACTER_MESSAGES_COLLECTION
      );

      return NextResponse.json({
        reply: redirectReply,
        context: "",
        current_character: resolution.activeProgress.characterName,
        current_stage: resolution.activeProgress.stage,
        character_signed_off: false,
      });
    }

    for (const u of delta.updates) {
      if (!isKnownFieldId(u.field)) {
        console.warn(
          `[character-chat] unknown field "${u.field}" on turn ${turnId} - not in the Project 2 canonical registry, writing as-is`
        );
      }
    }
    const factUpdates = delta.updates.map((u) => toFactUpdate(u, charId));
    if (factUpdates.length > 0) {
      try {
        await applyStateDelta(storyId, factUpdates, turnId, CHARACTER_FACTS_COLLECTION);
      } catch (err) {
        if (!(err instanceof CanonConflictError)) throw err;
        console.warn(`[character-chat] unscreened conflict applying fact updates on turn ${turnId}:`, err.message);
      }
    }

    await setP2State(storyId, resolution.nextP2State);

    await appendMessage(
      storyId,
      {
        role: "assistant",
        content: delta.reply,
        ts: new Date().toISOString(),
        turnId,
        context: delta.context,
        current_character: delta.current_character,
        current_stage: resolution.stage,
      },
      CHARACTER_MESSAGES_COLLECTION
    );
    logTurnHeuristics(delta.reply, delta.context, turnId);

    return NextResponse.json({
      reply: delta.reply,
      context: delta.context,
      current_character: delta.current_character,
      current_stage: resolution.stage,
      character_signed_off: resolution.status === "signed_off",
    });
```

- [ ] **Step 4: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Manual read-through check**

Confirm by reading the edited function, tracing these scenarios end to end:
- A brand-new story (`story.p2` undefined) with the model proposing `current_character: "Deva"`, `current_stage: 1`, `switch_override: false`: `p2State` defaults to `{ activeCharacterId: null, ... }`, `resolveCharacterTurn` returns `allowed: true`, the turn proceeds exactly as before this change, and `setP2State` persists `activeCharacterId: "deva"`.
- A later turn where the model proposes `current_character: "Kade"` while Deva is still locked and `in_progress`, with `switch_override: false`: `resolution.allowed === false`; no `applyStateDelta` call happens; the appended/returned reply is the redirect referencing Deva's name and stage, not Kade's; `story.p2` is never touched (no `setP2State` call in this branch).
- The same attempted switch with `switch_override: true`: `resolution.allowed === true`; the reply, fact-update application, and `setP2State` call all proceed as the "allowed" path, with Deva's entry flipped to `"deferred"` inside `resolution.nextP2State`.
- A turn where `current_stage: 6` and `character_signed_off: true` is proposed for the already-locked character at `prevStage: 6`: `resolution.status === "signed_off"`, the response's `character_signed_off` is `true`, and `resolution.nextP2State.activeCharacterId === null` (unlocked for the next character).

- [ ] **Step 6: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: enforce P2 character lock and app-computed stage progression (#26)"
```
