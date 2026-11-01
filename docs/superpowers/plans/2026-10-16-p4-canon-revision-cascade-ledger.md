# P4 Canon Revision Cascade Tracing & Continuity Ledger Implementation Plan

**Goal:** Implement GitHub issue #72 per
`docs/superpowers/specs/2026-10-16-p4-canon-revision-cascade-ledger-design.md`: extend #64's
Canon Revision Path cascade tracing to cover `unit_regression` and a new structural-downstream
axis, and add a queryable/viewable Dependency & Continuity Ledger logging every `Confirmed`
transition and every Canon Revision decision.

**Architecture:** Additive throughout — no existing field, type, or behavior from #64 is removed
or renamed. New Firestore subcollection `p4ContinuityLedger`, new pure cascade-computation helper
in `canonRevision.ts`, one new GET route, one new panel component mounted into the existing
`/story-architecture` screen.

**Tech Stack:** Next.js App Router API routes, Firestore (via `canonEngine/storyStore.ts`'s
existing accessor conventions), React (`"use client"` components), Vitest.

## Global Constraints

- Never write into P1/P2/P3's own canon stores. Cascade tracing is read-only discovery + logging.
- Never mutate another P4 unit's status/content as a side effect of cascade tracing — flagging
  only.
- All new Firestore writes (`appendP4ContinuityLedgerEntry` calls from ordinary turn processing)
  must be best-effort/non-blocking, matching the existing `deferred_items` try/catch pattern in
  `architecture-chat/route.ts` — a ledger-write failure must never 500 an otherwise-successful
  chat turn.
- Firestore rejects an explicit `undefined` field value (`ignoreUndefinedProperties` is not set
  repo-wide) — use conditional spreads for every optional field on every new entry type, matching
  `P4CanonRevisionLogEntry`'s/`P3ConflictLogEntry`'s own existing fix for this exact hazard.
- Do not touch `p4CanonRevisionLog`'s existing shape or `appendP4CanonRevisionLog`'s call sites
  beyond adding the new, separate ledger-entry writes alongside them.

---

### Task 1: `P4ContinuityLedgerEntry` type + append/list functions in `storyStore.ts`

**Files:**
- Modify: `web/src/lib/canonEngine/storyStore.ts`

**Interfaces:**
- Produces: `P4ContinuityLedgerEntry` (exported type), `appendP4ContinuityLedgerEntry(storyId,
  entry): Promise<void>`, `listP4ContinuityLedger(storyId): Promise<P4ContinuityLedgerEntry[]>`.
- Consumed by: Task 2 (`canonRevision.ts`), Task 3 (`architecture-chat/route.ts`), Task 4 (the
  new GET route).

- [ ] **Step 1:** Immediately after the existing `appendP4CanonRevisionLog` function (currently
  ends around line 770), add:

```typescript
/** Project 4's Dependency & Continuity Ledger (issue #72) - a durable,
 * author-queryable record distinct from p4CanonRevisionLog above:
 * p4CanonRevisionLog only ever captures a Canon-Revision-Path
 * *resolution*; this ledger additionally captures every ordinary
 * Confirmed transition reached through everyday turn processing (the
 * common case - most units become Confirmed without ever triggering a
 * conflict), which had no durable record anywhere before this issue.
 * See docs/superpowers/specs/2026-10-16-p4-canon-revision-cascade-ledger-design.md
 * for why this is additive rather than a reshape of p4CanonRevisionLog. */
export type P4ContinuityLedgerEntry =
  | {
      kind: "confirmed_transition";
      unitId: string;
      description: string;
      resolvedBy: string;
      ts: string;
      turnId: string;
    }
  | {
      kind: "canon_revision";
      unitId: string;
      description: string;
      resolution: "revert" | "accept_and_update" | "park";
      /** Present only when this resolution's trigger was a canon_contradiction. */
      sourceProject?: "Project 1" | "Project 2" | "Project 3";
      contradictedRef?: string;
      /** The merged, de-duplicated cascade-review result computed at
       * resolution time (canonRevision.ts) - present (possibly empty)
       * whenever cascade tracing ran for this resolution, absent when it
       * didn't apply (e.g. "revert"/"park", which trigger no cascade
       * computation at all). */
      downstreamUnits?: { id: string; description: string }[];
      resolvedBy: string;
      ts: string;
      turnId: string;
    };

function p4ContinuityLedgerCollection(storyId: string) {
  return storiesCollection().doc(storyId).collection("p4ContinuityLedger");
}

/** Appends one entry to Project 4's Dependency & Continuity Ledger (issue #72). */
export async function appendP4ContinuityLedgerEntry(
  storyId: string,
  entry: P4ContinuityLedgerEntry
): Promise<void> {
  await p4ContinuityLedgerCollection(storyId).add(entry);
}

/** Reads the full ledger, oldest first - mirrors listP3ConflictLog's own
 * shape exactly (issue #159 is the separate, narrower effort to add an
 * equivalent reader for p4CanonRevisionLog specifically; this is this
 * issue's own, broader ledger). */
export async function listP4ContinuityLedger(storyId: string): Promise<P4ContinuityLedgerEntry[]> {
  const snap = await p4ContinuityLedgerCollection(storyId).orderBy("ts", "asc").get();
  return snap.docs.map((d) => d.data() as P4ContinuityLedgerEntry);
}
```

- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .` from `web/` must be clean (no other file
  references this yet, so this step is purely a syntax/type self-check).

---

### Task 2: Structural-downstream cascade helper + extend `resolveP4Conflict`

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/canonRevision.ts`

**Interfaces:**
- Consumes: `appendP4ContinuityLedgerEntry` from `@/lib/canonEngine/storyStore` (new import).
- Produces: a new exported `computeStructuralDownstream` helper (for direct unit-testing);
  `resolveP4Conflict`'s existing public signature/return shape is unchanged (`cascadeReview` is
  still `P4CascadeReviewEntry[] | null`), but it is now populated for `unit_regression` too, and
  merged/de-duplicated for `canon_contradiction`.

- [ ] **Step 1: Add the structural-downstream helper.** Immediately before `resolveP4Conflict`,
  add:

```typescript
/**
 * Structural-downstream cascade (issue #72) - every OTHER unit whose
 * stepNumber is strictly later than the affected unit's own stepNumber.
 * A screenplay is sequential: a scene built at a later step was very
 * plausibly written assuming whatever was true at an earlier step still
 * holds, so this applies identically to both Canon Revision Path
 * trigger kinds (unlike the same-canon-ref scan below, which only makes
 * sense for canon_contradiction). One-hop only (direct "later step"
 * units, not a transitive walk) - see the design spec's "Decision:
 * cascade-tracing scope" section for why. Returns [] (not null) when
 * the affected unit's own stepNumber is null - nothing to compare
 * against, never treated as "no downstream units exist."
 */
export function computeStructuralDownstream(units: StructuralUnit[], affectedUnitId: string): P4CascadeReviewEntry[] {
  const affected = findUnit(units, affectedUnitId);
  if (!affected || affected.stepNumber === null) return [];
  return units
    .filter((u) => u.unitId !== affectedUnitId && u.stepNumber !== null && u.stepNumber > affected.stepNumber!)
    .map((u) => ({
      id: u.unitId,
      description: `Built at a later structural step (Step ${u.stepNumber}) than the unit that just changed - review for continuity.`,
    }));
}

/** Merges two cascade-review lists, de-duplicating by id (a unit can
 * legitimately appear in both the same-ref-citer scan and the
 * structural-downstream scan) - the first occurrence's description
 * wins, matching Array.from(new Set(...))'s own existing "first write
 * wins" convention this file already uses for canonRefs. */
function mergeCascadeReview(...lists: P4CascadeReviewEntry[][]): P4CascadeReviewEntry[] {
  const byId = new Map<string, P4CascadeReviewEntry>();
  for (const list of lists) {
    for (const entry of list) {
      if (!byId.has(entry.id)) byId.set(entry.id, entry);
    }
  }
  return Array.from(byId.values());
}
```

- [ ] **Step 2: Extend the `accept_and_update` branch to compute cascade for BOTH trigger kinds.**
  Currently (see existing lines ~133-147) `cascadeReview` is only ever assigned inside
  `if (conflict.kind === "canon_contradiction") { ... }`. Restructure so the structural-downstream
  scan runs unconditionally for `accept_and_update`, and the existing same-ref-citer/P3-dependents
  scans still only run for `canon_contradiction`, then merge:

