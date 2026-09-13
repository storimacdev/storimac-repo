# P3 World Bible Structure-Lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #51 — an automated structure-lint that a compiled World Bible document must pass before an author can mark it "Confirmed," per PRD §2.3's success metric.

**Architecture:** A new `web/src/lib/worldEngine/worldBibleLint.ts` validates a compiled document's JSON shape (via a Zod schema mirroring `WorldBibleDocument`, plus an explicit section-order check) and its rendered Markdown's header sequence. `StoredWorldBibleVersion` gains `confirmed`/`confirmedAt` fields, flipped only by a new explicit confirm action gated on both lint checks. The UI gets a "Mark as Confirmed" button showing lint errors inline on failure.

**Tech Stack:** Zod (already a dependency), Next.js API routes, Firestore — no new dependencies.

## Global Constraints

- Full design spec: `docs/superpowers/specs/2026-09-13-p3-structure-lint-design.md` — consult it for the reasoning behind every decision below.
- The lint validates the persisted document at confirm-time via Zod (`WorldBibleDocumentSchema`), not a hand-rolled key-presence checker — mirrors this project's established `WorldTurnSchema`/`Stage4ConsistencySchema` convention (Decision 1).
- Section order is checked separately from section presence/type, against one named constant (`WORLD_BIBLE_SECTION_ORDER`) — Zod's `safeParse` does not itself assert key insertion order (Decision 2).
- Header wording/order is checked against the **rendered Markdown**, not the JSON — the JSON's keys aren't "headers" (Decision 3).
- "Confirmed" is a per-version boolean (`confirmed`/`confirmedAt` on `StoredWorldBibleVersion`), never a story-level lock — a property of one immutable version, matching how versions are already this system's unit of immutability (Decision 4).
- Confirming happens only through the new explicit route; a lint failure returns `422` with the specific errors and mutates nothing (Decision 1/Error Handling section).
- Confirming an already-confirmed version succeeds idempotently (re-sets `confirmedAt`) rather than being rejected — the simplest option, explicitly chosen in the design spec's Testing section.
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, regardless of which underlying model implements the task — a fixed session-wide convention, not self-attribution.
- No automated test framework exists in this repo — verification is `npm run lint && npm run build` from `web/`, plus `tsx` trace scripts against real committed code.

---

### Task 1: The lint module

**Files:**
- Create: `web/src/lib/worldEngine/worldBibleLint.ts`

**Interfaces:**
- Consumes: `WorldBibleDocument` type (`@/lib/canonEngine/storyStore`), `z` from `"zod"`.
- Produces: `WorldBibleDocumentSchema` (Zod), `WORLD_BIBLE_SECTION_ORDER`, `WORLD_BIBLE_MARKDOWN_HEADERS`, `lintWorldBibleDocument(doc: unknown): { valid: boolean; errors: string[] }`, `lintWorldBibleMarkdown(markdown: string): { valid: boolean; errors: string[] }`. Task 3's route calls both lint functions.

- [ ] **Step 1: Create the file with the Zod schema and constants**

Create `web/src/lib/worldEngine/worldBibleLint.ts`:

