# P2 Priority Matrix Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify every cast member from a Project 2 session's ingested Story Foundation into a priority tier (Critical/Major/Supporting/Minor), each with a traceable justification (GitHub issue #25, scoped per its design spec).

**Architecture:** One new pure function, `computePriorityMatrix`, in `web/src/lib/characterEngine/priorityMatrix.ts` — consumes issue #24's `IngestedFoundation` output directly, applies a four-rule priority chain (first match wins, Minor is the fallback), and returns one classified entry per cast member. No I/O, no UI wiring — same shape as `ingestFoundation.ts`.

**Tech Stack:** TypeScript, no new dependencies. No test framework exists in this repo — verification is `npm run lint && npm run build` plus a throwaway fixture script (written, run, deleted, never committed), matching issue #24's established convention.

## Global Constraints

- Major-tier role matching uses the P2 system prompt's four roles — Love Interest, Mentor, Primary Ally, Secondary Antagonist — not the issue AC's narrower literal three.
- "Incidental" is not computed here — this function's domain is exactly `foundation.cast`; every element of that array gets classified into Critical/Major/Supporting/Minor, nothing more.
- No session/UI orchestration ("surface once", "recompute on edit") — that's deferred to issue #27. This plan produces a pure classification function only.
- `web/src/lib/characterEngine/ingestFoundation.ts` must not be modified — only its exported types/values are consumed.
- No test framework exists — do not add one. Verify with `cd web && npm run lint && npm run build`, plus the fixture script described in Task 1 (write it, run it, delete it — don't commit it).

---

### Task 1: `computePriorityMatrix` and its rule chain

**Files:**
- Create: `web/src/lib/characterEngine/priorityMatrix.ts`

**Interfaces:**
- Consumes: `IngestedFoundation`, `CastMember` (both from `@/lib/characterEngine/ingestFoundation`, exact shapes: `CastMember = { name: string; story_role: string; description: string; primary_function: string }`; `IngestedFoundation = { storyId: string; version: number; workingTitle: string; cast: CastMember[]; storySpine: FoundationDocument["11_story_spine"]; dramaticEngine: FoundationDocument["8_dramatic_engine"] }`, where `storySpine` has exactly the 7 fields `opening_image, inciting_incident, first_turning_point, midpoint, second_turning_point, climax, closing_image` (all `string`), and `dramaticEngine` has `protagonist: string; antagonistic_force: string; central_conflict: string; primary_stakes: string; transformation_arc: string; emotional_journey: string`).
- Produces: `PriorityTier = "Critical" | "Major" | "Supporting" | "Minor"`; `PriorityMatrixEntry = { character: string; tier: PriorityTier; justification: string }`; `computePriorityMatrix(foundation: IngestedFoundation): PriorityMatrixEntry[]` — the function later issues (starting with #27) will call.

- [ ] **Step 1: Write the file**

`web/src/lib/characterEngine/priorityMatrix.ts`:

```ts
import type { CastMember, IngestedFoundation } from "@/lib/characterEngine/ingestFoundation";
import type { FoundationDocument } from "@/lib/canonEngine/foundationDoc";

/**
 * Project 2 Priority Matrix classifier (issue #25, scoped 2026-07-30 - see
 * docs/superpowers/specs/2026-07-30-p2-priority-matrix-design.md). Pure
 * function over #24's IngestedFoundation - no I/O, no UI wiring.
 *
 * Scope note (see ingestFoundation.ts's own header): this directory
 * (characterEngine/) holds Project-2-specific glue only. This file is not
 * the place for canon state tracking or conflict resolution - those belong
 * in the shared Canon Engine per ARCHITECTURE.md §2/§7.
 */

export type PriorityTier = "Critical" | "Major" | "Supporting" | "Minor";

export interface PriorityMatrixEntry {
  character: string;
  tier: PriorityTier;
  justification: string;
}

// The P2 system prompt's four Major roles (project-docs/storimac-prompts/
// P2-Prompt2...md) - deliberately wider than the issue AC's literal three
// (deuteragonist/mentor/love-interest), since the system prompt is what
// actually governs the live interview.
const MAJOR_ROLES = ["love interest", "mentor", "primary ally", "secondary antagonist"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Excluded from the first-name fallback below - a name like "The Harbor
// Clerk" would otherwise contribute a "first name" of "The", which false-
// matches almost any prose beat and incorrectly inflates a Minor character
// to Critical via spurious spine-appearance counts.
const NAME_MATCH_STOPWORDS = new Set(["the", "a", "an", "mr", "mrs", "ms", "dr"]);

/** Case-insensitive, word-boundary match of a character's full name or first name inside free text. */
function nameAppearsIn(name: string, text: string): boolean {
  const fullNamePattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  if (fullNamePattern.test(text)) return true;

  const firstName = name.split(/\s+/)[0];
  if (firstName && firstName !== name && !NAME_MATCH_STOPWORDS.has(firstName.toLowerCase())) {
    const firstNamePattern = new RegExp(`\\b${escapeRegExp(firstName)}\\b`, "i");
    if (firstNamePattern.test(text)) return true;
  }
  return false;
}

function countSpineAppearances(name: string, spine: FoundationDocument["11_story_spine"]): number {
  const beats = [
    spine.opening_image,
    spine.inciting_incident,
    spine.first_turning_point,
    spine.midpoint,
    spine.second_turning_point,
    spine.climax,
    spine.closing_image,
  ];
  return beats.filter((beat) => nameAppearsIn(name, beat)).length;
}

/** Returns the matched Major role string, or null if story_role matches none of them. */
function matchesMajorRole(storyRole: string): string | null {
  const lower = storyRole.toLowerCase();
  return MAJOR_ROLES.find((role) => lower.includes(role)) ?? null;
}

function classifyMember(member: CastMember, foundation: IngestedFoundation): PriorityMatrixEntry {
  const { name, story_role, primary_function } = member;
  const { dramaticEngine, storySpine } = foundation;

  if (nameAppearsIn(name, dramaticEngine.protagonist)) {
    return { character: name, tier: "Critical", justification: "Matches dramatic_engine.protagonist" };
  }
  if (nameAppearsIn(name, dramaticEngine.antagonistic_force)) {
    return { character: name, tier: "Critical", justification: "Matches dramatic_engine.antagonistic_force" };
  }
  const spineCount = countSpineAppearances(name, storySpine);
  if (spineCount >= 3) {
    return { character: name, tier: "Critical", justification: `Appears in ${spineCount} of 7 Story Spine beats` };
  }

  const matchedRole = matchesMajorRole(story_role);
  if (matchedRole) {
    return { character: name, tier: "Major", justification: `story_role '${story_role.trim()}' matches a Major role` };
  }
  if (spineCount >= 1) {
    return { character: name, tier: "Major", justification: `Appears in ${spineCount} of 7 Story Spine beats` };
  }

  if (primary_function.trim().length > 0) {
    return { character: name, tier: "Supporting", justification: "No Story Spine presence; functional role only" };
  }

  return {
    character: name,
    tier: "Minor",
    justification: "No Story Spine presence, recognized role, or functional description",
  };
}

/** Classifies every cast member into a priority tier, one entry per member of `foundation.cast`, same order. */
export function computePriorityMatrix(foundation: IngestedFoundation): PriorityMatrixEntry[] {
  return foundation.cast.map((member) => classifyMember(member, foundation));
}
```

- [ ] **Step 2: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (confirms the new file compiles and its imports from `ingestFoundation.ts`/`foundationDoc.ts` resolve with matching types).

- [ ] **Step 3: Fixture-based verification**

Create this scratch file at the repo root, `verify-priority-matrix.mjs` (do not put it under `web/`, do not commit it):

```js
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NAME_MATCH_STOPWORDS = new Set(["the", "a", "an", "mr", "mrs", "ms", "dr"]);

function nameAppearsIn(name, text) {
  const fullNamePattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, "i");
  if (fullNamePattern.test(text)) return true;
  const firstName = name.split(/\s+/)[0];
  if (firstName && firstName !== name && !NAME_MATCH_STOPWORDS.has(firstName.toLowerCase())) {
    const firstNamePattern = new RegExp(`\\b${escapeRegExp(firstName)}\\b`, "i");
    if (firstNamePattern.test(text)) return true;
  }
  return false;
}

function countSpineAppearances(name, spine) {
  const beats = [
    spine.opening_image, spine.inciting_incident, spine.first_turning_point,
    spine.midpoint, spine.second_turning_point, spine.climax, spine.closing_image,
  ];
  return beats.filter((beat) => nameAppearsIn(name, beat)).length;
}

const MAJOR_ROLES = ["love interest", "mentor", "primary ally", "secondary antagonist"];
function matchesMajorRole(storyRole) {
  const lower = storyRole.toLowerCase();
  return MAJOR_ROLES.find((role) => lower.includes(role)) ?? null;
}

function classifyMember(member, foundation) {
  const { name, story_role, primary_function } = member;
  const { dramaticEngine, storySpine } = foundation;

  if (nameAppearsIn(name, dramaticEngine.protagonist)) {
    return { character: name, tier: "Critical", justification: "Matches dramatic_engine.protagonist" };
  }
  if (nameAppearsIn(name, dramaticEngine.antagonistic_force)) {
    return { character: name, tier: "Critical", justification: "Matches dramatic_engine.antagonistic_force" };
  }
  const spineCount = countSpineAppearances(name, storySpine);
  if (spineCount >= 3) {
    return { character: name, tier: "Critical", justification: `Appears in ${spineCount} of 7 Story Spine beats` };
  }

  const matchedRole = matchesMajorRole(story_role);
  if (matchedRole) {
    return { character: name, tier: "Major", justification: `story_role '${story_role.trim()}' matches a Major role` };
  }
  if (spineCount >= 1) {
    return { character: name, tier: "Major", justification: `Appears in ${spineCount} of 7 Story Spine beats` };
  }

  if (primary_function.trim().length > 0) {
    return { character: name, tier: "Supporting", justification: "No Story Spine presence; functional role only" };
  }

  return {
    character: name,
    tier: "Minor",
    justification: "No Story Spine presence, recognized role, or functional description",
  };
}

function computePriorityMatrix(foundation) {
  return foundation.cast.map((member) => classifyMember(member, foundation));
}

const foundation = {
  storyId: "story-1",
  version: 1,
  workingTitle: "The Cartographer's Debt",
  dramaticEngine: {
    protagonist: "Aria Chen, a cartographer who has never left her hometown.",
    antagonistic_force: "The Cartel, represented by Kestrel's old crew.",
    central_conflict: "", primary_stakes: "", transformation_arc: "", emotional_journey: "",
  },
  storySpine: {
    opening_image: "Aria maps the harbor at dawn.",
    inciting_incident: "Aria receives a coded letter.",
    first_turning_point: "Kestrel offers Aria a dangerous job.",
    midpoint: "Aria confronts Kestrel about the past.",
    second_turning_point: "The Cartel captures Mira, Aria's assistant.",
    climax: "Aria and Kestrel face the Cartel together.",
    closing_image: "Aria draws a new map, unafraid.",
  },
  cast: [
    { name: "Aria Chen", story_role: "Protagonist", description: "", primary_function: "" },
    { name: "Kestrel", story_role: "Mentor", description: "", primary_function: "" },
    { name: "Mira", story_role: "Assistant", description: "", primary_function: "Delivers messages between characters." },
    { name: "The Harbor Clerk", story_role: "", description: "", primary_function: "" },
  ],
};

const result = computePriorityMatrix(foundation);
console.log(JSON.stringify(result, null, 2));

const byName = Object.fromEntries(result.map((r) => [r.character, r]));
console.assert(byName["Aria Chen"].tier === "Critical", "Aria Chen should be Critical (matches protagonist)");
console.assert(byName["Kestrel"].tier === "Critical", "Kestrel should be Critical (matches antagonistic_force via crew mention + appears in spine)");
console.assert(byName["Mira"].tier === "Major", "Mira should be Major (appears in 1 spine beat)");
console.assert(byName["The Harbor Clerk"].tier === "Minor", "The Harbor Clerk should be Minor (no spine, no role, no function)");

console.log("\nIf no 'Assertion failed' lines appeared above, all cases passed.");
```

Run: `node verify-priority-matrix.mjs`
Expected: JSON output for all 4 cast members, no "Assertion failed" lines. Then delete the file: `rm verify-priority-matrix.mjs`.

Note on the Kestrel case: it's deliberately constructed to hit the Critical rule via `dramaticEngine.antagonistic_force` mentioning "Kestrel's old crew" (word-boundary match on "Kestrel"), which is a more realistic test of the substring-matching logic than a simple exact-field-equals-name case would be — confirm the reasoning holds by reading the printed justification for Kestrel's entry, not just the tier.

Note on "The Harbor Clerk": this name is deliberately chosen to test the `NAME_MATCH_STOPWORDS` guard. Without it, `name.split(/\s+/)[0]` yields a "first name" of `"The"`, which would then false-match against the word "the" appearing in several unrelated Story Spine beats (e.g. "Aria confronts Kestrel about **the** past") — spuriously inflating an actually-Minor character to Critical via a fake ≥3 spine-appearance count. If this assertion fails with a tier other than `"Minor"`, the stopword guard was dropped or applied incorrectly — check `nameAppearsIn` first, not `classifyMember`'s rule ordering.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/priorityMatrix.ts
git commit -m "Add P2 priority matrix classifier (#25)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Do not add the scratch verification script — it was deleted, not committed.)