Replace:
```typescript
    if (conflict.kind === "canon_contradiction") {
      const p4Entries: P4CascadeReviewEntry[] = updatedUnits
        .filter((u) => u.unitId !== conflict.unitId && u.canonRefs.includes(conflict.contradictedRef))
        .map((u) => ({ id: u.unitId, description: `Another structural unit (${u.type}) in this screenplay that also cites this reference.` }));

      let p3Entries: P4CascadeReviewEntry[] = [];
      if (conflict.sourceProject === "Project 3") {
        const dependents = await listDependents(storyId, conflict.contradictedRef, WORLD_ELEMENTS_COLLECTION);
        p3Entries = dependents
          .filter((e) => e.status === "Confirmed")
          .map((e) => ({ id: e.element_id, description: "Confirmed World Bible element that currently depends on this pillar." }));
      }

      cascadeReview = [...p3Entries, ...p4Entries];
    }
```

with:
```typescript
    const structuralDownstream = computeStructuralDownstream(updatedUnits, conflict.unitId);

    if (conflict.kind === "canon_contradiction") {
      const p4Entries: P4CascadeReviewEntry[] = updatedUnits
        .filter((u) => u.unitId !== conflict.unitId && u.canonRefs.includes(conflict.contradictedRef))
        .map((u) => ({ id: u.unitId, description: `Another structural unit (${u.type}) in this screenplay that also cites this reference.` }));

      let p3Entries: P4CascadeReviewEntry[] = [];
      if (conflict.sourceProject === "Project 3") {
        const dependents = await listDependents(storyId, conflict.contradictedRef, WORLD_ELEMENTS_COLLECTION);
        p3Entries = dependents
          .filter((e) => e.status === "Confirmed")
          .map((e) => ({ id: e.element_id, description: "Confirmed World Bible element that currently depends on this pillar." }));
      }

      cascadeReview = mergeCascadeReview(p3Entries, p4Entries, structuralDownstream);
    } else {
      // unit_regression (issue #72 - previously always null here): no
      // contradictedRef exists to scan canonRefs/listDependents by, but
      // the structural-downstream axis applies identically regardless
      // of trigger kind.
      cascadeReview = structuralDownstream;
    }
```

(Note: this moves the computation out from under the `if` so it runs for both kinds; the
`unit_regression` branch of the outer `if (resolution === "park") {...} else if (resolution ===
"accept_and_update") {...}` is where this new `else` lives — `conflict.kind` is always
`"unit_regression"` here since the `canon_contradiction` case is handled by the `if` above it.)

- [ ] **Step 3: Append ledger entries.** At the very end of `resolveP4Conflict`, immediately after
  the existing `await appendP4CanonRevisionLog(...)` call and before `return { units:
  updatedUnits, cascadeReview };`, add:

```typescript
  // Dependency & Continuity Ledger (issue #72) - a durable, author-
  // queryable record of this decision, additive to the log above (see
  // the design spec for why these are two separate collections).
  await appendP4ContinuityLedgerEntry(storyId, {
    kind: "canon_revision",
    unitId: conflict.unitId,
    description:
      conflict.kind === "unit_regression"
        ? `Unit "${conflict.unitId}" attempted regression to ${conflict.requestedStatus}`
        : `Unit "${conflict.unitId}" contradicted ${conflict.sourceProject} canon "${conflict.contradictedRef}"`,
    resolution,
    ...(conflict.kind === "canon_contradiction"
      ? { sourceProject: conflict.sourceProject, contradictedRef: conflict.contradictedRef }
      : {}),
    ...(cascadeReview !== null ? { downstreamUnits: cascadeReview } : {}),
    resolvedBy,
    ts: new Date().toISOString(),
    turnId,
  });

  // A separate, independently-true fact: this resolution may ALSO have
  // just landed the unit on Confirmed (accept_and_update only - revert
  // keeps prior state, park always lands on Parked). Logged as its own
  // confirmed_transition entry rather than folded into the entry above,
  // matching the design spec's "both facts get their own entry" call.
  // existing is the unit's status BEFORE this turn's resolution; only a
  // genuine new arrival at Confirmed is logged, not an already-Confirmed
  // unit (which unit_regression's own trigger condition makes
  // impossible to reach here anyway - isValidTransition(Confirmed,
  // Confirmed) is true, so that case never opens this conflict kind in
  // the first place; stated for canon_contradiction, where it's
  // reachable).
  if (resolution === "accept_and_update" && existing?.status !== "Confirmed") {
    const resolvedUnit = findUnit(updatedUnits, conflict.unitId);
    if (resolvedUnit?.status === "Confirmed") {
      await appendP4ContinuityLedgerEntry(storyId, {
        kind: "confirmed_transition",
        unitId: conflict.unitId,
        description: `Unit "${conflict.unitId}" confirmed via the Canon Revision Path (accept_and_update)`,
        resolvedBy,
        ts: new Date().toISOString(),
        turnId,
      });
    }
  }
```

