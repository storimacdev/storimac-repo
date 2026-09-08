# Stable Cast-Member charId (Issue #105) — Design

## Problem

Project 2 identifies characters by `slugifyCharacterName(name)` (lowercase,
non-alphanumeric runs collapsed to `_`, capped at
`MAX_CHAR_ID_LENGTH` = 60), re-derived independently at **four** separate
call sites, every time each one runs:

1. `character-chat/route.ts`'s `resolveCharId` — resolves the model's
   self-reported `current_character` against the cast list (exact match,
   then unique-prefix match, then a raw-slugify fallback), returning
   `slugifyCharacterName(exact.name)` / `slugifyCharacterName(prefixMatches[0].name)`.
2. `character-chat/route.ts`'s causal-chain tier lookup:
   `foundation.cast.findIndex((m) => slugifyCharacterName(m.name) === charId)`
   — picks the FIRST array match.
3. `worldEngine/characterBibleGate.ts`'s `checkCharacterBibleComplete` —
   `progress[slugifyCharacterName(member.name)]?.status === "signed_off"`.
4. (Not an independent re-derivation, but a downstream consumer of #1's
   result:) `P2State.characterProgress`'s keys, and every
   `${charId}.${field}` Canon Element id `toFactUpdate` writes.

`CastMember` (`characterEngine/ingestFoundation.ts`), re-parsed fresh from
Project 1's Foundation Document JSON on every `ingestFoundation` call, has
no identity field at all:

```ts
export interface CastMember {
  name: string;
  story_role: string;
  description: string;
  primary_function: string;
}
```

If two cast members' names slugify to the same value (e.g. "Deva Okonkwo"
and "Deva-Okonkwo", or `resolveCharId`'s prefix-matching collapses two
similarly-named characters together), the four call sites above can't
tell them apart: their fact sets merge into one document (#1's result
feeding `toFactUpdate`), they share one FSM lock/stage counter (`P2State
.characterProgress`), the tier lookup silently attributes the FIRST
matching cast member's tier/name/story_role to the second (#2), and the
Character Bible completion gate can key a sign-off to the wrong slug
entirely (#3).

## Fix: a `charId` field assigned once, centrally

Add `charId: string` to `CastMember`, computed once inside
`ingestFoundation.ts`'s cast-parsing step (`extractCast`) — the one place
`foundation.cast` is actually parsed from the raw Foundation Document
JSON. Every one of the four call sites above then reads `member.charId`
directly instead of re-deriving.

### Disambiguation scheme: slug-first, suffix only on collision

Not index-based (`charId = "cast_" + index`, unconditionally): Project 1
can regenerate the Foundation Document (its own completion-lock feature
lets an author unlock, edit, and regenerate), and a regeneration can
reorder or resize the cast array with no name collision involved at all —
a purely index-based id would silently swap two characters' identities on
every such regeneration, breaking far more often than the actual
collision bug this issue is about.

Not a content hash (hash of name + role + description, unconditionally):
still theoretically collidable (two people with identical name/role/
description text), adds a dependency and a layer of indirection for no
real benefit over the simpler scheme below, and isn't any more stable
across a regeneration than the scheme below is (a described character
can be edited enough between versions to invalidate a hash just as
easily as it can shift array position).

Instead: keep computing the plain `slugifyCharacterName(name)` for the
FIRST cast member to produce a given slug in that ingestion pass — this
is byte-identical to today's behavior in the common (no collision) case,
satisfying the issue's own "existing behavior for the common case is
unchanged" acceptance criterion literally. Any LATER cast member in the
same pass whose name slugifies to a value already used gets a
disambiguating numeric suffix appended (`_2`, `_3`, ...), based on that
pass's cast-array order.

> **Revision note:** the first version of this function checked for
> collisions against each name's *base slug* (a `Map<string, number>`
> counting how many times each base slug had been seen), not against the
> actual `charId` values already handed out. A final whole-branch review
> found two real bugs that fall out of that: (1) a cast member whose OWN
> name happens to slugify to `"<base>_2"` could collide with a different
> member's disambiguated id (e.g. two "Villager"s plus a "Villager 2" all
> produce `"villager"`/`"villager_2"`/`"villager_2"` — a genuine
> duplicate); (2) appending a suffix after `slugifyCharacterName`'s own
> 60-char cap can push the result past `MAX_CHAR_ID_LENGTH`, which
> `character-chat/route.ts`'s pre-existing (unrelated, already-shipped)
> self-heal logic then treats as corrupted and silently deletes every
> turn — permanently resetting that character's interview progress. The
> version below checks against the actual ids already assigned (a
> `Set<string>`, re-looping and re-truncating until a genuinely free id
> under the cap is found) instead of a base-slug counter, closing both
> gaps while keeping every no-collision/two-way/three-way trace
> byte-identical to the original version's output.

