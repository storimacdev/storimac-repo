# Stable Cast-Member charId Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision note:** Task 1's `assignCharIds` as written below checked for
> collisions against each name's base slug (a count per slug), not against
> the actual `charId` values already assigned. A final whole-branch review
> found this let a member's own name collide with another member's
> disambiguated id (e.g. two "Villager"s plus a "Villager 2"), and let a
> disambiguating suffix push a charId's length past `MAX_CHAR_ID_LENGTH`
> (silently wiped every turn by `character-chat/route.ts`'s pre-existing,
> unrelated self-heal logic). A follow-up fix commit (`8817a048`) replaced
> the base-slug counter with a check against the actual ids already
> issued, re-truncating before appending a suffix. See
> `docs/superpowers/specs/2026-09-08-stable-cast-charid-design.md` (updated
> in place) for the corrected design. Tasks 2-3 needed no changes — the
> bug was confined to Task 1's helper.

**Goal:** Fix issue #105 — cast members whose names slugify identically currently share fact storage, lock/progress state, and tier classification, because four independent call sites each re-derive `slugifyCharacterName(name)` on their own with no way to tell two colliding characters apart.

**Architecture:** `CastMember` (`characterEngine/ingestFoundation.ts`) gains a `charId: string` field, assigned once inside `extractCast` — the first cast member to produce a given slug in an ingestion pass keeps the plain slug; any later member with the same slug gets a disambiguating `_2`/`_3`/... suffix. Every consumer that previously re-derived a slug independently now reads `member.charId` directly instead.

**Tech Stack:** TypeScript, Firebase Admin/Firestore. No test runner is configured in this repo (`npm test` has no script) — verification is `npm run lint` (must be clean), `npm run build` (must succeed), and manual/code-trace verification, matching every other feature in this codebase. `ingestFoundation.ts`'s parsing logic is pure/testable-with-fixtures by its own design (per its file header) but has no actual test file — Task 1's verification traces concrete input/output pairs by hand.

## Global Constraints

