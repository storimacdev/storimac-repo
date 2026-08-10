# P2 Session Persistence & Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #36 — close the two remaining gaps against its acceptance criteria: (1) the model has no signal that a character's already-Confirmed facts shouldn't be re-asked once they scroll out of the replay window, and (2) the resumed-session UI re-derives current character/stage from message-scanning instead of reading the persisted `P2State` it's already sent.

**Architecture:** Two small, independent, already-proven-pattern additions — no new persistence mechanism, no new files. A new system-prompt grounding block mirrors issue #31's Relationship Graph block exactly (same unconditional-injection philosophy, same file, adjacent code). The client-side resume fix reads a field (`story.p2`) that's already present in an existing API response payload.

**Tech Stack:** TypeScript, Next.js API routes, React 19 client component, Firestore (via existing `canonStore.ts`/`storyStore.ts` functions — no new reads beyond one `listElements` call).

## Global Constraints

- Every P2 persistence primitive this issue could plausibly need (per-character stage/status, fact states, relationship graph, outstanding-questions log) already exists from issues #26-#35 — this plan adds no new Firestore collections, fields, or write paths.
- The priority matrix is deliberately never persisted (ratified in ARCHITECTURE.md §7 / issue #37) — out of scope, not a gap.
- The Confirmed-facts grounding block is injected unconditionally for every character with a `characterProgress` entry, never conditionally scoped to "the current character" — the system prompt is built before the model reveals `current_character` for a turn, so conditional scoping is structurally impossible (the same reasoning issue #31 already resolved for relationships).
- Only `status === "Confirmed"` facts appear in the grounding block — Working/Exploring facts are excluded.
- No P2-side canon panel — explicitly out of scope per the approved design.
- No test framework exists in this codebase (established convention) — verification is `npm run lint && npm run build`, plus a manual read-through described per task.

---

### Task 1: Confirmed-facts grounding block

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `listElements`, `CHARACTER_FACTS_COLLECTION` (both already imported in this file); `relationshipGroundedIds` (already computed by the adjacent Relationship Graph block, issue #31 — reused here, not recomputed).
- Produces: nothing new exported — this is a system-prompt string addition only, with no downstream consumers inside this codebase.

- [ ] **Step 1: Insert the grounding block**

Find:
```ts
        relationshipLines.push(`- ${progress.characterName}${signedOffLabel}:\n${entryLines}`);
      }
      if (relationshipLines.length > 0) {
        system += `\n\n[Relationship Graph - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Consider ripple effects on these relationships before confirming a psychological change to a signed-off character.]\n${relationshipLines.join("\n")}`;
      }
    }

    if (story.p2PendingConflict) {
```
Replace:
```ts
        relationshipLines.push(`- ${progress.characterName}${signedOffLabel}:\n${entryLines}`);
      }
      if (relationshipLines.length > 0) {
        system += `\n\n[Relationship Graph - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Consider ripple effects on these relationships before confirming a psychological change to a signed-off character.]\n${relationshipLines.join("\n")}`;
      }
    }

    // Confirmed-facts grounding (issue #36) - the model's only other
    // signal that a fact is already settled is the bounded
    // CHARACTER_MESSAGE_WINDOW replayed transcript, which falls out of
    // scope on a long interview or a resumed session (a fresh, short
    // window). Mirrors the Relationship Graph block immediately above:
    // unconditional injection for every character with a
    // characterProgress entry (reusing the same relationshipGroundedIds
    // array, not recomputed), since current_character isn't known until
    // after this turn's model call - inject broadly and trust the model
    // to use what's relevant. Only Confirmed facts appear; Working/
    // Exploring facts are still legitimately being explored.
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

    if (story.p2PendingConflict) {
```

- [ ] **Step 2: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual read-through check**

Confirm by reading the function:
- A fixture `p2State.characterProgress` with two characters — one (`charA`) with 3 `Confirmed` facts and 2 `Working` facts, one (`charB`) with zero facts recorded at all: the block lists only `charA`, and only its 3 Confirmed fields — the 2 Working fields and `charB` are both absent from the output. (Trace: `factElements.filter(...&& e.status === "Confirmed")` excludes Working; `if (confirmed.length === 0) continue;` skips `charB` entirely.)
- A fixture where every character in `p2State.characterProgress` has zero Confirmed facts: no grounding block is appended at all — `factLines` stays empty, so the `if (factLines.length > 0)` guard skips the `system +=` line entirely, matching the Relationship Graph block's identical empty-case behavior three lines above it.
- `relationshipGroundedIds` is read, never mutated, by this new block — confirm the Relationship Graph block above still behaves identically (this task doesn't touch it).
- The new block runs `await listElements(storyId, CHARACTER_FACTS_COLLECTION)` — one additional Firestore read per turn, only when `relationshipGroundedIds.length > 0` (i.e., only once at least one character has a `characterProgress` entry — never on the very first turn of a brand new story).

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: add Confirmed-facts grounding block so P2 doesn't re-ask settled material (#36)"
```

---

### Task 2: Resume reads persisted P2State instead of message-scanning

**Files:**
- Modify: `web/src/components/CharacterInterview.tsx`

**Interfaces:**
- Consumes: `type P2State` from `@/lib/canonEngine/storyStore` (already exists, exported from that module — `interface P2State { activeCharacterId: string | null; characterProgress: Record<string, P2CharacterProgress> }`, `interface P2CharacterProgress { characterName: string; stage: number; status: P2CharacterStatus }` where `P2CharacterStatus` is `"in_progress" | "deferred" | "signed_off"`). `data.story.p2` is already present in the existing `GET /api/workspaces/[workspaceId]/canvases/[canvasId]?characterMessages=1` response payload (that route returns the full `Story` document, which already includes `p2` — no backend change needed).

Independent of Task 1 (different file, no shared code) — order between them doesn't matter.

- [ ] **Step 1: Add the type-only import**

Find:
```tsx
import { downloadText, downloadBlob } from "@/lib/download";
import type { CharacterBibleEntry } from "@/lib/canonEngine/storyStore";
import { renderCharacterBibleMarkdown } from "@/lib/characterEngine/characterBibleMarkdown";
```
Replace:
```tsx
import { downloadText, downloadBlob } from "@/lib/download";
import type { CharacterBibleEntry, P2State } from "@/lib/canonEngine/storyStore";
import { renderCharacterBibleMarkdown } from "@/lib/characterEngine/characterBibleMarkdown";
```

- [ ] **Step 2: Read `data.story.p2` before falling back to message-scanning**

Find:
```tsx
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));
        const lastAssistant = [...rawMessages].reverse().find((m) => m.role === "assistant" && m.current_character);
        if (lastAssistant) {
          setContext(lastAssistant.context ?? null);
          setCurrentCharacter(lastAssistant.current_character ?? null);
          setCurrentStage(lastAssistant.current_stage ?? null);
        }
```
Replace:
```tsx
        setMessages(rawMessages.map((m) => ({ role: m.role, content: m.content })));

        // Prefer the persisted, authoritative P2State over re-deriving
        // current character/stage from message metadata (issue #36) -
        // data.story.p2 is already sent by this endpoint, just unread
        // until now. context has no structured equivalent in P2State
        // (it's the model's free-text reasoning, not session state), so
        // it still comes from the last assistant message regardless.
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

- [ ] **Step 3: Verify lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Manual read-through check**

Confirm by reading the function:
- A fixture resume payload with `data.story.p2 = { activeCharacterId: "deva", characterProgress: { deva: { characterName: "Deva Okonkwo-Price", stage: 4, status: "in_progress" } } }` and at least one assistant message with `current_character`/`context` set: `currentCharacter` becomes `"Deva Okonkwo-Price"` and `currentStage` becomes `4` from `activeProgress` (not from the message), `characterSignedOff` becomes `false`, and `context` still comes from `lastAssistant.context` — confirm the final `if (!activeProgress && lastAssistant)` fallback block does NOT run in this case (since `activeProgress` is truthy), so it can't clobber the values just set.
- A fixture resume payload with `data.story.p2 = { activeCharacterId: null, characterProgress: {} }` (a Story Canvas created but P2 never started) and zero character messages: `activeProgress` is `undefined`, `lastAssistant` is `undefined` (no messages to scan), so `currentCharacter`/`currentStage`/`context` all stay at their initial `null` state — matching today's brand-new-session behavior exactly, no regression.
- A fixture resume payload with `data.story.p2` entirely absent (`undefined`) but chat history present (an edge case that shouldn't occur in practice, since every story that's had a P2 turn has `p2` set, but costs nothing to guard): `p2` is `undefined`, `activeProgress` is `undefined`, so the final fallback block runs and reproduces the exact pre-this-change behavior (derive `currentCharacter`/`currentStage` from `lastAssistant`).
- A fixture resume payload with `data.story.p2.activeCharacterId` set to a charId that has NO matching entry in `characterProgress` (shouldn't happen given how `setP2State` is always called with the full map, but is a cheap defensive case to trace): `p2.characterProgress[p2.activeCharacterId]` is `undefined`, so `activeProgress` is `undefined`, and the fallback block correctly takes over instead of crashing or silently leaving state at `null` when message data was actually available.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/CharacterInterview.tsx
git commit -m "feat: resume P2 sessions from persisted P2State instead of message-scanning (#36)"
```
