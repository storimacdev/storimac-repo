# P2 Story Foundation Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first piece of Project 2 (Character Development Consultant): reading a Story's Foundation Document JSON and turning it into structured cast/spine data, with honest gap-flagging when it's missing or unusable (GitHub issue #24, narrowed scope).

**Architecture:** One new file, `web/src/lib/characterEngine/ingestFoundation.ts` — new code in a new directory parallel to `canonEngine/`, reading (never modifying) Project 1's existing `FoundationDocument`/`getDocumentVersion`/`listDocumentVersions`. Split into a pure extraction function (fixture-testable, no Firestore) and a thin async wrapper (does the actual fetch) — this split exists purely for testability, since this sandbox has no live Firestore credentials to verify against (a known, recurring limitation this session), and it doesn't change the public function's documented behavior at all.

**Tech Stack:** TypeScript, no new dependencies. No test framework exists in this repo (`web/package.json` has no test runner) — verification is `npm run lint && npm run build` plus a throwaway fixture-based verification script (not committed) exercising the pure extraction logic directly, since there's no UI route yet to click through and no live Firestore access in this environment.

## Global Constraints

- CDRM ingestion is out of scope — not built at all (see spec's Scope Changes).
- Prose-fallback parsing for hand-authored Story Foundations is out of scope — not built at all. When no JSON version exists, the result is `{ status: "missing" }`; nothing attempts to parse an upload.
- "Optional prior Character Bible for resume" is out of scope — deferred to issue #36. Nothing here reads or references a Character Bible.
- `web/src/lib/canonEngine/foundationDoc.ts` must not be modified — this plan only reads its existing exports.
- No test framework exists — do not add one. Verify with `cd web && npm run lint && npm run build`, plus the fixture-based script described in Task 1 (write it, run it, delete it — don't commit it, matching this repo's established convention of throwaway Node verification scripts rather than a permanent test suite).

---

### Task 1: `ingestFoundation` and its pure extraction core

**Files:**
- Create: `web/src/lib/characterEngine/ingestFoundation.ts`

**Interfaces:**
- Consumes: `listDocumentVersions(storyId: string): Promise<Pick<StoredDocumentVersion, "version" | "date" | "summary_of_changes">[]>`, `getDocumentVersion(storyId: string, version: number): Promise<StoredDocumentVersion | null>`, and the `FoundationDocument`/`StoredDocumentVersion` types — all existing, unmodified, from `@/lib/canonEngine/foundationDoc`. `StoredDocumentVersion` is `{ version: number; date: string; summary_of_changes: string; json: FoundationDocument; markdown: string; elementsSnapshot: {...} }`. `FoundationDocument["9_principal_characters"]` is `unknown[]`; `FoundationDocument["11_story_spine"]` is `{ opening_image: string; inciting_incident: string; first_turning_point: string; midpoint: string; second_turning_point: string; climax: string; closing_image: string }`.
- Produces: `CastMember`, `IngestedFoundation`, `IngestFoundationResult` types; `extractIngestedFoundation(version: StoredDocumentVersion, storyId: string): IngestFoundationResult` (pure); `ingestFoundation(storyId: string): Promise<IngestFoundationResult>` (the public API later issues/routes call). No other file in this plan consumes these yet — the interfaces block here is for the next issue in the build order (#25, priority matrix), which will import `IngestedFoundation`/`CastMember`/`ingestFoundation` from this file.

- [ ] **Step 1: Write the file**

`web/src/lib/characterEngine/ingestFoundation.ts`:

```ts
import { listDocumentVersions, getDocumentVersion, type FoundationDocument, type StoredDocumentVersion } from "@/lib/canonEngine/foundationDoc";

/**
 * Project 2 Story Foundation ingestion (issue #24, narrowed scope 2026-07-30).
 * Reads Project 1's existing Foundation Document JSON - never modifies
 * foundationDoc.ts. CDRM ingestion and prose-fallback parsing are explicitly
 * out of scope (see docs/superpowers/specs/2026-07-30-p2-foundation-ingestion-design.md);
 * "prior Character Bible for resume" is deferred to issue #36.
 */

export interface CastMember {
  name: string;
  story_role: string;
  description: string;
}

export interface IngestedFoundation {
  storyId: string;
  version: number;
  workingTitle: string;
  cast: CastMember[];
  storySpine: FoundationDocument["11_story_spine"];
}

export type IngestFoundationResult =
  | { status: "ok"; foundation: IngestedFoundation }
  | { status: "missing" }
  | { status: "incomplete"; reason: string; foundation: IngestedFoundation };

function extractCast(raw: unknown[]): { cast: CastMember[]; skippedCount: number } {
  const cast: CastMember[] = [];
  let skippedCount = 0;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      if (typeof o.name === "string" && o.name.trim()) {
        cast.push({
          name: o.name,
          story_role: typeof o.story_role === "string" ? o.story_role : "",
          description: typeof o.description === "string" ? o.description : "",
        });
        continue;
      }
    } else if (typeof entry === "string" && entry.trim()) {
      cast.push({ name: entry, story_role: "", description: "" });
      continue;
    }
    skippedCount++;
  }
  return { cast, skippedCount };
}

/**
 * Pure extraction from an already-fetched document version - no I/O, so this
 * is testable with fixtures alone. `ingestFoundation` below is the thin
 * async wrapper that does the actual fetch.
 */
export function extractIngestedFoundation(version: StoredDocumentVersion, storyId: string): IngestFoundationResult {
  const doc = version.json;
  const rawCast = doc["9_principal_characters"];
  const { cast, skippedCount } = extractCast(Array.isArray(rawCast) ? rawCast : []);

  const foundation: IngestedFoundation = {
    storyId,
    version: version.version,
    workingTitle: doc["1_story_metadata"].working_title,
    cast,
    storySpine: doc["11_story_spine"],
  };

  if (cast.length === 0) {
    const reason =
      skippedCount > 0
        ? `Found ${skippedCount} cast entr${skippedCount === 1 ? "y" : "ies"} in the Story Foundation, but none had a usable name.`
        : "The Story Foundation's Principal Characters section is empty.";
    return { status: "incomplete", reason, foundation };
  }

  return { status: "ok", foundation };
}

/** Public entry point: fetches the Story's latest Foundation Document version and ingests it. */
export async function ingestFoundation(storyId: string): Promise<IngestFoundationResult> {
  const versions = await listDocumentVersions(storyId);
  if (versions.length === 0) {
    return { status: "missing" };
  }
  const latest = versions[versions.length - 1].version;
  const full = await getDocumentVersion(storyId, latest);
  if (!full) {
    return { status: "missing" };
  }
  return extractIngestedFoundation(full, storyId);
}
```

- [ ] **Step 2: Lint and build**

Run: `cd web && npm run lint && npm run build`
Expected: both pass (confirms the new file compiles and its imports from `foundationDoc.ts` resolve correctly with matching types).

- [ ] **Step 3: Fixture-based verification of the pure extraction logic**

The TypeScript compiler already checked `ingestFoundation.ts`'s *types* in Step 2 — this step sanity-checks the extraction logic's *behavior* against fixtures, sidestepping this environment's lack of live Firestore access. `extractCast`/`extractIngestedFoundation` have no dependency on Firestore or any Next.js/TypeScript-only syntax beyond type annotations, so a plain-JS transliteration (identical logic, types stripped) runs directly under plain Node with no build step.

Create this scratch file at the repo root, `verify-ingest.mjs` (do not put it under `web/` — it's not part of the app and must not be committed):

```js
function extractCast(raw) {
  const cast = [];
  let skippedCount = 0;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const o = entry;
      if (typeof o.name === "string" && o.name.trim()) {
        cast.push({
          name: o.name,
          story_role: typeof o.story_role === "string" ? o.story_role : "",
          description: typeof o.description === "string" ? o.description : "",
        });
        continue;
      }
    } else if (typeof entry === "string" && entry.trim()) {
      cast.push({ name: entry, story_role: "", description: "" });
      continue;
    }
    skippedCount++;
  }
  return { cast, skippedCount };
}

function extractIngestedFoundation(version, storyId) {
  const doc = version.json;
  const rawCast = doc["9_principal_characters"];
  const { cast, skippedCount } = extractCast(Array.isArray(rawCast) ? rawCast : []);

  const foundation = {
    storyId,
    version: version.version,
    workingTitle: doc["1_story_metadata"].working_title,
    cast,
    storySpine: doc["11_story_spine"],
  };

  if (cast.length === 0) {
    const reason =
      skippedCount > 0
        ? `Found ${skippedCount} cast entr${skippedCount === 1 ? "y" : "ies"} in the Story Foundation, but none had a usable name.`
        : "The Story Foundation's Principal Characters section is empty.";
    return { status: "incomplete", reason, foundation };
  }

  return { status: "ok", foundation };
}

function fixtureVersion(principalCharacters) {
  return {
    version: 1,
    date: "2026-07-30",
    summary_of_changes: "Initial generation.",
    markdown: "",
    elementsSnapshot: {},
    json: {
      schema_version: "1.0",
      "1_story_metadata": { working_title: "The Cartographer's Debt" },
      "11_story_spine": {
        opening_image: "", inciting_incident: "", first_turning_point: "",
        midpoint: "", second_turning_point: "", climax: "", closing_image: "",
      },
      "9_principal_characters": principalCharacters,
    },
  };
}

// Case 1 — ok
const case1 = extractIngestedFoundation(
  fixtureVersion([
    { name: "Aria Chen", story_role: "Protagonist", description: "A cartographer who has never left her hometown." },
    { name: "Kestrel", story_role: "Mentor", description: "A retired smuggler." },
  ]),
  "story-1"
);
console.log("Case 1 (ok):", JSON.stringify(case1, null, 2));
console.assert(case1.status === "ok", "Case 1 should be ok");
console.assert(case1.foundation.cast.length === 2, "Case 1 should have 2 cast members");

// Case 2 — incomplete, empty section
const case2 = extractIngestedFoundation(fixtureVersion([]), "story-2");
console.log("Case 2 (incomplete, empty):", JSON.stringify(case2, null, 2));
console.assert(case2.status === "incomplete", "Case 2 should be incomplete");
console.assert(
  case2.reason === "The Story Foundation's Principal Characters section is empty.",
  "Case 2 reason mismatch"
);

// Case 3 — incomplete, malformed entries
const case3 = extractIngestedFoundation(
  fixtureVersion([{ story_role: "Protagonist" }, { name: 123 }]),
  "story-3"
);
console.log("Case 3 (incomplete, malformed):", JSON.stringify(case3, null, 2));
console.assert(case3.status === "incomplete", "Case 3 should be incomplete");
console.assert(
  case3.reason === "Found 2 cast entries in the Story Foundation, but none had a usable name.",
  "Case 3 reason mismatch"
);

console.log("\nAll assertions passed (no output above means an assertion failed silently in this Node version — check for 'Assertion failed' lines).");
```

Run: `node verify-ingest.mjs`
Expected: all three cases print their result, no "Assertion failed" lines in the output. Then delete the file — it exists only to sanity-check this task's logic once, not as a permanent test: `rm verify-ingest.mjs` (POSIX) or the equivalent on the executor's shell.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/characterEngine/ingestFoundation.ts
git commit -m "Add P2 Story Foundation ingestion (#24)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(Do not add the scratch verification script from Step 3 — it was deleted, not committed.)
