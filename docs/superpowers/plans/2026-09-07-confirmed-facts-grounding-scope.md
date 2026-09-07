# Confirmed-Facts Grounding Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #107 — the Character Bible interview's Confirmed-facts grounding block currently dumps every Confirmed fact for every character with a `characterProgress` entry, every turn, unbounded; scope it to just the active character plus already-signed-off characters, and truncate each included fact's value as defense-in-depth.

**Architecture:** Two small local helper functions in `web/src/app/api/character-chat/route.ts` — `computeGroundedCharacterIds(p2State)` (returns the active character's id plus every signed-off character's id, using the app's own authoritative `p2State.activeCharacterId` lock state rather than the model's self-reported field) and `truncateFactValue(value)` (caps a fact's value at 200 chars) — wired into the existing Confirmed-facts block's loop.

**Tech Stack:** Next.js 16 App Router (TypeScript), Firebase Admin/Firestore. No test runner is configured in this repo (`npm test` has no script) — verification is `npm run lint` (must be clean), `npm run build` (must succeed), and manual/code-trace verification, matching every other feature in this codebase.

## Global Constraints

- The Relationship Graph block (immediately above the Confirmed-facts block in the same file) is unchanged — it's O(characters), not flagged by this issue, out of scope.
- `computeGroundedCharacterIds` returns signed-off character ids only when `p2State.activeCharacterId` is `null` (no character currently locked) — it must not fall back to "every character" in that case.
- `computeGroundedCharacterIds` must not return a duplicate id if `activeCharacterId` also happens to already be in the signed-off set (defensive; shouldn't happen per the FSM invariant that signing off clears `activeCharacterId`, but the plan requires the guard regardless).
- Each fact value truncates at exactly 200 characters, with `…` appended only when actually truncated (a value of exactly 200 chars or fewer is untouched, no trailing `…`).
- No change to `CHARACTER_MESSAGE_WINDOW`, the FSM's locking/sign-off logic, or `characterBibleEntries` — all explicitly out of scope per the spec.

---

### Task 1: Scope and truncate the Confirmed-facts grounding block

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Produces: `computeGroundedCharacterIds(p2State: P2State): string[]` and `truncateFactValue(value: unknown): string` (new local functions in this file, not exported — nothing outside this file consumes them).

- [ ] **Step 1: Add the two helper functions**

Find `resolveCharId` (currently around line 68-83) — the file's existing pattern for small local helper functions declared at module scope, right after the imports:

```ts
function resolveCharId(currentCharacter: string, cast: { name: string }[], turnId: string): string {
  const normalized = currentCharacter.trim().toLowerCase();
  const exact = cast.find((m) => m.name.trim().toLowerCase() === normalized);
  if (exact) return slugifyCharacterName(exact.name);

  const prefixMatches = cast.filter((m) => {
    const castName = m.name.trim().toLowerCase();
    return castName.startsWith(normalized) || normalized.startsWith(castName);
  });
  if (prefixMatches.length === 1) return slugifyCharacterName(prefixMatches[0].name);

  console.warn(
    `[character-chat] current_character "${currentCharacter}" on turn ${turnId} didn't match a unique cast member (${prefixMatches.length} candidates) - falling back to raw slugify`
  );
  return slugifyCharacterName(currentCharacter);
}
```

Add the two new helpers immediately after it (before `toFactUpdate`):

```ts
// Confirmed-facts grounding scope (issue #107) - the app already knows
// which single character is currently locked (p2State.activeCharacterId,
// set by the sequential-interview FSM, issue #26) before this turn's
// model call ever happens. That's a materially better scoping signal
// than the model's own self-reported current_character field, and lets
// the grounding block below stop dumping every character's facts on
// every turn regardless of relevance.
function computeGroundedCharacterIds(p2State: P2State): string[] {
  const signedOffIds = Object.entries(p2State.characterProgress)
    .filter(([, progress]) => progress.status === "signed_off")
    .map(([id]) => id);
  if (!p2State.activeCharacterId) return signedOffIds;
  return signedOffIds.includes(p2State.activeCharacterId)
    ? signedOffIds
    : [p2State.activeCharacterId, ...signedOffIds];
}

// Defense-in-depth against a single character's free-text fact value
// being very long - scoping (computeGroundedCharacterIds above) bounds
// how many characters contribute to the block, this bounds how much any
// one of them can contribute.
function truncateFactValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
```

- [ ] **Step 2: Wire the helpers into the Confirmed-facts block**

Find this block (currently around line 297-312):

```ts
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
```

Replace with:

```ts
    const groundedCharacterIds = computeGroundedCharacterIds(p2State);
    if (groundedCharacterIds.length > 0) {
      const factElements = await listElements(storyId, CHARACTER_FACTS_COLLECTION);
      const factLines: string[] = [];
      for (const id of groundedCharacterIds) {
        const progress = p2State.characterProgress[id];
        const confirmed = factElements.filter((e) => e.element_id.startsWith(`${id}.`) && e.status === "Confirmed");
        if (confirmed.length === 0) continue;
        const fieldLines = confirmed
          .map((e) => `  - ${e.element_id.slice(id.length + 1)}: ${truncateFactValue(e.value)}`)
          .join("\n");
        factLines.push(`- ${progress.characterName}:\n${fieldLines}`);
      }
      if (factLines.length > 0) {
        system += `\n\n[Confirmed Facts So Far - computed by the app, trust this over re-deriving it. Internal grounding only, never narrate this raw data to the author. Do not re-ask about any fact listed here as Confirmed - treat it as already settled and move the interview forward.]\n${factLines.join("\n")}`;
      }
    }
```

The only changes: `relationshipGroundedIds` → `computeGroundedCharacterIds(p2State)` (assigned to a new local `groundedCharacterIds` so the block reads clearly as its own scope, distinct from the Relationship Graph block's own `relationshipGroundedIds` immediately above it, which is untouched), and the field-value interpolation now calls `truncateFactValue(e.value)` instead of the inline `typeof e.value === "string" ? e.value : JSON.stringify(e.value)` ternary.

Do not touch the Relationship Graph block immediately above this one (currently around line 258-284) — it still uses its own `relationshipGroundedIds` variable, unchanged.

- [ ] **Step 3: Verify**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings). Run `npm run build` from `web/` — must succeed.

Manually trace the code (no test runner in this repo, and exercising this via a real authenticated session with a multi-character cast isn't available in this environment):
- Confirm `computeGroundedCharacterIds` returns only signed-off ids when `p2State.activeCharacterId` is `null`.
- Confirm it returns `[activeId, ...signedOffIds]` when a character is locked and that character is NOT already in `signedOffIds`.
- Confirm it returns just `signedOffIds` (no duplicate) when `activeCharacterId` happens to already be present in `signedOffIds` (the defensive guard).
- Confirm `truncateFactValue` returns a value unchanged when its length is ≤ 200, and appends exactly one `…` when truncating a longer value at exactly 200 characters.
- Confirm the Relationship Graph block's own `relationshipGroundedIds` variable and loop are byte-identical to before this change — grep the diff to confirm no lines in that block changed.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "fix: scope and truncate Confirmed-facts grounding block"
```