- For a cast with no name collisions, every `charId` must be byte-identical to today's plain `slugifyCharacterName(name)` output — zero behavior change for the common case.
- Disambiguation is assigned once per `ingestFoundation`/`extractCast` call, based on that call's cast-array order — the first cast member to produce a given base slug keeps the plain slug; each subsequent collision gets `_2`, `_3`, etc.
- The raw-slugify fallback path in `resolveCharId` (when the model names someone not resolvable in the cast list at all) and `characterBibleGate.ts`'s corresponding fallback-name matching are both explicitly out of scope — neither changes.
- No change to the causal-chain enforcement logic itself (issue #28) or the FSM/lock logic itself (issue #26) — only the identity key those systems already key off.
- No change to cross-Foundation-Document-regeneration `charId` stability — not guaranteed before this fix, not guaranteed after it, not part of this issue's scope.

---

### Task 1: Assign a stable `charId` in `ingestFoundation.ts`

**Files:**
- Modify: `web/src/lib/characterEngine/ingestFoundation.ts`

**Interfaces:**
- Produces: `CastMember.charId: string` (new required field — every existing consumer of `CastMember` that doesn't read this field is unaffected by its addition; consumers that need to STOP re-deriving a slug and start reading this field are Tasks 2 and 3).
- Produces: `assignCharIds(members: Omit<CastMember, "charId">[]): CastMember[]` (new local function, not exported).

- [ ] **Step 1: Add `charId` to the `CastMember` interface**

Find (currently lines 18-23):

```ts
export interface CastMember {
  name: string;
  story_role: string;
  description: string;
  primary_function: string;
}
```

Replace with:

```ts
export interface CastMember {
  name: string;
  story_role: string;
  description: string;
  primary_function: string;
  /**
   * Stable identity for this cast member within one ingestion pass
   * (issue #105) - the FIRST cast member to produce a given
   * slugifyCharacterName(name) value in this pass keeps that plain slug;
   * any LATER member whose name slugifies to a value already used gets a
   * disambiguating "_2"/"_3"/... suffix (see assignCharIds below). Every
   * consumer that used to re-derive slugifyCharacterName(name)
   * independently (resolveCharId, the causal-chain tier lookup,
   * checkCharacterBibleComplete) now reads this field instead, so two
   * colliding cast members can no longer be confused with each other.
   * NOT guaranteed stable across a Foundation Document regeneration
   * (out of scope for issue #105) - only guaranteed unique within one
   * ingestFoundation call's cast array.
   */
  charId: string;
}
```

- [ ] **Step 2: Add the `assignCharIds` helper**

Find the import line at the top of the file:

```ts
import { listDocumentVersions, getDocumentVersion, type FoundationDocument, type StoredDocumentVersion } from "@/lib/canonEngine/foundationDoc";
```

Add a second import right after it:

```ts
import { slugifyCharacterName } from "./characterId";
```

Then add the new function right after the `CastMember` interface (before `IngestedFoundation`):

```ts
/** Assigns issue #105's stable charId to each parsed cast member. The
 * first member to produce a given base slug in this pass keeps the plain
 * slug (byte-identical to pre-#105 behavior for a non-colliding cast);
 * each later collision on the same base slug gets a "_2"/"_3"/...
 * suffix, based on this pass's array order. */
function assignCharIds(members: Omit<CastMember, "charId">[]): CastMember[] {
  const seenCounts = new Map<string, number>();
  return members.map((member) => {
    const baseSlug = slugifyCharacterName(member.name);
    const occurrence = (seenCounts.get(baseSlug) ?? 0) + 1;
    seenCounts.set(baseSlug, occurrence);
    const charId = occurrence === 1 ? baseSlug : `${baseSlug}_${occurrence}`;
    return { ...member, charId };
  });
}
```

- [ ] **Step 3: Wire `assignCharIds` into `extractCast`**

Find `extractCast` (currently lines 40-62):

```ts
function extractCast(raw: unknown[]): { cast: CastMember[]; skippedCount: number } {
  const cast: CastMember[] = [];
  let skippedCount = 0;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      if (typeof o.name === "string" && o.name.trim()) {
        cast.push({
          name: o.name.trim(),
          story_role: typeof o.story_role === "string" ? o.story_role : "",
          description: typeof o.description === "string" ? o.description : "",
          primary_function: typeof o.primary_function === "string" ? o.primary_function : "",
        });
        continue;
      }
    } else if (typeof entry === "string" && entry.trim()) {
      cast.push({ name: entry.trim(), story_role: "", description: "", primary_function: "" });
      continue;
    }
    skippedCount++;
  }
  return { cast, skippedCount };
}
```

Replace with:

```ts
function extractCast(raw: unknown[]): { cast: CastMember[]; skippedCount: number } {
  const parsed: Omit<CastMember, "charId">[] = [];
  let skippedCount = 0;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      if (typeof o.name === "string" && o.name.trim()) {
        parsed.push({
          name: o.name.trim(),
          story_role: typeof o.story_role === "string" ? o.story_role : "",
          description: typeof o.description === "string" ? o.description : "",
          primary_function: typeof o.primary_function === "string" ? o.primary_function : "",
        });
        continue;
      }
    } else if (typeof entry === "string" && entry.trim()) {
      parsed.push({ name: entry.trim(), story_role: "", description: "", primary_function: "" });
      continue;
    }
    skippedCount++;
  }
  return { cast: assignCharIds(parsed), skippedCount };
}
```

(Only the variable name `cast` → `parsed` inside the loop, its type annotation, and the final `return` line change — the parsing logic itself, including every `continue`/`skippedCount++`, is untouched.)

- [ ] **Step 4: Verify**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings). Run `npm run build` from `web/` — must succeed (this also confirms every other file that constructs or reads a `CastMember` still type-checks against the new required field — if Task 1 alone breaks the build, it means some other file constructs a `CastMember` literal directly instead of going through `extractCast`/`ingestFoundation`; if so, note this in your report as a NEEDS_CONTEXT rather than guessing a fix).

This module is pure/I-O-free in its extraction logic (no test runner in this repo) — trace these cases by hand and show your work in the report:
- **No collision**: `extractCast` given three cast entries with distinct names (e.g. "Deva Okonkwo", "Marcus Webb", "Sana Reyes"). Confirm every resulting `charId` is byte-identical to `slugifyCharacterName(name)` for that same name — no suffix anywhere.
- **A real collision**: `extractCast` given two entries, `"Deva Okonkwo"` and `"Deva-Okonkwo"` (both slugify to `"deva_okonkwo"`). Confirm the FIRST entry's `charId` is exactly `"deva_okonkwo"` (no suffix) and the SECOND entry's `charId` is exactly `"deva_okonkwo_2"`.
- **Three-way collision**: three entries all slugifying to the same base slug. Confirm `charId`s are `"<base>"`, `"<base>_2"`, `"<base>_3"` in that order.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/characterEngine/ingestFoundation.ts
git commit -m "feat: assign a stable, collision-disambiguated charId to each cast member"
```

---

### Task 2: Use `charId` in `character-chat/route.ts`'s `resolveCharId` and tier lookup

**Files:**
- Modify: `web/src/app/api/character-chat/route.ts`

**Interfaces:**
- Consumes: `CastMember.charId` from Task 1.

- [ ] **Step 1: Import the `CastMember` type**

Find this import line (currently around line 26):

```ts
import { ingestFoundation } from "@/lib/characterEngine/ingestFoundation";
```

Replace with:

```ts
import { ingestFoundation, type CastMember } from "@/lib/characterEngine/ingestFoundation";
```

- [ ] **Step 2: Update `resolveCharId` to read `.charId`**

Find `resolveCharId` (currently lines 68-83):

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

Replace with:

```ts
function resolveCharId(currentCharacter: string, cast: CastMember[], turnId: string): string {
  const normalized = currentCharacter.trim().toLowerCase();
  const exact = cast.find((m) => m.name.trim().toLowerCase() === normalized);
  if (exact) return exact.charId;

  const prefixMatches = cast.filter((m) => {
    const castName = m.name.trim().toLowerCase();
    return castName.startsWith(normalized) || normalized.startsWith(castName);
  });
  if (prefixMatches.length === 1) return prefixMatches[0].charId;

  console.warn(
    `[character-chat] current_character "${currentCharacter}" on turn ${turnId} didn't match a unique cast member (${prefixMatches.length} candidates) - falling back to raw slugify`
  );
  return slugifyCharacterName(currentCharacter);
}
```

Only three changes: the parameter type `{ name: string }[]` → `CastMember[]`, `return slugifyCharacterName(exact.name);` → `return exact.charId;`, and `return slugifyCharacterName(prefixMatches[0].name);` → `return prefixMatches[0].charId;`. The final fallback line (`return slugifyCharacterName(currentCharacter);`) and the `console.warn` above it are unchanged — that fallback path has no cast member to read a `charId` from.

`slugifyCharacterName` stays imported and used (by that unchanged fallback line), so do not remove its import.

- [ ] **Step 3: Update the causal-chain tier lookup**

Find this line (currently around line 432):

```ts
    const castIndex = foundation.cast.findIndex((m) => slugifyCharacterName(m.name) === charId);
```

Replace with:

```ts
    const castIndex = foundation.cast.findIndex((m) => m.charId === charId);
```

- [ ] **Step 4: Verify**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from `web/` — must succeed.

Manually trace (no test runner in this repo, and exercising this via a real authenticated multi-character session isn't available in this environment):
- Confirm `resolveCharId`'s exact-match branch, when given two cast members whose names both slugify to the same base value (per Task 1's `assignCharIds` disambiguation), returns the FIRST one's plain slug when `currentCharacter` matches the first by exact name, and the SECOND one's `_2`-suffixed `charId` when `currentCharacter` matches the second by exact name — i.e. the two are now genuinely distinguishable, not merged.
- Confirm the tier lookup's `castIndex` correctly finds the cast member whose `charId` matches, even when a second cast member with a colliding base slug exists earlier or later in the array — it should never accidentally match the WRONG colliding member, since `charId` values are now unique per Task 1.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/character-chat/route.ts
git commit -m "fix: resolve charId from the cast list's own stable id, not a re-derived slug"
```

---

### Task 3: Use `charId` in `characterBibleGate.ts`'s completion check

**Files:**
- Modify: `web/src/lib/worldEngine/characterBibleGate.ts`

**Interfaces:**
- Consumes: `CastMember.charId` from Task 1.

- [ ] **Step 1: Update the sign-off lookup to use `.charId`**

Find this line (currently around line 23), inside `checkCharacterBibleComplete`:

```ts
      if (progress[slugifyCharacterName(member.name)]?.status === "signed_off") return false;
```

Replace with:

```ts
      if (progress[member.charId]?.status === "signed_off") return false;
```

Do not change anything else in this function — the `bySignedOffName` fallback block immediately below (matching a sign-off's `characterName` field, for the case where the progress entry came from `resolveCharId`'s raw-slugify fallback rather than a real cast member) is untouched, and the `slugifyCharacterName` import at the top of the file becomes unused after this change — remove that now-unused import line:

```ts
import { slugifyCharacterName } from "@/lib/characterEngine/characterId";
```

(delete this line entirely; the file's other import, `type CastMember` from `ingestFoundation`, stays).

- [ ] **Step 2: Verify**

Run `npm run lint` from `web/` — must be clean (this specifically catches an unused-import lint error if the `slugifyCharacterName` import wasn't actually removed in Step 1). Run `npm run build` from `web/` — must succeed.

Manually trace:
- Confirm a cast with two members colliding on the same base slug, where only the SECOND one (whose `charId` carries the `_2` suffix per Task 1) has signed off, is correctly reported as complete for that member and incomplete for the first — i.e. the gate no longer treats them as the same person.
- Confirm the existing `bySignedOffName` fallback path (unrelated to this fix) still works unchanged for a progress entry keyed by `resolveCharId`'s raw-slugify fallback.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/worldEngine/characterBibleGate.ts
git commit -m "fix: key the Character Bible completion gate off charId, not a re-derived slug"
```
