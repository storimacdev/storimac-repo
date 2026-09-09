# Canon Ingestion Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Project 4's Canon Ingestion Module (issue #55) — a single
async entry point, `ingestCanon(storyId)`, that reads Projects 1-3's
already-finished canon directly from Firestore and returns one
structured, indexed object plus a list of any gaps, ready for P4's
Structure work (issue #58 onward) to consume.

**Architecture:** One new file, `web/src/lib/storyArchitectureEngine/ingestCanon.ts`,
following the existing "pure extraction / thin async wrapper" split
already proven in `characterEngine/ingestFoundation.ts` — each project's
ingestion is a small async function that fetches from Firestore via that
project's existing typed accessors, then hands off to plain data
transforms with no I/O (so they can be manually traced against concrete
inputs, matching this repo's no-test-runner convention). Project 1
ingestion reuses `ingestFoundation.ts`'s existing, already-tested
`extractIngestedFoundation` for cast/spine/dramatic-engine extraction
(including its stable `charId` assignment) rather than re-parsing
`9_principal_characters` from scratch.

**Tech Stack:** TypeScript. No test runner is configured in this repo
(`npm test` has no script) — verification is `npm run lint` (must be
clean), `npm run build` (must succeed), and manual/code-trace
verification against concrete input/output pairs, matching every other
feature in this codebase.

## Global Constraints

- Ingest all three projects directly from Firestore via each project's
  existing typed accessor — never via `.docx` parsing (design decision,
  overriding issue #55's currently-stated "P2/P3 via `.docx`" AC text:
  P2's `.docx` is generated FROM this same Firestore data, and P3 has no
  `.docx` export at all).
- Extract Project 1 fields by the compiled document's own stable
  field-name keys (`"2_story_dna"`, `"3_story_format"`, etc.) — never by
  a hardcoded numeric section index into an array.
- This module is read-only: it must never import or call any of
  Projects 1-3's own write functions (`applyStateDelta`,
  `appendCharacterBibleEntry`, `setP2State`, etc.). Enforced by omission
  — no such import appears anywhere in `ingestCanon.ts`.
- `computeStructuralOverview` must never reproduce full verbatim source
  text (e.g. the complete Story Spine, or a full arc timeline) — it
  names counts and short excerpts of what exists, not the content
  itself.
- No LLM call anywhere in this module — pure Firestore reads plus
  deterministic extraction/templating.
- `web/src/lib/characterEngine/ingestFoundation.ts` is not modified by
  this plan — its own file comment scopes it to Project-2-specific glue;
  this plan only imports its already-exported `extractIngestedFoundation`
  and `CastMember` type.

---

### Task 1: Types, gap-detection scaffolding, and Project 1 ingestion

**Files:**
- Create: `web/src/lib/storyArchitectureEngine/ingestCanon.ts`

**Interfaces:**
- Consumes: `listDocumentVersions`, `getDocumentVersion`, `type StoredDocumentVersion`, `type FoundationDocument` from `@/lib/canonEngine/foundationDoc`; `extractIngestedFoundation`, `type CastMember` from `@/lib/characterEngine/ingestFoundation`.
- Produces (used by Tasks 2-4): `export interface CanonGap { project: "P1" | "P2" | "P3"; field: string; reason: string; }`; `export interface IngestedProject1Canon { storyDna: FoundationDocument["2_story_dna"]; format: FoundationDocument["3_story_format"]; premise: string; logline: string; thematicBlueprint: FoundationDocument["7_thematic_blueprint"]; dramaticEngine: FoundationDocument["8_dramatic_engine"]; storySpine: FoundationDocument["11_story_spine"]; principalCharacters: CastMember[]; version: number; }`; `async function ingestProject1(storyId: string): Promise<{ canon: IngestedProject1Canon | null; gaps: CanonGap[] }>` (not exported — internal to this module, called only by `ingestCanon` in Task 4).

- [ ] **Step 1: Create the file with types and `ingestProject1`**

```ts
import {
  listDocumentVersions,
  getDocumentVersion,
  type FoundationDocument,
} from "@/lib/canonEngine/foundationDoc";
import { extractIngestedFoundation, type CastMember } from "@/lib/characterEngine/ingestFoundation";

/**
 * Canon Ingestion Module — GitHub issue #55, PRD §7.1 (FR-1.1-1.5).
 * Reads Projects 1-3's already-finished canon directly from Firestore via
 * each project's own existing typed accessors (never via `.docx` parsing
 * — see docs/superpowers/specs/2026-09-09-canon-ingestion-design.md for
 * why this corrects issue #55's currently-stated AC). Read-only: never
 * imports any of Projects 1-3's own write functions.
 */

export interface CanonGap {
  project: "P1" | "P2" | "P3";
  field: string;
  reason: string;
}

export interface IngestedProject1Canon {
  storyDna: FoundationDocument["2_story_dna"];
  format: FoundationDocument["3_story_format"];
  premise: string;
  logline: string;
  thematicBlueprint: FoundationDocument["7_thematic_blueprint"];
  dramaticEngine: FoundationDocument["8_dramatic_engine"];
  storySpine: FoundationDocument["11_story_spine"];
  principalCharacters: CastMember[];
  version: number;
}

/**
 * Reuses `ingestFoundation.ts`'s already-tested `extractIngestedFoundation`
 * for cast (with stable charId), story spine, and dramatic engine, so this
 * module never re-derives charId assignment itself. The remaining P1
 * fields FR-1.2 requires (Story DNA, Format, Premise, Logline, Thematic
 * Blueprint) are read directly from the same already-fetched document by
 * their own stable field-name keys.
 */
async function ingestProject1(
  storyId: string
): Promise<{ canon: IngestedProject1Canon | null; gaps: CanonGap[] }> {
  const versions = await listDocumentVersions(storyId);
  if (versions.length === 0) {
    return {
      canon: null,
      gaps: [{ project: "P1", field: "document", reason: "Story Foundation Document has not been generated yet." }],
    };
  }
  const latest = Math.max(...versions.map((v) => v.version));
  const version = await getDocumentVersion(storyId, latest);
  if (!version) {
    return {
      canon: null,
      gaps: [
        {
          project: "P1",
          field: "document",
          reason: `Story Foundation Document version ${latest} is listed but could not be fetched.`,
        },
      ],
    };
  }

  const foundationResult = extractIngestedFoundation(version, storyId);
  const gaps: CanonGap[] = [];

  if (foundationResult.status === "error") {
    return { canon: null, gaps: [{ project: "P1", field: "document", reason: foundationResult.reason }] };
  }
  if (foundationResult.status === "missing") {
    // Cannot happen here (a version was just fetched successfully), but
    // handled for type exhaustiveness over IngestFoundationResult's union.
    return {
      canon: null,
      gaps: [{ project: "P1", field: "document", reason: "Story Foundation Document has not been generated yet." }],
    };
  }
  if (foundationResult.status === "incomplete") {
    gaps.push({ project: "P1", field: "principal_characters_or_story_spine", reason: foundationResult.reason });
  }

  const doc = version.json;
  const canon: IngestedProject1Canon = {
    storyDna: doc["2_story_dna"],
    format: doc["3_story_format"],
    premise: doc["4_premise"],
    logline: doc["5_logline"],
    thematicBlueprint: doc["7_thematic_blueprint"],
    dramaticEngine: foundationResult.foundation.dramaticEngine,
    storySpine: foundationResult.foundation.storySpine,
    principalCharacters: foundationResult.foundation.cast,
    version: version.version,
  };

  return { canon, gaps };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings).
Run `npm run build` from `web/` — must succeed. (`ingestProject1` is not
yet called from anywhere, so TypeScript will only check that the file
itself compiles — that's expected and sufficient for this task; Task 4
wires it into the exported `ingestCanon`.)

- [ ] **Step 3: Manual trace verification**

No test runner in this repo — trace these cases against the code by
hand:

- **No Foundation Document ever generated** (`listDocumentVersions`
  returns `[]`): confirm `ingestProject1` returns `{ canon: null, gaps:
  [{ project: "P1", field: "document", reason: "Story Foundation
  Document has not been generated yet." }] }` without calling
  `getDocumentVersion` at all.
- **A version exists and is complete** (`extractIngestedFoundation`
  returns `status: "ok"`): confirm `gaps` is `[]` and every field in the
  returned `canon` is read from the correct `doc["N_field_name"]` key —
  cross-check against `FoundationDocument`'s field list in
  `foundationDoc.ts:63-97`.
- **A version exists but has zero principal characters**
  (`extractIngestedFoundation` returns `status: "incomplete"` because
  `cast.length === 0`): confirm one gap is pushed with `field:
  "principal_characters_or_story_spine"` and `reason` equal to
  `foundationResult.reason` verbatim, AND confirm `canon` is still
  populated (not `null`) — an incomplete cast list is a gap to report,
  not a reason to withhold everything else P1 already has.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/ingestCanon.ts
git commit -m "feat: add Canon Ingestion Module scaffolding and Project 1 ingestion"
```

---

### Task 2: Project 2 ingestion

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/ingestCanon.ts`

**Interfaces:**
- Consumes: `listCharacterBibleEntries`, `type CharacterBibleEntry`, `type Story`, `type P2State`, `type P2CharacterProgress` from `@/lib/canonEngine/storyStore`; `type CastMember` (from Task 1's import); Task 1's `CanonGap`.
- Produces (used by Task 4): `export interface IngestedCharacterCanon { charId: string; name: string; want: string; need: string; coreFlaw: string; coreWound: string; arcTimeline: CharacterBibleEntry["milestone_arc_timeline"]; }`; `export interface IngestedProject2Canon { characters: IngestedCharacterCanon[]; }`; `async function ingestProject2(storyId: string, story: Story, principalCharacters: CastMember[]): Promise<{ canon: IngestedProject2Canon; gaps: CanonGap[] }>` (not exported — internal, called only by `ingestCanon` in Task 4).

- [ ] **Step 1: Add the import and Project 2 types/function**

Add to the top of the file, alongside the existing imports:

```ts
import {
  listCharacterBibleEntries,
  type CharacterBibleEntry,
  type Story,
  type P2State,
  type P2CharacterProgress,
} from "@/lib/canonEngine/storyStore";
```

Add after `ingestProject1`:

```ts
export interface IngestedCharacterCanon {
  charId: string;
  name: string;
  want: string;
  need: string;
  coreFlaw: string;
  coreWound: string;
  arcTimeline: CharacterBibleEntry["milestone_arc_timeline"];
}

export interface IngestedProject2Canon {
  characters: IngestedCharacterCanon[];
}

/**
 * Matches a Project 1 cast member to its Project 2 progress the same way
 * `characterBibleGate.ts`'s `checkCharacterBibleComplete` already does:
 * charId first (the normal case, since `p2State.characterProgress` is
 * keyed by charId), falling back to a case-insensitive name match for a
 * sign-off recorded under `character-chat/route.ts`'s raw-slugify
 * fallback key. Returns null when the character has no P2 progress at
 * all (never started).
 */
function resolveCharacterProgress(
  member: CastMember,
  p2State: P2State | null | undefined
): P2CharacterProgress | null {
  const progress = p2State?.characterProgress ?? {};
  if (progress[member.charId]) {
    return progress[member.charId];
  }
  const byName = Object.values(progress).find(
    (entry) => entry.characterName.trim().toLowerCase() === member.name.trim().toLowerCase()
  );
  return byName ?? null;
}

/**
 * Project 2 canon is every signed-off character's compiled
 * `CharacterBibleEntry` (issue #34) - unconditional, regardless of
 * whether it matches a Project 1 principal character by name. Gaps are
 * computed separately: any Project 1 principal character without a
 * `signed_off` P2 status, via `resolveCharacterProgress` above.
 */
async function ingestProject2(
  storyId: string,
  story: Story,
  principalCharacters: CastMember[]
): Promise<{ canon: IngestedProject2Canon; gaps: CanonGap[] }> {
  const entries = await listCharacterBibleEntries(storyId);
  const characters: IngestedCharacterCanon[] = entries.map((e) => ({
    charId: e.charId,
    name: e.metadata.character_name,
    want: e.psychological_engine.want,
    need: e.psychological_engine.need,
    coreFlaw: e.psychological_engine.core_flaw,
    coreWound: e.psychological_engine.core_wound,
    arcTimeline: e.milestone_arc_timeline,
  }));

  const gaps: CanonGap[] = [];
  for (const member of principalCharacters) {
    const progress = resolveCharacterProgress(member, story.p2);
    if (progress?.status === "signed_off") continue;
    gaps.push({
      project: "P2",
      field: member.name,
      reason: progress ? `${progress.status} - not yet signed off.` : "Never started in Character Development.",
    });
  }

  return { canon: { characters }, gaps };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from
`web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

- **Zero signed-off characters, two principal characters in P1**
  (`entries: []`, `principalCharacters` has 2 members, `story.p2` is
  `null`): confirm `characters: []` and `gaps` has exactly 2 entries,
  each with `reason: "Never started in Character Development."`.
- **One principal character signed off, matched by charId** (`story.p2.characterProgress[member.charId] = { status: "signed_off", ... }`,
  and a matching `CharacterBibleEntry` with the same `charId` exists in
  `entries`): confirm that member produces zero gaps and appears in
  `characters`.
- **One principal character `deferred`** (`characterProgress[member.charId].status === "deferred"`, no matching entry in `entries`): confirm
  one gap with `reason: "deferred - not yet signed off."`.
- **Fallback name-match case**: a `characterProgress` entry keyed under a
  different string than `member.charId`, but whose `characterName` matches
  `member.name` case-insensitively and has `status: "signed_off"`:
  confirm `resolveCharacterProgress` still finds it via the name-fallback
  branch, and the member produces zero gaps.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/ingestCanon.ts
git commit -m "feat: add Project 2 ingestion to Canon Ingestion Module"
```

---

### Task 3: Project 3 ingestion

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/ingestCanon.ts`

**Interfaces:**
- Consumes: `listElements`, `WORLD_ELEMENTS_COLLECTION` from `@/lib/canonEngine/canonStore`; `type CanonStatus` from `@/lib/canonEngine/types`; `normalizeP3` from `@/lib/canonEngine/storyStore`; `pillarElementId` from `@/lib/worldEngine/pillarElementId`; `type Story` (from Task 2's import).
- Produces (used by Task 4): `export interface IngestedPillarCanon { name: string; elementId: string; status: CanonStatus; value: unknown; }`; `export interface IngestedProject3Canon { worldComplexityLevel: 1 | 2 | 3 | 4 | null; pillars: IngestedPillarCanon[]; }`; `async function ingestProject3(storyId: string, story: Story): Promise<{ canon: IngestedProject3Canon; gaps: CanonGap[] }>` (not exported — internal, called only by `ingestCanon` in Task 4).

- [ ] **Step 1: Add the import and Project 3 types/function**

Add to the top of the file, alongside the existing imports:

```ts
import { listElements, WORLD_ELEMENTS_COLLECTION } from "@/lib/canonEngine/canonStore";
import type { CanonStatus } from "@/lib/canonEngine/types";
import { normalizeP3 } from "@/lib/canonEngine/storyStore";
import { pillarElementId } from "@/lib/worldEngine/pillarElementId";
```

Add after `ingestProject2`:

```ts
export interface IngestedPillarCanon {
  name: string;
  elementId: string;
  status: CanonStatus;
  value: unknown;
}

export interface IngestedProject3Canon {
  worldComplexityLevel: 1 | 2 | 3 | 4 | null;
  pillars: IngestedPillarCanon[];
}

/**
 * `p3.pillars: null` (not yet adopted) and `p3.pillars: []` (deliberately
 * cleared to zero) are distinct per `normalizeP3`'s own documented
 * convention - only `null` is a gap. Each adopted pillar's canon comes
 * from its `CanonElement` (looked up via the same `pillarElementId`
 * derivation the rest of Project 3 already uses); only a `Confirmed`
 * element counts as ingested canon, matching every other project's rule
 * that only Confirmed canon is authoritative.
 */
async function ingestProject3(
  storyId: string,
  story: Story
): Promise<{ canon: IngestedProject3Canon; gaps: CanonGap[] }> {
  const p3 = normalizeP3(story.p3);
  const gaps: CanonGap[] = [];

  if (p3.worldComplexityLevel === null) {
    gaps.push({ project: "P3", field: "worldComplexityLevel", reason: "World Complexity Level has not been set yet." });
  }

  if (p3.pillars === null) {
    gaps.push({ project: "P3", field: "pillars", reason: "World Bible pillar list has not been adopted yet." });
    return { canon: { worldComplexityLevel: p3.worldComplexityLevel, pillars: [] }, gaps };
  }

  const elements = await listElements(storyId, WORLD_ELEMENTS_COLLECTION);
  const byElementId = new Map(elements.map((e) => [e.element_id, e]));

  const pillars: IngestedPillarCanon[] = [];
  for (const name of p3.pillars) {
    const elementId = pillarElementId(name);
    const element = byElementId.get(elementId);
    if (!element) {
      gaps.push({ project: "P3", field: name, reason: "Not started." });
      continue;
    }
    if (element.status !== "Confirmed") {
      gaps.push({ project: "P3", field: name, reason: `${element.status} - not yet Confirmed.` });
      continue;
    }
    pillars.push({ name, elementId, status: element.status, value: element.value });
  }

  return { canon: { worldComplexityLevel: p3.worldComplexityLevel, pillars }, gaps };
}
```

- [ ] **Step 2: Run lint and build**

Run `npm run lint` from `web/` — must be clean. Run `npm run build` from
`web/` — must succeed.

- [ ] **Step 3: Manual trace verification**

- **`story.p3` is `null`/`undefined`** (a Story created before P3
  existed): confirm `normalizeP3` fills in `{ worldComplexityLevel: null,
  pillars: null, ... }`, producing exactly 2 gaps
  (`worldComplexityLevel` and `pillars`) and `pillars: []` in the
  returned canon, with `listElements` never called (early return before
  it).
- **`worldComplexityLevel` set, `pillars: []`** (deliberately cleared):
  confirm zero gaps for pillars (the `null` check does not match `[]`),
  `canon.pillars: []`, and `listElements` IS called (loop over an empty
  array just produces no iterations, not a skip).
- **One pillar adopted, its element `Confirmed`**: confirm
  `byElementId.get(pillarElementId(name))` finds it, zero gaps, and it
  appears in `canon.pillars` with the element's own `value`.
- **One pillar adopted, no element yet** (`pillarElementId(name)` has no
  entry in `elements`): confirm gap `reason: "Not started."`.
- **One pillar adopted, element exists but `status: "Working"`**: confirm
  gap `reason: "Working - not yet Confirmed."` and it does NOT appear in
  `canon.pillars`.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/ingestCanon.ts
git commit -m "feat: add Project 3 ingestion to Canon Ingestion Module"
```

---

### Task 4: Structural overview, top-level orchestrator, and public exports

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/ingestCanon.ts`

**Interfaces:**
- Consumes: `getStory`, `StoryAccessError` from `@/lib/canonEngine/storyStore` (added to Task 2's existing import from this module); Tasks 1-3's `ingestProject1`/`ingestProject2`/`ingestProject3`, `IngestedProject1Canon`, `IngestedProject2Canon`, `IngestedProject3Canon`, `CanonGap`.
- Produces (the module's public API, consumed by future P4 issues — #57 Onboarding Gate, #58 Structure): `export interface IngestedCanon { storyId: string; p1: IngestedProject1Canon | null; p2: IngestedProject2Canon; p3: IngestedProject3Canon; gaps: CanonGap[]; structuralOverview: string; }`; `export async function ingestCanon(storyId: string): Promise<IngestedCanon>`.

- [ ] **Step 1: Add `getStory`/`StoryAccessError` to the existing storyStore import**

Find (added in Task 2):

```ts
import {
  listCharacterBibleEntries,
  type CharacterBibleEntry,
  type Story,
  type P2State,
  type P2CharacterProgress,
} from "@/lib/canonEngine/storyStore";
```

Replace with:

```ts
import {
  getStory,
  StoryAccessError,
  listCharacterBibleEntries,
  type CharacterBibleEntry,
  type Story,
  type P2State,
  type P2CharacterProgress,
} from "@/lib/canonEngine/storyStore";
```

- [ ] **Step 2: Add `computeStructuralOverview`, `IngestedCanon`, and `ingestCanon`**

Add at the end of the file, after `ingestProject3`:

```ts
/**
 * FR-1.4: a structural-overview summary for onboarding (issue #57
 * decides how/when it's shown - this module only produces the string).
 * Deterministic templating from fields already extracted above - no LLM
 * call. Names counts and short excerpts of what exists; never reproduces
 * a full Story Spine or arc timeline verbatim.
 */
function computeStructuralOverview(canon: {
  p1: IngestedProject1Canon | null;
  p2: IngestedProject2Canon;
  p3: IngestedProject3Canon;
}): string {
  const lines: string[] = [];

  if (!canon.p1) {
    lines.push("Project 1 (Story Foundation) is not yet complete.");
  } else {
    const primaryFormat = canon.p1.format.primary_format.name || "an unspecified format";
    lines.push(`"${canon.p1.logline || "No logline recorded"}" — primary format: ${primaryFormat}.`);
    lines.push(`Protagonist: ${canon.p1.dramaticEngine.protagonist || "not yet defined"}.`);
  }

  const signedOffNames = canon.p2.characters.map((c) => c.name);
  lines.push(
    signedOffNames.length > 0
      ? `${signedOffNames.length} character${signedOffNames.length === 1 ? "" : "s"} fully developed: ${signedOffNames.join(", ")}.`
      : "No characters fully developed yet."
  );

  const confirmedPillarCount = canon.p3.pillars.length;
  lines.push(
    confirmedPillarCount > 0
      ? `${confirmedPillarCount} world pillar${confirmedPillarCount === 1 ? "" : "s"} confirmed.`
      : "No world pillars confirmed yet."
  );

  return lines.join(" ");
}

export interface IngestedCanon {
  storyId: string;
  p1: IngestedProject1Canon | null;
  p2: IngestedProject2Canon;
  p3: IngestedProject3Canon;
  gaps: CanonGap[];
  structuralOverview: string;
}

/**
 * Public entry point (issue #55). Fetches the Story once, ingests all
 * three upstream projects directly from Firestore, and returns one
 * structured object plus every gap found (FR-1.5 - canon is never
 * silently invented). Read-only: never writes to any Story field or any
 * project's own canon collections.
 */
export async function ingestCanon(storyId: string): Promise<IngestedCanon> {
  const story = await getStory(storyId);
  if (!story) {
    throw new StoryAccessError(`Story "${storyId}" not found.`);
  }

  const { canon: p1, gaps: p1Gaps } = await ingestProject1(storyId);
  const { canon: p2, gaps: p2Gaps } = await ingestProject2(storyId, story, p1?.principalCharacters ?? []);
  const { canon: p3, gaps: p3Gaps } = await ingestProject3(storyId, story);

  const gaps = [...p1Gaps, ...p2Gaps, ...p3Gaps];
  const structuralOverview = computeStructuralOverview({ p1, p2, p3 });

  return { storyId, p1, p2, p3, gaps, structuralOverview };
}
```

- [ ] **Step 3: Run lint and build**

Run `npm run lint` from `web/` — must be clean (0 errors, 0 warnings).
Run `npm run build` from `web/` — must succeed. This is the task where
`ingestProject1`/`ingestProject2`/`ingestProject3` first become actually
called (from `ingestCanon`), so this is also the first point TypeScript
checks their call sites end-to-end — pay attention to any type error here,
it likely means a mismatch between what an earlier task produced and what
`ingestCanon` expects.

- [ ] **Step 4: Manual trace verification**

- **A Story that doesn't exist**: confirm `ingestCanon` throws
  `StoryAccessError` before calling any of the three `ingestProjectN`
  functions.
- **A fully-ingestable story** (P1 has a generated document with a
  logline and protagonist, P2 has 2 signed-off characters, P3 has 1
  Confirmed pillar): trace the full call through to `IngestedCanon` and
  confirm `structuralOverview` reads as a coherent sentence containing
  the logline, primary format, protagonist, "2 characters fully
  developed: <name1>, <name2>.", and "1 world pillar confirmed." — and
  confirm it does NOT contain the full Story Spine or any character's
  full arc timeline text.
- **A brand-new story** (no P1 document, no P2 progress, no P3 state):
  confirm `gaps` contains the P1 "document" gap, zero P2 gaps (since
  `principalCharacters` is `[]` when `p1` is `null` — nothing to check
  against), and both P3 gaps (`worldComplexityLevel`, `pillars`); confirm
  `structuralOverview` reads "Project 1 (Story Foundation) is not yet
  complete. No characters fully developed yet. No world pillars
  confirmed yet."

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/storyArchitectureEngine/ingestCanon.ts
git commit -m "feat: add structural overview and top-level ingestCanon orchestrator"
```
