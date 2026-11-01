# P4 Partial/Incremental Compilation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #71 — compile a single named Act as a versioned DRAFT, fully
separate from the real document's canon version history, with no whole-document gating (the Pre-
Compilation/Thematic Anchor audits don't apply to a subset by construction).

**Architecture:** The existing pure compiler (`compileScreenplayArchitectureDocumentJson`) gains
four optional, independently-defaulted parameters so it can render a labeled Draft without
changing full-compile behavior at all. A new orchestrator in `screenplayArchitectureCompiler.ts`
owns Act-filtering and a fully separate, per-scope Firestore draft-versioning path. A new sibling
API route skips the full-document gates entirely. A small UI addition surfaces it.

**Tech Stack:** Plain TypeScript, one new Firestore subcollection path (no composite index
needed), one new API route, React/TSX UI additions.

## Global Constraints

- The compiler function itself stays scope-agnostic - Act-filtering happens in the ORCHESTRATOR,
  not inside `compileScreenplayArchitectureDocumentJson` (design spec §2).
- Drafts NEVER touch `p4ArchitectureVersions`/its version counter - a fully separate path,
  `stories/{storyId}/p4ArchitectureDrafts/{scopeKey}/items/{draftVersion}`, with its own
  independent counter PER SCOPE (design spec §3).
- The new draft route skips `runPreCompilationAudit`/`runThematicAnchorAudit` entirely - no 409/
  `acknowledged` gate (design spec §5's resolved judgment call).
- Reuse, don't duplicate: `screenplayArchitectureCompiler.ts`'s existing `diffSummary` is exported
  (renamed `diffUnitsSnapshot`) and reused by the new draft orchestrator verbatim, not
  re-implemented.
- Design spec: `docs/superpowers/specs/2026-10-16-p4-partial-compile-design.md`.
- Verification throughout: `npm run lint`, `npm run build`, `npm run test` (vitest) from `web/`.

---

### Task 1: Extend `compileArchitectureDocument.ts` with draft-aware parameters

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts`
- Modify: `web/src/lib/canonEngine/storyStore.ts` (`ScreenplayArchitectureDocument["1_screenplay_metadata"]`)
- Modify: `web/src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts`

- [ ] **Step 1: Widen `1_screenplay_metadata` in `storyStore.ts`**

  Change `status: "Compiled";` to `status: "Compiled" | "Draft";` and add a new field right after
  it: `scope: string | null;` (with a one-line comment: "issue #71 - null for every full compile,
  a human-readable Act label for a partial draft").

- [ ] **Step 2: Add the four new params to `CompileScreenplayArchitectureDocumentParams`**

  ```ts
  import type { ActId } from "./structuralFramework"; // add to the existing structuralFramework import

  export interface CompileScreenplayArchitectureDocumentParams {
    storyId: string;
    canon: IngestedCanon;
    units: StructuralUnit[];
    version: number;
    versionHistory: { version: string; date: string; summary_of_changes: string }[];
    status?: "Compiled" | "Draft";
    scopeLabel?: string | null;
    versionLabel?: string;
    actScope?: ActId | null;
  }
  ```

- [ ] **Step 3: Destructure with defaults, wire into Section 1 and Section 3**

  At the top of `compileScreenplayArchitectureDocumentJson`:
  ```ts
  const {
    storyId, canon, units, version, versionHistory,
    status = "Compiled",
    scopeLabel = null,
    versionLabel = `v${version}`,
    actScope = null,
  } = params;
  ```
  In the returned object's `"1_screenplay_metadata"`, change
  `screenplay_architecture_version: \`v${version}\`` to `screenplay_architecture_version:
  versionLabel`, and add `status,` / `scope: scopeLabel,` (replacing the hardcoded `status:
  "Compiled"` literal).

  Change `actOverview`'s source from `STRUCTURAL_ACTS.map(...)` to:
  ```ts
  const actOverview = STRUCTURAL_ACTS.filter((act) => actScope === null || act.id === actScope).map((act) => ({
  ```
  (the `.map` body is unchanged).

- [ ] **Step 4: Render `scope` in markdown when present**

  In `renderScreenplayArchitectureMarkdown`, Section 1's block: after the existing `Status:
  ${meta.status}` line, add a conditional line:
  ```ts
  `${meta.scope ? `\n- Scope: ${meta.scope}` : ""}` +
  ```
  (placed so it renders as its own bullet only when non-null; full compiles are byte-identical to
  today's output since `meta.scope` is `null` for them).

- [ ] **Step 5: Tests**

  Add to `compileArchitectureDocument.test.ts`:
  - Omitting `status`/`scopeLabel`/`versionLabel`/`actScope` entirely produces byte-identical
    output to today's (status `"Compiled"`, scope `null`, version `` `v${version}` ``, all 4 Acts
    in Section 3) - a straight regression-safety test run against the EXISTING fixtures already in
    this file.
  - Passing `status: "Draft"`, `scopeLabel: "Act 1 (THE THESIS) - draft"`, `actScope: "1"` produces
    `status: "Draft"`, `scope: "Act 1 (THE THESIS) - draft"` in the JSON, Section 3 contains ONLY
    the `"1"` Act entry, and the markdown contains both `"Status: Draft"` and `"Scope: Act 1 (THE
    THESIS) - draft"`.
  - `versionLabel` override renders verbatim in `screenplay_architecture_version` and in the
    markdown's `Version:` line, independent of the numeric `version` param's own value.