- [ ] **Step 4: Add the import.** At the top of the file, change:
```typescript
import { appendP4CanonRevisionLog, appendOutstandingQuestions, type P4PendingConflict } from "@/lib/canonEngine/storyStore";
```
to:
```typescript
import {
  appendP4CanonRevisionLog,
  appendP4ContinuityLedgerEntry,
  appendOutstandingQuestions,
  type P4PendingConflict,
} from "@/lib/canonEngine/storyStore";
```

- [ ] **Step 5: Verify.** `npx tsc --noEmit -p .` from `web/` clean. Existing
  `canonRevision.test.ts` mocks `@/lib/canonEngine/storyStore` with only
  `appendP4CanonRevisionLog`/`appendOutstandingQuestions` — it will need
  `appendP4ContinuityLedgerEntry: vi.fn().mockResolvedValue(undefined)` added to that mock before
  the existing tests pass again (do this now so Task 2's own existing-test regression is fixed
  before Task 6 adds new tests).

---

### Task 3: Log ordinary `Confirmed` transitions from `architecture-chat/route.ts`

**Files:**
- Modify: `web/src/app/api/architecture-chat/route.ts`

**Interfaces:**
- Consumes: `appendP4ContinuityLedgerEntry` from `@/lib/canonEngine/storyStore` (new import).

- [ ] **Step 1:** In the ordinary-processing `else` branch (where `attempt =
  attemptStatusTransition(...)` is computed, currently around line 348), capture the unit's
  status immediately before this turn's attempt — add right before the `attemptStatusTransition`
  call:

```typescript
            const statusBeforeAttempt = existing?.status ?? null;
```

- [ ] **Step 2:** Immediately after `effectiveUnit = finalUnit;` (currently line 375), add a
  best-effort, non-blocking ledger write, matching the existing `deferred_items` try/catch
  pattern used later in this same file for the exact same "never fail the turn" reasoning:

```typescript
            if (attempt.accepted && finalUnit.status === "Confirmed" && statusBeforeAttempt !== "Confirmed") {
              try {
                await appendP4ContinuityLedgerEntry(storyId, {
                  kind: "confirmed_transition",
                  unitId: finalUnit.unitId,
                  description: `Unit "${finalUnit.unitId}" confirmed`,
                  resolvedBy: user.uid,
                  ts: new Date().toISOString(),
                  turnId,
                });
              } catch (ledgerErr) {
                console.warn(`[architecture-chat] continuity ledger write failed for turn ${turnId}:`, ledgerErr);
              }
            }
```

- [ ] **Step 3: Add the import.** Change the existing `storyStore` import block to add
  `appendP4ContinuityLedgerEntry` alongside the other named imports already destructured there.

- [ ] **Step 4: Verify.** `npx tsc --noEmit -p .` clean.

---

### Task 4: New GET reader route for the ledger

**Files:**
- Create: `web/src/app/api/architecture-chat/ledger/route.ts`

**Interfaces:**
- Consumes: `requireUser` (`@/lib/session`), `errorResponse` (`@/lib/apiErrors`), `getMembership`
  (`@/lib/workspace/workspaceStore`), `getStory`/`listP4ContinuityLedger`
  (`@/lib/canonEngine/storyStore`).
- Produces: `GET /api/architecture-chat/ledger?storyId=...` -> `{ entries:
  P4ContinuityLedgerEntry[] }`. Consumed by Task 5's panel.

- [ ] **Step 1:** Create the file, mirroring `web/src/app/api/world-chat/entries/route.ts`'s GET
  handler exactly in auth/membership shape:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { errorResponse } from "@/lib/apiErrors";
import { getMembership } from "@/lib/workspace/workspaceStore";
import { getStory, listP4ContinuityLedger } from "@/lib/canonEngine/storyStore";

export const runtime = "nodejs";