```ts
import { z } from "zod";
import type { WorldBibleDocument } from "@/lib/canonEngine/storyStore";

/**
 * Structure-lint for a compiled World Bible document (issue #51, PRD §2.3's
 * success metric: "100% of compiled World Bible documents conform to the
 * 15-section output schema ... and pass an automated structure-lint before
 * being marked Confirmed"). TypeScript already guarantees a FRESHLY
 * compiled document's shape at author-time (worldBibleCompiler.ts's
 * compileWorldBibleDocument builds a typed object literal) - this lint's
 * real job is validating a document loaded back out of Firestore, where
 * `snap.data() as StoredWorldBibleVersion` is a compile-time assertion
 * with zero runtime guarantee. See the design doc
 * (docs/superpowers/specs/2026-09-13-p3-structure-lint-design.md) for the
 * full reasoning, including why order/headers are checked separately from
 * the Zod schema itself.
 */

const WorldBiblePillarSummaryLintSchema = z.object({
  pillar: z.string(),
  summary: z.string(),
});

export const WorldBibleDocumentSchema = z.object({
  schema_version: z.string(),
  "1_document_metadata": z.object({
    story_id: z.string(),
    world_bible_version: z.string(),
    working_title: z.string(),
    date: z.string(),
    status: z.literal("Compiled"),
    related_project_1_version: z.string(),
    related_project_2_status: z.string(),
  }),
  "2_world_overview_complexity_summary": z.string(),
  "3_world_assumptions_canon_rules": z.string(),
  "4_master_world_pillars": z.array(WorldBiblePillarSummaryLintSchema),
  "5_geography_settings_registry": z.string(),
  "6_societal_infrastructure_manual": z.string(),
  "7_cultural_lived_experience_profiles": z.string(),
  "8_narrative_lore_history": z.string(),
  "9_system_mechanics": z.string(),
  "10_significant_institutions_artifacts": z.string(),
  "11_linguistic_communication_profile": z.string(),
  "12_interconnection_map_systems_synthesis": z.string(),
  "13_outstanding_world_questions": z.array(
    z.object({
      defer_to: z.string(),
      items: z.array(z.object({ item: z.string(), notes: z.string() })),
    })
  ),
  "14_cross_project_reference_log": z.object({
    project_1: z.object({ working_title: z.string(), version: z.string() }).nullable(),
    project_2: z.array(
      z.object({ character_name: z.string(), story_role: z.string(), canon_status: z.string() })
    ),
  }),
  "15_version_history": z.array(
    z.object({ version: z.string(), date: z.string(), summary_of_changes: z.string() })
  ),
});

export const WORLD_BIBLE_SECTION_ORDER: (keyof WorldBibleDocument)[] = [
  "1_document_metadata",
  "2_world_overview_complexity_summary",
  "3_world_assumptions_canon_rules",
  "4_master_world_pillars",
  "5_geography_settings_registry",
  "6_societal_infrastructure_manual",
  "7_cultural_lived_experience_profiles",
  "8_narrative_lore_history",
  "9_system_mechanics",
  "10_significant_institutions_artifacts",
  "11_linguistic_communication_profile",
  "12_interconnection_map_systems_synthesis",
  "13_outstanding_world_questions",
  "14_cross_project_reference_log",
  "15_version_history",
];

export const WORLD_BIBLE_MARKDOWN_HEADERS: { n: number; title: string }[] = [
  { n: 1, title: "Document Metadata" },
  { n: 2, title: "World Overview & Complexity Summary" },
  { n: 3, title: "High-Level World Assumptions & Canon Rules" },
  { n: 4, title: "Master World Pillars" },
  { n: 5, title: "Geography & Settings Registry" },
  { n: 6, title: "Societal Infrastructure Manual" },
  { n: 7, title: "Cultural & Lived Experience Profiles" },
  { n: 8, title: "Narrative Lore & History" },
  { n: 9, title: "System Mechanics" },
  { n: 10, title: "Significant Institutions & Artifacts" },
  { n: 11, title: "Linguistic & Communication Profile" },
  { n: 12, title: "Interconnection Map & Systems Synthesis" },
  { n: 13, title: "Outstanding World Questions" },
  { n: 14, title: "Cross-Project Reference Log" },
  { n: 15, title: "Version History" },
];

/** `WORLD_BIBLE_SECTION_ORDER` and `WORLD_BIBLE_MARKDOWN_HEADERS` are
 * index-aligned (both list all 15 sections in the same order) - this
 * looks up a JSON key's human-readable "N. Title" label for error
 * messages, e.g. "5_geography_settings_registry" -> "5. Geography &
 * Settings Registry". */
function sectionLabel(key: string): string {
  const idx = WORLD_BIBLE_SECTION_ORDER.indexOf(key as (typeof WORLD_BIBLE_SECTION_ORDER)[number]);
  if (idx === -1) return key;
  const header = WORLD_BIBLE_MARKDOWN_HEADERS[idx];
  return `${header.n}. ${header.title}`;
}
```

- [ ] **Step 2: Add `lintWorldBibleDocument`**

Add after Step 1's code:

```ts
export function lintWorldBibleDocument(doc: unknown): { valid: boolean; errors: string[] } {
  const parsed = WorldBibleDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const key = typeof issue.path[0] === "string" ? issue.path[0] : "document";
      return `${sectionLabel(key)}: ${issue.message}`;
    });
    return { valid: false, errors };
  }

  const actualOrder = Object.keys(parsed.data).filter((k) => k !== "schema_version");
  const orderMatches =
    actualOrder.length === WORLD_BIBLE_SECTION_ORDER.length &&
    actualOrder.every((k, i) => k === WORLD_BIBLE_SECTION_ORDER[i]);
  if (!orderMatches) {
    return {
      valid: false,
      errors: [
        `Sections are not in the required order. Expected: ${WORLD_BIBLE_SECTION_ORDER.join(", ")}. Found: ${actualOrder.join(", ")}.`,
      ],
    };
  }

  return { valid: true, errors: [] };
}
```

- [ ] **Step 3: Add `lintWorldBibleMarkdown`**

Add after Step 2's function:

```ts
export function lintWorldBibleMarkdown(markdown: string): { valid: boolean; errors: string[] } {
  const headerLines = markdown
    .split("\n")
    .map((line) => line.match(/^## (\d+)\. (.+)$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ n: Number(m[1]), title: m[2].trim() }));

  const errors: string[] = [];
  if (headerLines.length !== WORLD_BIBLE_MARKDOWN_HEADERS.length) {
    errors.push(
      `Expected ${WORLD_BIBLE_MARKDOWN_HEADERS.length} numbered section headers, found ${headerLines.length}.`
    );
  }

  const checkCount = Math.min(headerLines.length, WORLD_BIBLE_MARKDOWN_HEADERS.length);
  for (let i = 0; i < checkCount; i++) {
    const expected = WORLD_BIBLE_MARKDOWN_HEADERS[i];
    const actual = headerLines[i];
    if (actual.n !== expected.n || actual.title !== expected.title) {
      errors.push(
        `Section ${i + 1}: expected "## ${expected.n}. ${expected.title}", found "## ${actual.n}. ${actual.title}".`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace with a `tsx` script (pure functions, no API key or Firestore needed):
1. Construct a complete, valid `WorldBibleDocument`-shaped object (all 15 keys, correct types, correct order) → `lintWorldBibleDocument(doc)` returns `{ valid: true, errors: [] }`.
2. Same object with `"5_geography_settings_registry"` deleted entirely → returns `{ valid: false, errors: [...] }` with an error mentioning `"5. Geography & Settings Registry"`.
3. Same valid object but with `"4_master_world_pillars"` set to a plain string instead of an array → returns an error mentioning `"4. Master World Pillars"`.
4. Same valid object but with its keys constructed in a shuffled order (e.g. build the object literal with `"3_world_assumptions_canon_rules"` before `"2_world_overview_complexity_summary"`) → returns `{ valid: false }` with the order-mismatch error (confirm this actually triggers — JS preserves string-key insertion order, so constructing the literal in a different order must produce a different `Object.keys()` sequence).
5. Call `renderWorldBibleMarkdown` (from `worldEngine/worldBibleCompiler.ts`, issue #50 — already exported) on a valid constructed document, then `lintWorldBibleMarkdown(markdown)` on the result → `{ valid: true, errors: [] }`.
6. Take that same valid Markdown string and manually edit one header line's text (e.g. change `## 7. Cultural & Lived Experience Profiles` to `## 7. Cultural Profiles`) → `lintWorldBibleMarkdown` reports exactly one error for section 7, no others.
7. Take the valid Markdown and delete one header line entirely (e.g. remove the `## 12. ...` line) → reports the count mismatch AND correctly identifies every subsequent section as misaligned (since removing one header shifts all following ones by one position) — confirm this cascading behavior is expected and not a bug in your trace's assertions.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/worldEngine/worldBibleLint.ts
git commit -m "feat: add World Bible structure-lint (issue #51)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 2: `confirmed`/`confirmedAt` storage

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`
- Modify: `web/src/lib/worldEngine/worldBibleCompiler.ts`

**Interfaces:**
- Consumes: nothing new in `storyStore.ts`. `worldBibleCompiler.ts`'s change consumes nothing new either — it's a two-field addition to an object literal already being built.
- Produces: `StoredWorldBibleVersion` gains `confirmed: boolean`, `confirmedAt: string | null`. `confirmWorldBibleVersion(storyId, version): Promise<StoredWorldBibleVersion>`. Task 3's route calls `confirmWorldBibleVersion`.

- [ ] **Step 1: Extend `StoredWorldBibleVersion`**

In `web/src/lib/canonEngine/storyStore.ts`, find the `StoredWorldBibleVersion` interface (added in issue #50):

```ts
export interface StoredWorldBibleVersion {
  version: number;
  date: string;
  summary_of_changes: string;
  json: WorldBibleDocument;
  markdown: string;
  elementsSnapshot: Record<string, { status: string; value: unknown }>;
}
```

Add two fields at the end:

```ts
export interface StoredWorldBibleVersion {
  version: number;
  date: string;
  summary_of_changes: string;
  json: WorldBibleDocument;
  markdown: string;
  elementsSnapshot: Record<string, { status: string; value: unknown }>;
  /** Issue #51 - true only once the structure-lint has passed and the
   * author has explicitly confirmed this specific version. Never set
   * automatically, never reversible in this issue's scope - a later,
   * better World Bible gets a new compiled version instead (versions are
   * otherwise immutable once written, issue #50 Decision 5). */
  confirmed: boolean;
  confirmedAt: string | null;
}
```

- [ ] **Step 2: Add `confirmWorldBibleVersion`**

Add immediately after the existing `saveWorldBibleVersion` function (issue #50) in the same file:

```ts
/** Marks a specific World Bible version Confirmed (issue #51) - the
 * caller (the new confirm route) is responsible for running the
 * structure-lint first and only calling this on a pass. Idempotent: a
 * second confirm on an already-confirmed version simply re-sets
 * confirmedAt rather than being rejected - simplest option, no new state
 * to guard against, per the design doc's Testing section. */