- [ ] **Step 6: Verify**

  `npx vitest run src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts`, `npm run
  lint`.

- [ ] **Step 7: Commit**
  ```bash
  git add web/src/lib/canonEngine/storyStore.ts web/src/lib/storyArchitectureEngine/compileArchitectureDocument.ts web/src/lib/storyArchitectureEngine/compileArchitectureDocument.test.ts
  git commit -m "feat: add draft-aware status/scope/versionLabel params to the P4 compiler (issue #71)"
  ```

---

### Task 2: Draft storage + orchestrator

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts` (new types + persistence functions)
- Modify: `web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.ts` (export
  `diffUnitsSnapshot`; new `generatePartialScreenplayArchitectureDraft`)
- Create: `web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.test.ts` (or extend
  it, if issue #174's own test file of the same name already exists on `main` by the time this is
  implemented - add a new `describe` block rather than overwriting).

- [ ] **Step 1: New types + persistence functions in `storyStore.ts`**

  Add near the existing `StoredScreenplayArchitectureVersion`/version-persistence functions:
  ```ts
  export interface ScreenplayArchitectureDraftScope {
    type: "act";
    act_id: string;
  }

  export interface StoredScreenplayArchitectureDraft {
    draftId: string;
    scopeKey: string;
    scope: ScreenplayArchitectureDraftScope;
    draftVersion: number;
    date: string;
    summaryOfChanges: string;
    json: ScreenplayArchitectureDocument;
    markdown: string;
    unitsSnapshot: Record<string, { status: string; content: unknown }>;
    createdAt: string;
  }

  function p4ArchitectureDraftItemsCollection(storyId: string, scopeKey: string) {
    return storiesCollection()
      .doc(storyId)
      .collection("p4ArchitectureDrafts")
      .doc(scopeKey)
      .collection("items");
  }

  export async function listScreenplayArchitectureDrafts(
    storyId: string,
    scopeKey: string
  ): Promise<StoredScreenplayArchitectureDraft[]> {
    const snap = await p4ArchitectureDraftItemsCollection(storyId, scopeKey).orderBy("draftVersion", "asc").get();
    return snap.docs.map((d) => d.data() as StoredScreenplayArchitectureDraft);
  }

  export async function getLatestScreenplayArchitectureDraft(
    storyId: string,
    scopeKey: string
  ): Promise<StoredScreenplayArchitectureDraft | null> {
    const snap = await p4ArchitectureDraftItemsCollection(storyId, scopeKey).orderBy("draftVersion", "desc").limit(1).get();
    return snap.empty ? null : (snap.docs[0].data() as StoredScreenplayArchitectureDraft);
  }

  export async function saveScreenplayArchitectureDraft(
    storyId: string,
    draft: StoredScreenplayArchitectureDraft
  ): Promise<void> {
    await p4ArchitectureDraftItemsCollection(storyId, draft.scopeKey).doc(String(draft.draftVersion)).set(draft);
  }
  ```
  (Confirm the exact helper name for the stories collection - it's `storiesCollection()` elsewhere
  in this file; use whatever the file's own existing helper is named if it differs.)

- [ ] **Step 2: Export `diffUnitsSnapshot` from `screenplayArchitectureCompiler.ts`**

  Rename the existing private `diffSummary` function to `diffUnitsSnapshot` and add `export` to
  its declaration. Update its one existing call site (`generateScreenplayArchitectureDocument`) to
  the new name. No behavior change.

- [ ] **Step 3: `generatePartialScreenplayArchitectureDraft`**

  Add to `screenplayArchitectureCompiler.ts`:
  ```ts
  import {
    // ...existing imports...
    listScreenplayArchitectureDrafts,
    getLatestScreenplayArchitectureDraft,
    saveScreenplayArchitectureDraft,
    type StoredScreenplayArchitectureDraft,
  } from "@/lib/canonEngine/storyStore";
  import { STRUCTURAL_ACTS, type ActId } from "./structuralFramework";

  export interface GeneratePartialScreenplayArchitectureDraftParams {
    storyId: string;
    units: StructuralUnit[];
    actId: ActId;
  }

  /** Issue #71: compiles ONE named Act as a versioned DRAFT - never
   * touches p4ArchitectureVersions or its counter (see design spec
   * §3). `units` is the caller's already-fetched FULL snapshot (same
   * "caller already has it" convention issue #174 established for the
   * full compiler) - this function does the Act-filtering itself. */
  export async function generatePartialScreenplayArchitectureDraft(
    params: GeneratePartialScreenplayArchitectureDraftParams
  ): Promise<StoredScreenplayArchitectureDraft> {
    const { storyId, units, actId } = params;
    const act = STRUCTURAL_ACTS.find((a) => a.id === actId);
    if (!act) throw new Error(`Unknown Act id "${actId}".`);

    const scopeKey = `act-${actId}`;
    const scopedUnits = units.filter((u) => u.stepNumber !== null && act.stepNumbers.includes(u.stepNumber));

    const [canon, priorDraft] = await Promise.all([
      ingestCanon(storyId),
      getLatestScreenplayArchitectureDraft(storyId, scopeKey),
    ]);

    const draftVersion = (priorDraft?.draftVersion ?? 0) + 1;
    const snapshot: UnitsSnapshot = {};
    for (const u of scopedUnits) snapshot[u.unitId] = { status: u.status, content: u.content };

    const date = new Date().toISOString().slice(0, 10);
    const summary = diffUnitsSnapshot(priorDraft?.unitsSnapshot ?? null, snapshot);

    const priorHistory = priorDraft
      ? (await listScreenplayArchitectureDrafts(storyId, scopeKey)).map((d) => ({
          version: `draft-v${d.draftVersion}`,
          date: d.date,
          summary_of_changes: d.summaryOfChanges,
        }))
      : [];
    const versionHistory = [...priorHistory, { version: `draft-v${draftVersion}`, date, summary_of_changes: summary }];

    const json = compileScreenplayArchitectureDocumentJson({
      storyId,
      canon,
      units: scopedUnits,
      version: draftVersion,
      versionHistory,
      status: "Draft",
      scopeLabel: `Act ${act.id} (${act.name}) - partial compile, draft only, not final canon`,
      versionLabel: `draft-v${draftVersion}`,
      actScope: act.id,
    });
    const markdown = renderScreenplayArchitectureMarkdown(json);

    const stored: StoredScreenplayArchitectureDraft = {
      draftId: `${scopeKey}-${draftVersion}`,
      scopeKey,
      scope: { type: "act", act_id: act.id },
      draftVersion,
      date,
      summaryOfChanges: summary,
      json,
      markdown,
      unitsSnapshot: snapshot,
      createdAt: new Date().toISOString(),
    };
    await saveScreenplayArchitectureDraft(storyId, stored);
    return stored;
  }
  ```

- [ ] **Step 4: Tests**

  In `screenplayArchitectureCompiler.test.ts` (new file, or a new `describe` block if issue #174
  already created one of the same name - check before creating), mocking `storyStore`'s new draft
  functions and `ingestCanon` the same way issue #174's own compiler tests already mock them:
  - A Confirmed unit with `stepNumber: 2` (inside Act `"1"`'s `[1,2,3]`) is included in a
    `actId: "1"` draft's Scene Register; a Confirmed unit with `stepNumber: 5` (Act `"2A"`) or
    `stepNumber: null` is excluded even though it's Confirmed.
  - Calling it twice for `actId: "1"` with no prior draft, then with the first draft as prior,
    produces `draftVersion: 1` then `draftVersion: 2`; calling it once for `actId: "2A"` in
    between (independent prior-draft lookup, different `scopeKey`) produces `draftVersion: 1` for
    that Act, unaffected by Act 1's own counter.
  - An unknown `actId` (cast through `as ActId` for the test) throws synchronously before any
    Firestore/canon call.
  - The returned `json["1_screenplay_metadata"].status` is `"Draft"` and `.scope` is a non-null
    string naming the Act.

- [ ] **Step 5: Verify**

  `npx vitest run src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.test.ts`, `npm
  run lint`, `npm run build`.

- [ ] **Step 6: Commit**
  ```bash
  git add web/src/lib/canonEngine/storyStore.ts web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.ts web/src/lib/storyArchitectureEngine/screenplayArchitectureCompiler.test.ts
  git commit -m "feat: add per-Act Setup & Payoff draft storage and orchestrator (issue #71)"
  ```

---

### Task 3: New route - `POST /api/architecture-chat/document/draft`

**Files:**
- Create: `web/src/app/api/architecture-chat/document/draft/route.ts`

- [ ] **Step 1: Write the route**

  Mirrors the existing `architecture-chat/document/route.ts`'s auth/membership/story-lookup shape
  exactly, but with NO audit gating at all (design spec §5):
  ```ts
  import { NextRequest, NextResponse } from "next/server";
  import { requireUser } from "@/lib/session";
  import { errorResponse } from "@/lib/apiErrors";
  import { getMembership } from "@/lib/workspace/workspaceStore";
  import { getStory } from "@/lib/canonEngine/storyStore";
  import { generatePartialScreenplayArchitectureDraft } from "@/lib/storyArchitectureEngine/screenplayArchitectureCompiler";
  import { STRUCTURAL_ACTS, type ActId } from "@/lib/storyArchitectureEngine/structuralFramework";

  export const runtime = "nodejs";

  /** Issue #71: compiles ONE named Act as a versioned DRAFT, never
   * final canon - deliberately skips the Pre-Compilation Audit and
   * Thematic Anchor Audit entirely (see
   * docs/superpowers/specs/2026-10-16-p4-partial-compile-design.md §5
   * for why those whole-document checks don't apply to a subset by
   * construction). No 409/acknowledged gate exists on this route. */
  export async function POST(req: NextRequest) {
    try {
      const user = await requireUser();
      const body = await req.json().catch(() => null);
      const storyId: unknown = body?.storyId;
      const actId: unknown = body?.actId;
      if (typeof storyId !== "string" || !storyId) {
        return NextResponse.json({ error: "Request must include `storyId`." }, { status: 400 });
      }
      if (typeof actId !== "string" || !STRUCTURAL_ACTS.some((a) => a.id === actId)) {
        return NextResponse.json(
          { error: `\`actId\` must be one of: ${STRUCTURAL_ACTS.map((a) => a.id).join(", ")}.` },
          { status: 400 }
        );
      }
      const story = await getStory(storyId);
      if (!story) {
        return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
      }
      const membership = await getMembership(story.workspaceId, user.uid);
      if (!membership) {
        return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
      }

      const units = story.p4Units ?? [];
      const draft = await generatePartialScreenplayArchitectureDraft({ storyId, units, actId: actId as ActId });

      return NextResponse.json({
        draftId: draft.draftId,
        scopeKey: draft.scopeKey,
        scope: draft.scope,
        draftVersion: draft.draftVersion,
        date: draft.date,
        summary_of_changes: draft.summaryOfChanges,
        markdown: draft.markdown,
        json: draft.json,
        outstandingCount: draft.json["7_outstanding_decisions_version_history"].outstanding.length,
      });
    } catch (err) {
      return errorResponse(err);
    }
  }
  ```

- [ ] **Step 2: Verify**

  `npm run lint`, `npm run build`. Then trace by hand: a request with a valid `actId` and a story
  whose units include a mix of in-scope/out-of-scope, Confirmed/Working units returns 200 with the
  expected scoped Scene Register and Outstanding list; an invalid `actId` (e.g. `"4"`) returns 400
  without reaching `getStory`; a non-member returns 403 same as the full compile route.

- [ ] **Step 3: Commit**
  ```bash
  git add web/src/app/api/architecture-chat/document/draft/route.ts
  git commit -m "feat: add the partial-compile draft API route (issue #71)"
  ```

---

### Task 4: UI - Act selector + "Compile Draft" action

**Files:**
- Modify: `web/src/components/ArchitectureInterview.tsx`

- [ ] **Step 1: State + types**

  Add a client-side type mirroring the route's response shape, and state:
  ```ts
  type DraftCompiled = {
    draftId: string;
    scopeKey: string;
    scope: { type: "act"; act_id: string };
    draftVersion: number;
    date: string;
    markdown: string;
    outstandingCount: number;
  };
  ```
  ```ts
  const [draftActId, setDraftActId] = useState<"1" | "2A" | "2B" | "3">("1");
  const [draftCompiling, setDraftCompiling] = useState(false);
  const [draftCompiled, setDraftCompiled] = useState<DraftCompiled | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  ```

- [ ] **Step 2: `compileDraft` function**

  ```ts
  async function compileDraft() {
    if (!canvasId || draftCompiling) return;
    setDraftCompiling(true);
    setDraftError(null);
    try {
      const res = await fetch("/api/architecture-chat/document/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId: canvasId, actId: draftActId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDraftError(data.error ?? "Draft compile failed.");
        setDraftCompiled(null);
        return;
      }
      setDraftCompiled(data);
    } catch {
      setDraftError("Couldn't reach the server.");
    } finally {
      setDraftCompiling(false);
    }
  }
  ```

- [ ] **Step 3: UI controls**

  In the header bar, right after the existing "Compile" button, add an Act `<select>` (values
  `"1" | "2A" | "2B" | "3"`, labeled by each Act's `name` - hardcode the 4 labels here, matching
  how `routingChoice`'s own options are presented elsewhere in this file, rather than importing
  `STRUCTURAL_ACTS` into a client component) and a "Compile Draft" button calling `compileDraft()`.

- [ ] **Step 4: Result panel**

  Add a new banner/panel, visually distinct from the full-compile success banner (e.g. a
  cyan/sky border, distinguishing it from purple), rendered when `draftCompiled` is set:
  ```tsx
  {draftCompiled && (
    <div className="border-b border-cyan-500/30 bg-cyan-950/20 px-6 py-3 text-xs text-cyan-200">
      <p className="mb-2 font-semibold">
        Draft - {draftCompiled.scope.act_id} (draft-v{draftCompiled.draftVersion}) - not final canon.{" "}
        {draftCompiled.outstandingCount} outstanding item{draftCompiled.outstandingCount === 1 ? "" : "s"} in scope.
      </p>
      <button
        onClick={() => downloadText(`screenplay-architecture-draft-${draftCompiled.scopeKey}-v${draftCompiled.draftVersion}.md`, draftCompiled.markdown)}
        className="rounded-lg border border-cyan-500/50 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40"
      >
        Download draft .md
      </button>
    </div>
  )}
  {draftError && (
    <div className="border-b border-red-500/30 bg-red-950/30 px-6 py-2 text-xs text-red-200">{draftError}</div>
  )}
  ```
  (Placed near the existing full-compile result banner, after it, so both can coexist without
  visually competing for the same slot.)

- [ ] **Step 5: Verify**

  `npm run lint`, `npm run build`. Then trace the component by hand: selecting each Act and
  clicking "Compile Draft" calls the right endpoint with the right `actId`; a 400/403/404 response
  surfaces via `draftError`, never silently swallowed; the existing full-compile flow (`compiled`,
  `compileDocument`) is completely untouched by this task's diff.

- [ ] **Step 6: Commit**
  ```bash
  git add web/src/components/ArchitectureInterview.tsx
  git commit -m "feat: add Act selector and Compile Draft action to the UI (issue #71)"
  ```

---

### Task 5: Final whole-branch review

- [ ] Re-read every file touched across Tasks 1-4 together, matching this compile pipeline's own
  established closing-review precedent (issue #70's `f9f8521f`/`10b9ae16`, issue #91's plan).
- [ ] Confirm a full compile's output (status/scope/version label/Section 3) is byte-identical to
  before this issue, for every existing test fixture - no regression to the non-draft path.
- [ ] Confirm drafts never write to `p4ArchitectureVersions` and never read/affect its version
  counter - grep for any accidental cross-wire between the two orchestrator functions.
- [ ] Confirm the new route has no audit-gating call sites (grep for
  `runPreCompilationAudit`/`runThematicAnchorAudit` - neither should appear in the new route file).
- [ ] `npm run lint && npm run build && npm run test` clean from `web/`.
- [ ] Open the PR against `main` (not merged by the agent) - note in the PR description that this
  branch stacks on top of issue #173's branch/PR (the document shape this issue depends on being
  stable), per the task's own ordering instructions.