/**
 * Reads Project 4's Dependency & Continuity Ledger (issue #72) - the
 * AC's "queryable/viewable by the author, not just an internal log"
 * requirement. Read-only; the ledger is written exclusively from
 * architecture-chat/route.ts and canonRevision.ts's resolveP4Conflict.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const storyId = req.nextUrl.searchParams.get("storyId");

    if (!storyId) {
      return NextResponse.json({ error: "Request must include a `storyId` query parameter." }, { status: 400 });
    }

    const story = await getStory(storyId);
    if (!story) {
      return NextResponse.json({ error: "Story Canvas not found." }, { status: 404 });
    }
    const membership = await getMembership(story.workspaceId, user.uid);
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this workspace." }, { status: 403 });
    }

    const entries = await listP4ContinuityLedger(storyId);
    return NextResponse.json({ entries });
  } catch (err) {
    return errorResponse(err);
  }
}
```

- [ ] **Step 2: Verify.** `npx tsc --noEmit -p .` clean.

---

### Task 5: `ArchitectureLedgerPanel.tsx` + mount into `ArchitectureInterview.tsx`

**Files:**
- Create: `web/src/components/ArchitectureLedgerPanel.tsx`
- Modify: `web/src/components/ArchitectureInterview.tsx`

**Interfaces:**
- Produces: `ArchitectureLedgerPanel` default export, props `{ storyId: string | null,
  refreshToken: number }` (mirrors `WorldSidePanelProps`'s own shape, minus the fields
  `WorldSidePanel` needs that this panel doesn't).
- Consumes (in `ArchitectureInterview.tsx`): mounted the same way `WorldInterview.tsx` mounts
  `WorldSidePanel` - inline in the scrollable content area, gated on `!resuming`.

- [ ] **Step 1:** Create `ArchitectureLedgerPanel.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";

type LedgerEntry =
  | { kind: "confirmed_transition"; unitId: string; description: string; resolvedBy: string; ts: string }
  | {
      kind: "canon_revision";
      unitId: string;
      description: string;
      resolution: "revert" | "accept_and_update" | "park";
      sourceProject?: "Project 1" | "Project 2" | "Project 3";
      contradictedRef?: string;
      downstreamUnits?: { id: string; description: string }[];
      resolvedBy: string;
      ts: string;
    };

export interface ArchitectureLedgerPanelProps {
  storyId: string | null;
  refreshToken: number;
}

/**
 * Renders Project 4's Dependency & Continuity Ledger (issue #72) -
 * mirrors WorldSidePanel.tsx's own fetch/refresh/list shape exactly,
 * trimmed to this panel's narrower need (one flat chronological list,
 * no graph view - the ledger has no dependency-graph structure of its
 * own to visualize; downstreamUnits is already a flat flagged list).
 */