export async function confirmWorldBibleVersion(
  storyId: string,
  version: number
): Promise<StoredWorldBibleVersion> {
  const ref = worldBibleVersionsCollection(storyId).doc(String(version));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`World Bible version ${version} not found for story "${storyId}".`);
  }
  const stored = snap.data() as StoredWorldBibleVersion;
  const updated: StoredWorldBibleVersion = {
    ...stored,
    confirmed: true,
    confirmedAt: new Date().toISOString(),
  };
  await ref.set(updated);
  return updated;
}
```

- [ ] **Step 3: Set the default fields at compile time**

In `web/src/lib/worldEngine/worldBibleCompiler.ts`, find `generateWorldBibleDocument`'s (issue #50) construction of the `stored: StoredWorldBibleVersion` object literal:

```ts
  const stored: StoredWorldBibleVersion = {
    version,
    date,
    summary_of_changes: summary,
    json,
    markdown,
    elementsSnapshot: snapshot,
  };
```

Add the two new required fields (both default to "not yet confirmed"):

```ts
  const stored: StoredWorldBibleVersion = {
    version,
    date,
    summary_of_changes: summary,
    json,
    markdown,
    elementsSnapshot: snapshot,
    confirmed: false,
    confirmedAt: null,
  };
```

- [ ] **Step 4: Return the new fields from the existing compile route's response**

`web/src/app/api/world-chat/document/route.ts`'s `POST` handler (issue #50) returns an explicit field list, not the whole `StoredWorldBibleVersion` object, so it won't automatically pick up the two new fields. Find its `NextResponse.json({...}, { status: 201 })` call:

```ts
    const version = await generateWorldBibleDocument(storyId);
    return NextResponse.json(
      {
        version: version.version,
        date: version.date,
        summary_of_changes: version.summary_of_changes,
        markdown: version.markdown,
        json: version.json,
      },
      { status: 201 }
    );
```

Add the two new fields so this route's response shape stays consistent with the confirm route's (Task 3) and the per-version GET route's (Task 4) response shapes — all three should return the same fields for the same underlying `StoredWorldBibleVersion`:

```ts
    const version = await generateWorldBibleDocument(storyId);
    return NextResponse.json(
      {
        version: version.version,
        date: version.date,
        summary_of_changes: version.summary_of_changes,
        markdown: version.markdown,
        json: version.json,
        confirmed: version.confirmed,
        confirmedAt: version.confirmedAt,
      },
      { status: 201 }
    );
