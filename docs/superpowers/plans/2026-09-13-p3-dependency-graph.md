# P3 Dependency Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement GitHub issue #53 — upgrade the World Bible's "Dependency Graph" side-panel section from a flat list to an interactive visual graph, with the list retained as a fallback.

**Architecture:** A new pure layout module computes a deterministic tiered (layered) position for each dependency-connected entry from the existing `dependsOn` data — no physics simulation, no new API route. A new `DependencyGraphView` component renders those positions via `@xyflow/react` (a new, first-of-its-kind visualization dependency for this codebase). `WorldSidePanel.tsx` gets a List/Graph toggle and a click-to-scroll-and-highlight interaction against its own existing Canon Registry list (there being no separate "entry detail" view anywhere in this codebase to navigate to instead).

**Tech Stack:** `@xyflow/react` (new dependency, pinned to its latest stable major version at implementation time), React/Next.js (existing).

## Global Constraints

- Full design spec: `docs/superpowers/specs/2026-09-13-p3-dependency-graph-design.md` — consult it for the reasoning behind every decision below.
- Layout is a deterministic tiered computation from dependency topology (Decision 3) — never a force-directed simulation. Same input always produces the same output.
- A dependency cycle must never cause an infinite loop or hang — the layout function must terminate on any input, including cyclic `dependsOn` graphs (Decision 3, Testing section).
- Nodes are colored via the existing `CANON_STATUS_BADGE_STYLES` map (`@/lib/canonEngine/statusBadge`) — never a second, new color convention for the same statuses (Decision 4).
- Only entries connected to at least one dependency edge (as source or target) become graph nodes (Decision 5) — matches the existing list view's own scope (`entriesWithDeps`).
- The existing List view must remain byte-for-byte functionally unchanged, available via a toggle (Decision 2) — this issue is additive to `WorldSidePanel.tsx`, never a replacement of its existing rendering.
- Clicking a graph node scrolls to and briefly highlights the corresponding entry's row in the existing Canon Registry list (Decision 6) — there is no separate entry-detail view to navigate to instead; do not invent one, that's out of this issue's scope.
- This is a UI-heavy, visually interactive feature (unlike issues #49-52's mostly server-logic/document-generation work) — per this session's standing instruction, real browser verification (starting the dev server and actually exercising the feature) is expected wherever practical, with any gap clearly and honestly disclosed rather than silently skipped.
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, regardless of which underlying model implements the task — a fixed session-wide convention, not self-attribution.
- No automated test framework exists in this repo — verification is `npm run lint && npm run build` from `web/`, plus `tsx` trace scripts and real browser interaction where practical.

---

### Task 1: Layout algorithm and graph view component

**Files:**
- Modify: `web/package.json` (add `@xyflow/react` dependency)
- Create: `web/src/lib/worldEngine/dependencyGraphLayout.ts`
- Create: `web/src/components/DependencyGraphView.tsx`

**Interfaces:**
- Consumes: `CANON_STATUS_BADGE_STYLES`/`CanonBadgeStatus` (`@/lib/canonEngine/statusBadge`).
- Produces: `DependencyGraphNode { id: string; name: string; status: CanonBadgeStatus }`, `DependencyGraphEdge { from: string; to: string }`, `computeDependencyGraphLayout(nodes, edges): LayoutNode[]`, `DependencyGraphView` component with props `{ nodes: DependencyGraphNode[]; edges: DependencyGraphEdge[]; onNodeClick: (entryId: string) => void }`. Task 2's `WorldSidePanel.tsx` builds `DependencyGraphNode[]`/`DependencyGraphEdge[]` from its existing `entries` state and renders `DependencyGraphView`.

- [ ] **Step 1: Add the `@xyflow/react` dependency**

Run from `web/`:

```bash
npm install @xyflow/react
```

Confirm it lands in `dependencies` (not `devDependencies`) in `web/package.json` — it renders in the browser, matching how `docx`/`@react-pdf/renderer` are already listed as real dependencies, not dev-only.

- [ ] **Step 2: Create the layout module**

Create `web/src/lib/worldEngine/dependencyGraphLayout.ts`:

```ts
import type { CanonBadgeStatus } from "@/lib/canonEngine/statusBadge";

/**
 * Deterministic tiered (layered) layout for the World Bible's dependency
 * graph visualization (issue #53) - not a force-directed simulation
 * (design spec Decision 3): every entry's tier is 1 + the max tier of
 * whatever it depends on (0 if it depends on nothing, or nothing in the
 * graph's own node set), so later tiers visually read as "depends on
 * earlier tiers" - a stable, single-pass computation that always
 * produces the same layout for the same input, with no animation or
 * continuous re-layout needed.
 */

export interface DependencyGraphNode {
  id: string;
  name: string;
  status: CanonBadgeStatus;
}

export interface DependencyGraphEdge {
  /** The entry that HAS the dependency. */
  from: string;
  /** The entry it depends ON. */
  to: string;
}

export interface LayoutNode extends DependencyGraphNode {
  x: number;
  y: number;
}

const TIER_SPACING_X = 220;
const NODE_SPACING_Y = 90;

export function computeDependencyGraphLayout(
  nodes: DependencyGraphNode[],
  edges: DependencyGraphEdge[]
): LayoutNode[] {
  const nodeIds = nodes.map((n) => n.id);
  const nodeIdSet = new Set(nodeIds);

  const depsOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeIdSet.has(e.from) || !nodeIdSet.has(e.to)) continue;
    const list = depsOf.get(e.from) ?? [];
    list.push(e.to);
    depsOf.set(e.from, list);
  }

  const tiers = new Map<string, number>();
  const visiting = new Set<string>();

  function tierOf(id: string): number {
    if (tiers.has(id)) return tiers.get(id) as number;
    if (visiting.has(id)) return 0; // cycle guard: break the recursion for this path without caching a wrong value
    visiting.add(id);
    const deps = depsOf.get(id) ?? [];
    const t = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(tierOf));
    visiting.delete(id);
    tiers.set(id, t);
    return t;
  }

  for (const id of nodeIds) tierOf(id);

  const byTier = new Map<number, string[]>();
  for (const id of nodeIds) {
    const t = tiers.get(id) ?? 0;
    const list = byTier.get(t) ?? [];
    list.push(id);
    byTier.set(t, list);
  }

  const positionById = new Map<string, { x: number; y: number }>();
  for (const [tier, ids] of byTier) {
    ids.forEach((id, i) => {
      positionById.set(id, { x: tier * TIER_SPACING_X, y: i * NODE_SPACING_Y });
    });
  }

  return nodes.map((n) => ({ ...n, ...(positionById.get(n.id) ?? { x: 0, y: 0 }) }));
}
```

- [ ] **Step 3: Create the graph view component**

Create `web/src/components/DependencyGraphView.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CANON_STATUS_BADGE_STYLES } from "@/lib/canonEngine/statusBadge";
import {
  computeDependencyGraphLayout,
  type DependencyGraphNode,
  type DependencyGraphEdge,
} from "@/lib/worldEngine/dependencyGraphLayout";

export interface DependencyGraphViewProps {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
  onNodeClick: (entryId: string) => void;
}

export default function DependencyGraphView({ nodes, edges, onNodeClick }: DependencyGraphViewProps) {
  const { flowNodes, flowEdges } = useMemo(() => {
    const laidOut = computeDependencyGraphLayout(nodes, edges);
    const flowNodes: Node[] = laidOut.map((n) => ({
      id: n.id,
      position: { x: n.x, y: n.y },
      data: { label: n.name },
      className: `rounded-lg border px-3 py-2 text-xs font-semibold ${CANON_STATUS_BADGE_STYLES[n.status]}`,
    }));
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const flowEdges: Edge[] = edges
      .filter((e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to))
      .map((e) => ({ id: `${e.from}->${e.to}`, source: e.from, target: e.to }));
    return { flowNodes, flowEdges };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return <p className="text-xs text-neutral-500">No dependencies recorded yet.</p>;
  }

  return (
    <div style={{ height: 240 }} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodeClick={(_, node) => onNodeClick(node.id)}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#404040" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

Trace `computeDependencyGraphLayout` with a `tsx` script against these constructed graphs (pure function, no React/rendering needed for this part):
1. A linear chain: nodes A, B, C; edges `A→B`, `B→C` (A depends on B, B depends on C). Confirm tiers: C=0, B=1, A=2 (i.e. `x` coordinates `0, 220, 440` respectively).
2. A diamond: nodes A, B, C, D; edges `A→B`, `A→D`, `B→C`, `D→C`. Confirm C=0, B=1, D=1, A=2 — B and D share a tier (same `x`), stacked at different `y`.
3. A cycle: nodes A, B; edges `A→B`, `B→A`. Confirm the function **returns without hanging** and both nodes get *some* deterministic tier (don't assert a specific "correct" tier for a cycle — there isn't one — just assert termination and that both nodes appear in the result with numeric `x`/`y`).
4. A disconnected pair: nodes A, B, with no edges between them. Confirm both get tier 0 (same `x`, different `y` since they're both in `byTier.get(0)`).

For the component itself, since it renders via `@xyflow/react` (a real DOM/browser-oriented library), do not attempt a Node-only `tsx` trace of the JSX — instead, follow this task's Step 5's real-browser verification, or (if a real dev server + browser session isn't practical for this specific sub-step) at minimum confirm via `npm run build` that the component compiles and is included in the client bundle without error, and read through the code once more to confirm props/types line up with Step 2's exports.

- [ ] **Step 5: Real browser check (best-effort, disclose clearly if not fully practical in this sandbox)**

Start the dev server (`npm run dev` from `web/`) and attempt to view `DependencyGraphView` rendering real, non-trivial layout output — e.g. by temporarily adding a throwaway test route/page (delete before committing) that renders `<DependencyGraphView nodes={...} edges={...} onNodeClick={() => {}} />` with a constructed diamond-shaped graph (matching Step 4's scenario 2), and using whatever screenshot/browser-automation tool is available in this environment to confirm: 4 visibly distinct, correctly colored/labeled nodes appear, arranged in the expected tiered columns, with edges connecting them, and pan/zoom controls are visible and interactive. If no such tool is available in this sandbox, say so plainly in your report and rely on Step 4's algorithmic trace plus the clean build as your evidence instead — do not fabricate a browser session you didn't actually run.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/worldEngine/dependencyGraphLayout.ts web/src/components/DependencyGraphView.tsx
git commit -m "feat: add dependency graph layout algorithm and view component (issue #53)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.

---

### Task 2: Wire the graph into `WorldSidePanel.tsx`

**Files:**
- Modify: `web/src/components/WorldSidePanel.tsx`

**Interfaces:**
- Consumes: `DependencyGraphView`, `DependencyGraphNode`, `DependencyGraphEdge` (Task 1).

The current "Dependency Graph" section (the file's bottom-most `<div>`, currently rendering only the list) gets: a List/Graph toggle, a `DependencyGraphView` render path built from the same `entries`/`entriesWithDeps` data already computed in this file, and a click-to-scroll-and-highlight handler wired against the existing Canon Registry `<ul>` above it.

- [ ] **Step 1: Add imports and state**

Add to the file's existing imports:

```ts
import DependencyGraphView from "./DependencyGraphView";
import type { DependencyGraphNode, DependencyGraphEdge } from "@/lib/worldEngine/dependencyGraphLayout";
```

Add state near the existing `entries`/`loadError`/`loading` state:

```ts
  const [graphView, setGraphView] = useState(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const entryRefs = useRef<Map<string, HTMLLIElement>>(new Map());
```

- [ ] **Step 2: Attach refs and a highlight class to the Canon Registry list items**

Find the Canon Registry `<ul>` (the file's first list, rendering `entries.map((e) => ...)`). Add a `ref` callback and a conditional highlight class to each `<li>`:

```tsx
              <li
                key={e.entryId}
                ref={(el) => {
                  if (el) entryRefs.current.set(e.entryId, el);
                  else entryRefs.current.delete(e.entryId);
                }}
                className={`flex items-center justify-between gap-2 rounded px-1 text-xs text-neutral-300 transition-colors duration-500 ${
                  highlightedEntryId === e.entryId ? "bg-red-500/20" : ""
                }`}
              >
```

(This replaces the existing `<li key={e.entryId} className="flex items-center justify-between gap-2 text-xs text-neutral-300">` line — read the actual current line first and adapt precisely, keeping everything inside the `<li>` unchanged.)

- [ ] **Step 3: Add the click handler**

Add near the existing `loadEntries` function:

```ts
  function handleNodeClick(entryId: string) {
    entryRefs.current.get(entryId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedEntryId(entryId);
    setTimeout(() => {
      setHighlightedEntryId((cur) => (cur === entryId ? null : cur));
    }, 1500);
  }
```

- [ ] **Step 4: Build the graph's node/edge arrays**

Add near the existing `entriesById`/`entriesWithDeps` derivations:

```ts
  const graphNodeIds = new Set<string>();
  for (const e of entriesWithDeps) {
    graphNodeIds.add(e.entryId);
    for (const depId of e.dependsOn ?? []) graphNodeIds.add(depId);
  }
  const graphNodes: DependencyGraphNode[] = Array.from(graphNodeIds)
    .map((id) => entriesById.get(id))
    .filter((e): e is ApiWorldEntry => e !== undefined)
    .map((e) => ({ id: e.entryId, name: e.value.name, status: e.status }));
  const graphEdges: DependencyGraphEdge[] = entriesWithDeps.flatMap((e) =>
    (e.dependsOn ?? []).map((depId) => ({ from: e.entryId, to: depId }))
  );
```

(A `dependsOn` id pointing to an entry not present in `entries` at all — e.g. a stale reference — is safely dropped by the `.filter((e): e is ApiWorldEntry => e !== undefined)` step, since a graph needs a real, positioned node and can't render one for an id with no backing entry. This differs slightly from the existing list view's own fallback-to-raw-id text for the same case, which is fine — the list view remains available via the toggle and still shows that raw id.)

- [ ] **Step 5: Replace the Dependency Graph section's rendering**

Find the file's existing bottom section:

```tsx
      <div>
        <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">
          Dependency Graph (list view — full graph visualization is a future enhancement)
        </p>
        {entriesWithDeps.length === 0 ? (
          <p className="text-xs text-neutral-500">No dependencies recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {entriesWithDeps.map((e) => (
              <li key={e.entryId} className="text-xs text-neutral-300">
                <span className="font-semibold text-neutral-200">{e.value.name}</span> depends on:{" "}
                {(e.dependsOn ?? []).map((depId) => entriesById.get(depId)?.value.name ?? depId).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </div>
```

Replace it with:

```tsx
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-widest text-neutral-500">Dependency Graph</p>
          {entriesWithDeps.length > 0 && (
            <div className="flex gap-1">
              <button
                onClick={() => setGraphView(false)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  !graphView ? "bg-red-500/20 text-red-200" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                List
              </button>
              <button
                onClick={() => setGraphView(true)}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  graphView ? "bg-red-500/20 text-red-200" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Graph
              </button>
            </div>
          )}
        </div>
        {entriesWithDeps.length === 0 ? (
          <p className="text-xs text-neutral-500">No dependencies recorded yet.</p>
        ) : graphView ? (
          <DependencyGraphView nodes={graphNodes} edges={graphEdges} onNodeClick={handleNodeClick} />
        ) : (
          <ul className="space-y-1.5">
            {entriesWithDeps.map((e) => (
              <li key={e.entryId} className="text-xs text-neutral-300">
                <span className="font-semibold text-neutral-200">{e.value.name}</span> depends on:{" "}
                {(e.dependsOn ?? []).map((depId) => entriesById.get(depId)?.value.name ?? depId).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 6: Verify**

Run `npm run lint` and `npm run build` from `web/` — both must be clean.

For real browser verification (per this issue's Global Constraint — this is the task where the full interactive flow becomes visible in the actual app UI): start the dev server and, using whatever browser-automation/screenshot tool is available in this sandbox, mock the `/api/world-chat/entries` response (the same network-mock approach every prior UI task in this session has used, since there's no Firestore emulator/test credentials available) to return several entries with `dependsOn` relationships, load `WorldInterview.tsx`'s page, confirm: (a) the List view renders exactly as it did before this change; (b) clicking "Graph" switches to the graph view showing correctly colored/labeled nodes and edges; (c) clicking a node scrolls the Canon Registry list to and briefly highlights the corresponding entry; (d) clicking "List" switches back. If a full browser session isn't practical in this sandbox, disclose exactly what you verified instead (code reading, the compiled bundle, `tsx`-traced logic for `handleNodeClick`'s ref/timeout behavior) and what remains unverified — do not fabricate a browser test you didn't run.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/WorldSidePanel.tsx
git commit -m "feat: wire dependency graph view into the World Bible side panel (issue #53)"
```

Include the trailer `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` in the commit body.