```ts
function assignCharIds(members: Omit<CastMember, "charId">[]): CastMember[] {
  const used = new Set<string>();
  return members.map((member) => {
    const baseSlug = slugifyCharacterName(member.name);
    let charId = baseSlug;
    let occurrence = 1;
    while (used.has(charId)) {
      occurrence++;
      const suffix = `_${occurrence}`;
      charId = `${baseSlug.slice(0, MAX_CHAR_ID_LENGTH - suffix.length)}${suffix}`;
    }
    used.add(charId);
    return { ...member, charId };
  });
}
```

`extractCast` calls this once, after building its existing
`{name, story_role, description, primary_function}` list, instead of
returning that list directly:

```ts
function extractCast(raw: unknown[]): { cast: CastMember[]; skippedCount: number } {
  const parsed: Omit<CastMember, "charId">[] = [ /* ...unchanged parsing loop... */ ];
  return { cast: assignCharIds(parsed), skippedCount };
}
```

Cross-regeneration identity drift (a character's `charId` changing
between two Foundation Document versions because their disambiguation
count changed, or their name changed) is explicitly **out of scope** —
see below. This fix is about two DIFFERENT characters colliding with
EACH OTHER within one ingestion pass, not about a single character's id
staying constant forever across edits; the latter isn't guaranteed by
`slugifyCharacterName` today either (a renamed character already gets a
different id on the next turn, collision or not), so this fix doesn't
regress anything that was previously guaranteed.

## Updating the four call sites

**1. `resolveCharId`** (`character-chat/route.ts`) — change its signature
from `cast: { name: string }[]` to `cast: CastMember[]` (importing the
real type instead of an ad hoc inline shape), and return `.charId`
instead of re-slugifying:

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

  console.warn(/* unchanged */);
  return slugifyCharacterName(currentCharacter);
}
```

The raw-slugify **fallback** (last line, when the model names someone not
resolvable in the cast at all) is unchanged — there's no cast member to
attach a stable id to in that case; it's a separate, already-accepted
edge case (already worked around in `characterBibleGate.ts`'s own
fallback-name matching, untouched by this fix).

**2. The causal-chain tier lookup** (`character-chat/route.ts`):

```ts
const castIndex = foundation.cast.findIndex((m) => m.charId === charId);
```

replaces the `slugifyCharacterName(m.name) === charId` comparison — same
`findIndex` shape, matching on the stable id instead of re-deriving it.

**3. `checkCharacterBibleComplete`** (`worldEngine/characterBibleGate.ts`):

```ts
if (progress[member.charId]?.status === "signed_off") return false;
```

replaces `progress[slugifyCharacterName(member.name)]?.status === "signed_off"`.
The function's existing fallback-name-matching block (matching a
sign-off's `characterName` field when the progress key came from
`resolveCharId`'s raw-slugify fallback instead of a real cast member) is
unchanged — that's the same already-accepted fallback-path edge case
from point 1, not something this fix touches.

**4. `P2State.characterProgress` keys / `toFactUpdate`'s element ids** —
no direct change needed; both already key off whatever `resolveCharId`
returns, so fixing point 1 alone makes both correctly disambiguated with
zero additional code.

## Edge cases

- **No collision** (the common case): every `charId` is byte-identical to
  today's plain `slugifyCharacterName(name)` output — zero behavior
  change for every existing Story with a non-colliding cast.
- **Three or more cast members colliding on the same base slug**: the
  first keeps the plain slug, the second gets `_2`, the third `_3`, and
  so on — `assignCharIds`'s counter handles any occurrence count, not
  just two.
- **A collision between the model's raw-slugify fallback output and a
  real cast member's disambiguated `charId`**: unaffected by this fix —
  already a distinct, pre-existing, accepted edge case (the fallback
  only fires when the model names someone the cast list can't resolve at
  all, so there's no real cast member's `charId` to collide with in the
  first place; if the model's raw text happens to slugify to the same
  value as some OTHER real cast member's plain slug, that's the same
  fallback-vs-cast-list ambiguity that already existed before this fix,
  unrelated to the two-real-cast-members-collide bug this issue targets).

## Out of scope

- Any change to the causal-chain enforcement logic itself (issue #28,
  already shipped) or the FSM/lock logic itself (issue #26, already
  shipped) — this is purely about the identity key those systems already
  key off, per the issue's own explicit scope note.
- Cross-Foundation-Document-regeneration `charId` stability — not
  guaranteed before this fix, not guaranteed after it, and not part of
  this issue's acceptance criteria (see "Fix" section above).
- The raw-slugify fallback path in `resolveCharId` (an unresolvable
  model-reported character name) and its corresponding fallback-name
  matching in `characterBibleGate.ts` — both stay exactly as they are.
