# P2State Grounding Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #104 — the model has no per-turn signal of the app's own authoritative lock/stage state (`Story.p2`), so a clamp (issue #26) is "real for persistence but advisory for behavior": the model keeps interviewing as if it were still at its own claimed stage, and has no visibility into which characters are deferred or signed off once the bounded replayed transcript no longer mentions them.

**Architecture:** A new grounding block, added to `web/src/app/api/character-chat/route.ts` immediately after the existing Cast & Priority Matrix injection, following that block's exact "computed by the app, trust this over X" phrasing convention. `p2State` is already computed earlier in the same function (consumed by the Relationship Graph block further down) — this is a pure text-construction addition, no new fetch, no new import beyond what the file already has.

**Tech Stack:** TypeScript. No test runner is configured in this repo (`npm test` has no script) — verification is `npm run lint` (must be clean), `npm run build` (must succeed), and manual/code-trace verification, matching every other feature in this codebase.

## Global Constraints

- The new block's phrasing must follow the same "computed by the app, trust this over X. Internal grounding only, never narrate this raw data to the author." convention already used by the Cast & Priority Matrix block immediately above it.
- The active character's own progress must never appear twice in the block (once in the "Currently locked to" sentence, again in the "Other characters" list) — `otherProgressLines` must exclude `p2State.activeCharacterId`.
- No change to `resolveCharacterTurn`, `characterFsm.ts`, or any other grounding block already in this file (Cast & Priority Matrix, Story Spine & Dramatic Engine, Relationship Graph, Confirmed Facts So Far) — this only adds one new block, reading `p2State`, never writing it.
- No change to the switch-override redirect message (`redirectReply`, further down in this same file) — a separate, already-correct mechanism aimed at the author, not the model's internal grounding.

---

### Task 1: Add the Current Interview Lock grounding block

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `p2State: P2State` (already computed earlier in the `POST` handler, currently around line 203), `P2_STAGE_NAMES: Record<number, string>` (already imported from `characterFsm.ts` at the top of this file).

- [ ] **Step 1: Add the new grounding block right after the Cast & Priority Matrix injection**

Find this block (currently around lines 244-245):

```ts
    let system = getSystemPrompt("sp02-cdc-systemprompt.md");
    system += `\n\n[Cast & Priority Matrix - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author - synthesize it into your own evaluation.]\n${castLines}`;
```

Replace with:

```ts
    let system = getSystemPrompt("sp02-cdc-systemprompt.md");
    system += `\n\n[Cast & Priority Matrix - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author - synthesize it into your own evaluation.]\n${castLines}`;

    // Current Interview Lock grounding (issue #104) - the app's own
    // authoritative p2State, not the model's last claimed stage, so a
    // clamp (issue #26) converges the model's own next-turn behavior
    // instead of only being corrected at the data layer after the fact.
    // Rebuilt fresh every turn from persisted state (not just the
    // session's first turn), so it stays accurate across a resume or
    // after any clamp with no separate resume-specific code path.
    const activeProgress = p2State.activeCharacterId
      ? p2State.characterProgress[p2State.activeCharacterId]
      : null;
    const otherProgressLines = Object.entries(p2State.characterProgress)
      .filter(([id]) => id !== p2State.activeCharacterId)
      .map(([, progress]) => `- ${progress.characterName}: ${progress.status} (Stage ${progress.stage} - ${P2_STAGE_NAMES[progress.stage]})`)
      .join("\n");
    system += `\n\n[Current Interview Lock - computed by the app, trust this over your own prior belief or memory of this session. Internal grounding only, never narrate this raw data to the author.]\n${
      activeProgress
        ? `Currently locked to: ${activeProgress.characterName}, Stage ${activeProgress.stage} (${P2_STAGE_NAMES[activeProgress.stage]}).`
        : "No character is currently locked - free to start or resume anyone."
    }${otherProgressLines ? `\nOther characters:\n${otherProgressLines}` : ""}`;
```

- [ ] **Step 2: Verify**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings). Run `npm run build` from `web/` — must succeed.

Manually trace these cases against the code (no test runner in this repo, and exercising this via a real authenticated multi-character session isn't available in this environment):
- **No character locked, no progress at all** (a brand-new session, `p2State = { activeCharacterId: null, characterProgress: {} }`): confirm the block renders `"No character is currently locked - free to start or resume anyone."` with no trailing `"Other characters:"` header (since `otherProgressLines` is an empty string and the ternary correctly produces `""` for the whole trailing segment).
- **One character locked, no others yet**: confirm the block renders `"Currently locked to: <name>, Stage <N> (<stage name>)."` with no "Other characters" section (same empty-string reasoning).
- **One character locked, a second character deferred**: confirm the "Currently locked to" sentence names only the active character, and the "Other characters" list contains exactly one line for the deferred character (its `status`/`stage`) — and confirm the active character's OWN entry in `p2State.characterProgress` does NOT also appear in that list (the `.filter((...) => id !== p2State.activeCharacterId)` must exclude it).
- **A character signed off, `activeCharacterId` now `null`** (per `resolveCharacterTurn`'s own behavior: signing off clears the lock): confirm the block renders the "No character is currently locked" sentence, and the signed-off character DOES appear in "Other characters" with `status: "signed_off"` (since they're no longer `activeCharacterId`, they're not excluded by the filter).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "feat: inject app-computed P2State lock/stage into system-prompt grounding"
```