```

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean (TypeScript will refuse to compile `generateWorldBibleDocument`'s object literal in Step 3 if the two new required fields are missing, so a clean build is strong direct evidence that step was applied correctly).

Trace by reading the code: confirm `confirmWorldBibleVersion` throws (not silently no-ops) when `version` doesn't exist for the story, and confirm calling it twice in a row (by reading the logic, no need to actually run it against Firestore) would produce two different `confirmedAt` timestamps with no error either time. Confirm the Step 4 edit means a freshly compiled version's response now explicitly reports `confirmed: false, confirmedAt: null` rather than omitting the fields.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canonEngine/storyStore.ts web/src/lib/worldEngine/worldBibleCompiler.ts web/src/app/api/world-chat/document/route.ts
git commit -m "feat: add confirmed/confirmedAt to StoredWorldBibleVersion (issue #51)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 3: Confirm API route

**Files:**
- Create: `web/src/app/api/world-chat/document/[version]/confirm/route.ts`

**Interfaces:**
- Consumes: `lintWorldBibleDocument`/`lintWorldBibleMarkdown` (Task 1), `confirmWorldBibleVersion` (Task 2), `getStory`/`getWorldBibleVersion` (`@/lib/canonEngine/storyStore`), `getMembership` (`@/lib/workspace/workspaceStore`), `requireUser` (`@/lib/session`), `errorResponse` (`@/lib/apiErrors`).
- Produces: `POST /api/world-chat/document/[version]/confirm` (body `{ storyId }`) → `422 { errors: string[] }` on lint failure, `200 { version, date, summary_of_changes, markdown, json, confirmed, confirmedAt }` on success. Task 4's UI calls this route.

- [ ] **Step 1: Create the route**

Create `web/src/app/api/world-chat/document/[version]/confirm/route.ts`, following the same auth/lookup pattern already established by `web/src/app/api/world-chat/document/[version]/route.ts` (issue #50):

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, getWorldBibleVersion, confirmWorldBibleVersion } from "@/lib/canonEngine/storyStore";
import { lintWorldBibleDocument, lintWorldBibleMarkdown } from "@/lib/worldEngine/worldBibleLint";

export const runtime = "nodejs";

/** Marks a compiled World Bible version Confirmed, gated on the structure-lint (issue #51, PRD §2.3). Never mutates on a lint failure. */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/world-chat/document/[version]/confirm">
) {
  try {
    const user = await requireUser();
    const { version: versionParam } = await ctx.params;
    const version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "Invalid version number." }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const storyId: unknown = body?.storyId;
    if (typeof storyId !== "string" || !storyId) {
      return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
    }
    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const stored = await getWorldBibleVersion(storyId, version);
    if (!stored) {
      return NextResponse.json({ error: `World Bible version ${version} not found.` }, { status: 404 });
    }

    const jsonLint = lintWorldBibleDocument(stored.json);
    const markdownLint = lintWorldBibleMarkdown(stored.markdown);
    const errors = [...jsonLint.errors, ...markdownLint.errors];
    if (errors.length > 0) {
      return NextResponse.json({ errors }, { status: 422 });
    }

    const updated = await confirmWorldBibleVersion(storyId, version);
    return NextResponse.json({
      version: updated.version,
      date: updated.date,
      summary_of_changes: updated.summary_of_changes,
      markdown: updated.markdown,
      json: updated.json,
      confirmed: updated.confirmed,
      confirmedAt: updated.confirmedAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Manually trace, by reading the code:
1. A `stored.json`/`stored.markdown` pair that both lint clean → `confirmWorldBibleVersion` is called, `200` with `confirmed: true` returned.
2. A `stored.json` with one missing section → `lintWorldBibleDocument` returns errors, the route returns `422` with those errors, and `confirmWorldBibleVersion` is never called (trace that the early `return` genuinely happens before that call).
3. An invalid `version` path segment (non-numeric) → `400` before any Firestore read, same pattern as issue #50's sibling `[version]/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/world-chat/document/[version]/confirm/route.ts
git commit -m "feat: add World Bible confirm API route (issue #51)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 4: UI wiring in `WorldInterview.tsx`

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: the route from Task 3, the existing `worldBibleDoc` state (issue #50).

The current World Bible compile panel (issue #50, `data-testid="world-bible-compile-card"`) shows, once `worldBibleDoc` exists: a version summary line, Download .md / Download .json / Recompile buttons, and a version-count footer. This task adds a "Mark as Confirmed" action to that same panel.

- [ ] **Step 1: Add state**

Find the existing World Bible state block (`worldBibleDoc`, `worldBibleVersions`, `compiling`, `compileError` — issue #50). Add two more state variables alongside them:

```ts
  const [confirming, setConfirming] = useState(false);
  const [confirmErrors, setConfirmErrors] = useState<string[] | null>(null);
```

- [ ] **Step 2: Extend `worldBibleDoc`'s type to carry confirmed status**

Find `worldBibleDoc`'s state type declaration (issue #50):

```ts
  const [worldBibleDoc, setWorldBibleDoc] = useState<{
    version: number;
    date: string;
    summary_of_changes: string;
    markdown: string;
    json: unknown;
  } | null>(null);
```

Add the two new fields (both routes that ever call `setWorldBibleDoc` — the existing compile POST and the existing resume-hydration fetch — already return these fields as of issue #50's `document/[version]/route.ts`, wait: that route does NOT currently return `confirmed`/`confirmedAt` since it predates this issue. **Also update `web/src/app/api/world-chat/document/[version]/route.ts`'s response** (the GET route, issue #50) to include `confirmed: stored.confirmed, confirmedAt: stored.confirmedAt` alongside its existing fields, so the resume-hydration path (which calls this exact route) can populate the new state fields too — otherwise a page reload would show "confirmed" documents as unconfirmed):

```ts
  const [worldBibleDoc, setWorldBibleDoc] = useState<{
    version: number;
    date: string;
    summary_of_changes: string;
    markdown: string;
    json: unknown;
    confirmed: boolean;
    confirmedAt: string | null;
  } | null>(null);
```

- [ ] **Step 3: Add the confirm handler**

Add near the existing `generateWorldBible` function (issue #50):

```ts
  async function confirmWorldBible() {
    if (!canvasId || !worldBibleDoc || confirming) return;
    setConfirming(true);
    setConfirmErrors(null);
    try {
      const res = await fetch(`/api/world-chat/document/${worldBibleDoc.version}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConfirmErrors(Array.isArray(data.errors) ? data.errors : [data.error ?? "Couldn't confirm this version."]);
        return;
      }
      setWorldBibleDoc(data);
    } catch {
      setConfirmErrors(["Couldn't reach the server."]);
    } finally {
      setConfirming(false);
    }
  }
```

- [ ] **Step 4: Render the confirm action**

Find the existing button row inside the `{worldBibleDoc && (...)}` branch of the World Bible compile panel (issue #50 — the `<div className="flex flex-wrap gap-2">` containing Download .md / Download .json / Recompile). Add a fourth button immediately after "Recompile", and an error block immediately after that `<div>`:

```tsx
                          <button
                            onClick={confirmWorldBible}
                            disabled={confirming || worldBibleDoc.confirmed}
                            className="rounded-lg border border-emerald-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {worldBibleDoc.confirmed ? "Confirmed" : confirming ? "Confirming…" : "Mark as Confirmed"}
                          </button>
                        </div>
                        {confirmErrors && confirmErrors.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs text-red-400">
                            {confirmErrors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        )}
```

(The `</div>` above closes the existing button row `<div>` — this replaces that line's existing closing tag with the same closing tag followed by the new error block, it does not add an extra nesting level. Read the actual current JSX carefully before editing so the tags stay balanced.)

- [ ] **Step 5: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

For browser verification, follow the same network-mock approach every prior UI task in this file used (no Firestore emulator/test credentials in this sandbox): mock `/api/world-chat/document/[version]/confirm` to return a `422` with a constructed `errors` array, drive the real component, and confirm the errors render as a list; then mock a `200` success response and confirm the button becomes disabled and reads "Confirmed". Clearly disclose what you could not verify end-to-end rather than fabricating a full test, matching the established convention for this file.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/WorldInterview.tsx web/src/app/api/world-chat/document/[version]/route.ts
git commit -m "feat: add Mark as Confirmed UI for the compiled World Bible (issue #51)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