export default function ArchitectureLedgerPanel({ storyId, refreshToken }: ArchitectureLedgerPanelProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Same "last request started wins" guard WorldSidePanel.tsx already
  // uses, for the same reason: refreshToken can bump more than once per
  // turn, so two requests are routinely in flight at once.
  const requestIdRef = useRef(0);

  async function loadEntries() {
    if (!storyId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/architecture-chat/ledger?storyId=${encodeURIComponent(storyId)}`);
      const data = await res.json();
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) throw new Error(data?.error || "Failed to load the Continuity Ledger.");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      if (requestId === requestIdRef.current) setLoadError("Couldn't load the Continuity Ledger — try refreshing.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, refreshToken]);

  return (
    <div
      data-testid="architecture-ledger-panel"
      className="mb-6 rounded-xl border border-orange-500/30 bg-gradient-to-br from-orange-950/40 to-neutral-900/40 px-5 py-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
          Dependency &amp; Continuity Ledger
        </p>
        <button
          onClick={loadEntries}
          disabled={loading}
          className="rounded-lg border border-orange-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-orange-200 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {loadError && <p className="mb-3 text-[11px] text-red-400">{loadError}</p>}

      {entries.length > 0 ? (
        <ul className="space-y-2">
          {entries
            .slice()
            .reverse()
            .map((e, i) => (
              <li key={`${e.unitId}-${e.ts}-${i}`} className="text-xs text-neutral-300">
                <span className="text-neutral-500">{new Date(e.ts).toLocaleString()}</span>{" "}
                <span className="font-semibold text-neutral-200">{e.unitId}</span> — {e.description}
                {e.kind === "canon_revision" && (
                  <span className="text-neutral-500"> ({e.resolution})</span>
                )}
                {e.kind === "canon_revision" && e.downstreamUnits && e.downstreamUnits.length > 0 && (
                  <ul className="ml-4 mt-1 list-disc pl-2 text-neutral-500">
                    {e.downstreamUnits.map((d) => (
                      <li key={d.id}>
                        {d.id} - {d.description}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
        </ul>
      ) : loading ? (
        <p className="text-xs text-neutral-500">Loading…</p>
      ) : loadError ? null : (
        <p className="text-xs text-neutral-500">No ledger entries yet — they&apos;ll appear here as units are confirmed or Canon Revision conflicts are resolved.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** In `ArchitectureInterview.tsx`, add the import alongside the existing component
  imports:
```typescript
import ArchitectureLedgerPanel from "@/components/ArchitectureLedgerPanel";
```

- [ ] **Step 3:** Mount it inside the scrollable content area. The simplest, most consistent
  placement (matching `WorldInterview.tsx`'s own "side panel rendered inline above the message
  list, inside the same scroll container") is immediately inside the existing
  `<div ref={containerRef} onScroll={handleScroll} ...>` block, before the `resuming`/`messages`
  rendering. Change:
```typescript
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
        {resuming && (
```
to:
```typescript
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
        {!resuming && <ArchitectureLedgerPanel storyId={canvasId} refreshToken={messages.length} />}
        {resuming && (
```

- [ ] **Step 4: Verify.** `npx tsc --noEmit -p .`, `npm run lint`, `npm run build` all clean.
  Manually start the dev server and open an existing Story Canvas's `/story-architecture` screen;
  confirm the new "Dependency & Continuity Ledger" panel renders (empty state if nothing
  confirmed/resolved yet), and that confirming a unit or resolving a Canon Revision conflict in
  the same session causes a new entry to appear after the next turn (the panel's `refreshToken`
  is `messages.length`, which bumps on every turn).

---

### Task 6: Unit tests

**Files:**
- Modify: `web/src/lib/storyArchitectureEngine/canonRevision.test.ts`

- [ ] **Step 1:** Update the existing `vi.mock("@/lib/canonEngine/storyStore", ...)` block to add
  `appendP4ContinuityLedgerEntry: vi.fn().mockResolvedValue(undefined)` (required for the existing
  tests to keep passing after Task 2's changes - do this first, confirm the existing 5 tests still
  pass, before adding new ones).

- [ ] **Step 2:** Add new `describe` blocks covering:
  - `computeStructuralDownstream` (exported, pure - test directly): returns `[]` when the
    affected unit's `stepNumber` is `null`; returns `[]` when the affected unit isn't found in
    `units`; returns only units with strictly greater `stepNumber`, excluding the affected unit
    itself and units with equal/lesser/`null` `stepNumber`.
  - `resolveP4Conflict` with a `unit_regression` conflict and `resolution: "accept_and_update"`:
    `cascadeReview` is now populated with structural-downstream units (previously always `null`
    for this kind) when other units in `units` have a later `stepNumber` than the regressed
    unit's own.
  - `resolveP4Conflict` with a `canon_contradiction` conflict: the same-ref-citer scan and the
    structural-downstream scan both contribute, and a unit appearing in both is de-duplicated to
    one entry.
  - Ledger-entry assertions: `appendP4ContinuityLedgerEntry` is called once with `kind:
    "canon_revision"` for every resolution (`revert`/`park`/`accept_and_update`); additionally
    called a second time with `kind: "confirmed_transition"` only when `accept_and_update` lands
    the unit on `Confirmed` from a non-Confirmed prior state (use the mock's `.mock.calls` to
    assert call count and the second call's shape for this case specifically; assert it is NOT
    called a second time for `revert`/`park`, or for an `accept_and_update` that lands on
    `Working` via the existing gates-not-passed clamp).

- [ ] **Step 3: Run the suite.** `npm run test` from `web/` - all tests (existing + new) pass.

---

### Task 7: Final verification and self-review

- [ ] **Step 1:** From `web/`, run in order: `npx tsc --noEmit -p .`, `npm run lint`, `npm run
  build`, `npm run test`. All four clean.
- [ ] **Step 2:** Read the full `git diff` against `main` end-to-end (this repo's "final
  whole-branch review" convention) looking specifically for: any accidental write path into
  P1/P2/P3 canon; any cascade computation that silently swallows a real error into an empty list
  (vs. a disclosed "doesn't apply" per the design spec); any ledger entry missing `resolvedBy`/
  `ts`/`turnId`; any `undefined` (vs. conditional spread) risk on a new Firestore write.
- [ ] **Step 3:** Commit, referencing issue #72, with the `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>` trailer.
- [ ] **Step 4:** Open a PR targeting `main` with `gh pr create`, body ending with `🤖 Generated
  with [Claude Code](https://claude.com/claude-code)`. Do not merge.
