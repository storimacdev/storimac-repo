# P3 Side-Panel UI (Issue #45) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persistent side-panel UI for Project 3's World Bible: current Stage + active Pillar, a Canon Registry list of World Entries with status badges, a browsable Outstanding Questions registry, and a simple list-view Dependency Graph.

**Architecture:** Per the design spec (`docs/superpowers/specs/2026-09-11-p3-side-panel-design.md`), `CanonPanel.tsx` (Project 1's shared component) cannot render P3 content — it's hardcoded to `PROJECT1_STAGES` and its only production usage drops per-element badges. Build a new, P3-specific `WorldSidePanel.tsx` instead. Extract the one genuinely duplicated piece (the four-status badge color map, currently copy-pasted in both `CanonPanel.tsx` and `WorldInterview.tsx`) into a shared module both files import, satisfying the issue's actual reuse intent without forcing reuse of a component that can't generalize.

**Tech Stack:** Next.js API routes (already exist, read-only for this issue), React component (`WorldInterview.tsx`), Tailwind CSS (existing dark-theme conventions), no new Firestore writes.

## Global Constraints

- No new server-side code and no new Firestore writes — this issue is entirely read-only display. The existing `GET /api/world-chat/entries` endpoint (`web/src/app/api/world-chat/entries/route.ts:121-144`) already returns everything needed.
- Outstanding Questions have no dedicated store and must not get one — aggregate by flattening `entries[].value.outstandingQuestions` client-side, per `docs/superpowers/specs/2026-09-10-world-entry-model-design.md`'s Open Follow-up note (pre-resolved: "#45 aggregates by listing all entries and flattening their own `outstandingQuestions` arrays").
- The Dependency Graph section is a simple list only — full graph visualization is issue #53 (explicit Phase 5 stretch), out of scope here.
- Reuse `isValidTransition()` (`web/src/lib/canonEngine/transitions.ts`) if any status-derived logic needs it; do not reimplement the state machine. (This panel is read-only, so this constraint mainly guards against scope creep into adding edit controls — don't add any; editing continues to happen through chat.)
- The `Deferred ⟷ Parked` wire-vocabulary convention is already established (`character-chat/route.ts`, `world-chat/canon-status/route.ts`, `WorldInterview.tsx`'s pillars panel) — the API already returns `"Deferred"` (via `toApiEntry`), so no translation is needed in this panel; just display the label as received.
- A failed entries fetch must show an inline, non-blocking error inside the panel — never a page-level error, and never block the chat interview itself. Matches the established "the model's turn always completes even if a side concern fails" philosophy from issues #39/#40/#43.
- Follow this codebase's existing fetch convention exactly: plain `fetch(url)` with no explicit `credentials`/`Authorization` options (session auth is a same-origin cookie, handled server-side by `requireUser()`) — see `WorldInterview.tsx:82` for the precedent.

---

### Task 1: Extract the shared canon status badge color map

**Files:**
- Create: `web/src/lib/canonEngine/statusBadge.ts`
- Modify: `web/src/components/CanonPanel.tsx`
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Produces: `CanonBadgeStatus` (type: `"Exploring" | "Working" | "Confirmed" | "Parked" | "Deferred"`) and `CANON_STATUS_BADGE_STYLES: Record<CanonBadgeStatus, string>`, both exported from `web/src/lib/canonEngine/statusBadge.ts`. Task 2 imports `CANON_STATUS_BADGE_STYLES` and `CanonBadgeStatus` from this module.

This is a pure refactor — no behavior change in either existing file. Do this first so Task 2 has one place to import badge styling from.

- [ ] **Step 1: Create the shared module**

Create `web/src/lib/canonEngine/statusBadge.ts`:

```ts
/**
 * Shared canon-status badge color map (issue #45) - previously duplicated
 * verbatim, un-exported, in both CanonPanel.tsx (Project 1) and
 * WorldInterview.tsx's pillars panel (Project 3, issue #41). Both statuses
 * "Parked" and "Deferred" render identically - "Parked" is CanonElement's
 * internal CanonStatus value; "Deferred" is the author-facing label used
 * at the P2/P3 API boundary (character-chat/route.ts, world-chat/canon-
 * status/route.ts) - this map covers both spellings so either convention
 * can import it directly without a translation step.
 */
export type CanonBadgeStatus = "Exploring" | "Working" | "Confirmed" | "Parked" | "Deferred";

export const CANON_STATUS_BADGE_STYLES: Record<CanonBadgeStatus, string> = {
  Exploring: "bg-neutral-700 text-neutral-300",
  Working: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  Confirmed: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  Parked: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
  Deferred: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
};
```

- [ ] **Step 2: Point `CanonPanel.tsx` at the shared module**

Find the private `STATUS_STYLES` constant in `web/src/components/CanonPanel.tsx` (it's typed `Record<PanelElement["status"], string>` where `PanelElement["status"]` is `"Exploring" | "Working" | "Confirmed" | "Parked"` and has these exact 4 entries). Delete that local constant and its type, add the import:

```ts
import { CANON_STATUS_BADGE_STYLES } from "@/lib/canonEngine/statusBadge";
```

Replace every reference to the deleted local `STATUS_STYLES` with `CANON_STATUS_BADGE_STYLES` (same key lookups work unchanged — `CANON_STATUS_BADGE_STYLES["Exploring"]` etc. return identical strings to before, since Step 1 copied the values verbatim).

- [ ] **Step 3: Point `WorldInterview.tsx`'s pillars panel at the shared module**

Find the private `STATUS_BADGE_STYLES` constant and the `PillarStatus` type in `web/src/components/WorldInterview.tsx` (typed `Record<PillarStatus, string>` where `PillarStatus` is `"Exploring" | "Working" | "Confirmed" | "Deferred"`). Delete the local `STATUS_BADGE_STYLES` constant (keep the `PillarStatus` type itself if other code in the file uses it for something beyond just badge coloring — check before deleting the type, only delete the color-map constant). Add the import:

```ts
import { CANON_STATUS_BADGE_STYLES } from "@/lib/canonEngine/statusBadge";
```

Replace every reference to the deleted local `STATUS_BADGE_STYLES` with `CANON_STATUS_BADGE_STYLES` (values are identical, including the `Deferred` entry).

- [ ] **Step 4: Verify no behavior change**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. Then manually diff-check (via `git diff`) that the only changes in `CanonPanel.tsx` and `WorldInterview.tsx` are the deleted local constants/types and the added import + reference swaps — no other line should differ. This is a zero-behavior-change refactor; any other diff is a mistake.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/canonEngine/statusBadge.ts web/src/components/CanonPanel.tsx web/src/components/WorldInterview.tsx
git commit -m "refactor: extract shared canon status badge color map (issue #45)"
```

---

### Task 2: Build the `WorldSidePanel` component

**Files:**
- Create: `web/src/components/WorldSidePanel.tsx`

**Interfaces:**
- Consumes: `CANON_STATUS_BADGE_STYLES`, `CanonBadgeStatus` from `@/lib/canonEngine/statusBadge` (Task 1). `WORLD_STAGE_NAMES` from `@/lib/worldEngine/worldTurnSchema` (already exists: `Record<number, string>` mapping 1-5 to stage names). The existing `GET /api/world-chat/entries?storyId=<id>` endpoint, response shape `{ entries: ApiWorldEntry[] }` where each entry is:
  ```ts
  {
    entryId: string;
    status: "Exploring" | "Working" | "Confirmed" | "Deferred";
    value: {
      name: string;
      category: string;
      narrativeRole: string;
      importance: "Critical" | "Major" | "Supporting" | "Minor" | "Incidental";
      depth: 1 | 2 | 3 | 4 | 5;
      functionalDescription: string;
      governingRules: string;
      outstandingQuestions: { item: string; notes: string }[];
    };
    dependsOn: string[];
  }
  ```
  (This exact shape comes from `toApiEntry()` in `web/src/lib/worldEngine/worldEntryStore.ts:24-31` combined with `WorldEntryValue` in `web/src/lib/worldEngine/worldEntry.ts:22-31` — read both files if any field name is unclear, don't guess.)
- Produces: `export default function WorldSidePanel(props: WorldSidePanelProps)` with:
  ```ts
  export interface WorldSidePanelProps {
    storyId: string | null;
    currentStage: number | null;
    activePillar: string | null;
    refreshToken: number;
  }
  ```
  Task 3 renders `<WorldSidePanel storyId={...} currentStage={...} activePillar={...} refreshToken={...} />` inside `WorldInterview.tsx`.

- [ ] **Step 1: Scaffold the component with fetch logic**

Create `web/src/components/WorldSidePanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { CANON_STATUS_BADGE_STYLES, type CanonBadgeStatus } from "@/lib/canonEngine/statusBadge";
import { WORLD_STAGE_NAMES } from "@/lib/worldEngine/worldTurnSchema";

interface ApiWorldEntryValue {
  name: string;
  category: string;
  narrativeRole: string;
  importance: string;
  depth: number;
  functionalDescription: string;
  governingRules: string;
  outstandingQuestions: { item: string; notes: string }[];
}

interface ApiWorldEntry {
  entryId: string;
  status: CanonBadgeStatus;
  value: ApiWorldEntryValue;
  dependsOn: string[];
}

export interface WorldSidePanelProps {
  storyId: string | null;
  currentStage: number | null;
  activePillar: string | null;
  refreshToken: number;
}

export default function WorldSidePanel({ storyId, currentStage, activePillar, refreshToken }: WorldSidePanelProps) {
  const [entries, setEntries] = useState<ApiWorldEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadEntries() {
    if (!storyId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/world-chat/entries?storyId=${encodeURIComponent(storyId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load the Canon Registry.");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setLoadError("Couldn't load the Canon Registry — try refreshing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, refreshToken]);

  const entriesById = new Map(entries.map((e) => [e.entryId, e]));
  const outstandingQuestions = entries.flatMap((e) =>
    e.value.outstandingQuestions.map((q) => ({ entryName: e.value.name, item: q.item, notes: q.notes }))
  );
  const entriesWithDeps = entries.filter((e) => e.dependsOn.length > 0);

  return (
    <div
      data-testid="world-side-panel"
      className="mb-6 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-950/40 to-neutral-900/40 px-5 py-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <p className="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-xs font-bold uppercase tracking-widest text-transparent">
          World Bible Registry
        </p>
        <button
          onClick={loadEntries}
          disabled={loading}
          className="rounded-lg border border-red-500/50 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-red-200 disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-[11px] text-neutral-400">
        <span>
          Stage: <span className="text-neutral-200">{currentStage ? `${currentStage} · ${WORLD_STAGE_NAMES[currentStage] ?? "—"}` : "—"}</span>
        </span>
        <span>
          Active Pillar: <span className="text-neutral-200">{activePillar ?? "(none yet)"}</span>
        </span>
      </div>

      {loadError && <p className="mb-3 text-[11px] text-red-400">{loadError}</p>}

      <div className="mb-4">
        <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">Canon Registry</p>
        {entries.length === 0 ? (
          <p className="text-xs text-neutral-500">No World Entries yet — they'll appear here as you develop each pillar.</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((e) => (
              <li key={e.entryId} className="flex items-center justify-between gap-2 text-xs text-neutral-300">
                <span className="truncate">
                  {e.value.name} <span className="text-neutral-500">({e.value.category})</span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CANON_STATUS_BADGE_STYLES[e.status]}`}>
                  {e.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4">
        <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">Outstanding Questions</p>
        {outstandingQuestions.length === 0 ? (
          <p className="text-xs text-neutral-500">No outstanding questions right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {outstandingQuestions.map((q, i) => (
              <li key={i} className="text-xs text-neutral-300">
                <span className="font-semibold text-neutral-200">{q.entryName}:</span> {q.item}
                {q.notes && <span className="text-neutral-500"> — {q.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {entriesWithDeps.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
            Dependency Graph (list view — full graph visualization is a future enhancement)
          </p>
          <ul className="space-y-1.5">
            {entriesWithDeps.map((e) => (
              <li key={e.entryId} className="text-xs text-neutral-300">
                <span className="font-semibold text-neutral-200">{e.value.name}</span> depends on:{" "}
                {e.dependsOn.map((depId) => entriesById.get(depId)?.value.name ?? depId).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds standalone**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean. This component isn't rendered anywhere yet (Task 3 wires it in), so a clean build here only confirms the file itself is syntactically and type-correct in isolation — Task 3's own build check is what confirms it renders correctly in context.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/WorldSidePanel.tsx
git commit -m "feat: add WorldSidePanel component for the Canon Registry, Outstanding Questions, and Dependency Graph list (issue #45)"
```

---

### Task 3: Wire `WorldSidePanel` into `WorldInterview.tsx`

**Files:**
- Modify: `web/src/components/WorldInterview.tsx`

**Interfaces:**
- Consumes: `WorldSidePanel` default export and `WorldSidePanelProps` from `@/components/WorldSidePanel` (Task 2). This file already has `canvasId: string | null` (from `searchParams.get("canvasId")`, line 55), `currentStage: number | null` (component state, set from each turn's `current_stage`), `wclState: P3State | null` (component state; `P3State.activePillar: string | null` already exists per issue #43), and `messages` (component state array, one entry appended per completed turn).

- [ ] **Step 1: Add the import**

In `web/src/components/WorldInterview.tsx`, add near the other local imports:

```ts
import WorldSidePanel from "@/components/WorldSidePanel";
```

- [ ] **Step 2: Render it above the pillars panel**

Find the pillars-panel block (starts at `web/src/components/WorldInterview.tsx:596`, `{!resuming && wclState && (`). Immediately before that block, inside the same `<div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">` scroll container (starts at line 588), insert:

```tsx
                {!resuming && (
                  <WorldSidePanel
                    storyId={canvasId}
                    currentStage={currentStage}
                    activePillar={wclState?.activePillar ?? null}
                    refreshToken={messages.length}
                  />
                )}

```

(Guard on `!resuming` the same way the pillars panel already does — no point fetching the registry while the session is still resuming its history. Do NOT also guard on `wclState` the way the pillars panel does — the side panel should render before pillars/WCL are even set, since Stage/entries can exist independently of pillar-list confirmation timing; `WorldSidePanel` itself already handles `activePillar={null}`/`currentStage={null}` gracefully with its own "—"/"(none yet)" fallbacks.)

- [ ] **Step 3: Verify in the browser**

Start the dev server (`npm run dev` from `web/`), open the World Bible interview for an existing test story that has at least one World Entry (if none exists, use the direct API — `POST /api/world-chat/entries` — or the chat itself, to create one first). Confirm:
- The new panel renders above the pillars panel, showing Stage/Active Pillar and the entry in the Canon Registry list with a status badge.
- The "Refresh" button re-fetches without erroring.
- Sending a chat message that creates or updates an entry causes the panel to reflect the change after the turn completes (since `messages.length` bumps on every turn).
- With zero World Entries, the empty-state text renders instead of an empty list.
- Temporarily break the fetch (e.g. point at a bad storyId in devtools, or stop the dev server briefly) to confirm the inline error message renders instead of a crash, and that the chat itself keeps working.

- [ ] **Step 4: Run lint and build**

Run `npm run lint` and `npm run build` from `web/`. Both must be clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/WorldInterview.tsx
git commit -m "feat: render WorldSidePanel in the World Bible interview (issue #45)"
```
