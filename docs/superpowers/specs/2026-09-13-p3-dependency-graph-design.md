# P3 Dependency Graph Visualization — Design Spec

**Status:** Approved for planning
**Date:** 2026-09-13

## Problem

GitHub issue #53 (P3 Phase 5 — Stretch, lowest priority in the P3 backlog). `WorldSidePanel.tsx`'s existing "Dependency Graph" section is a flat, non-interactive list (its own label literally says "list view — full graph visualization is a future enhancement"). AC: dependency relationships render as an interactive/visual graph; clicking a node navigates to the linked entry; the list view remains available as a fallback.

Two things confirmed by research, both load-bearing for scope:
1. **No graph/diagram library, no canvas/SVG data-visualization precedent, and no click-to-navigate pattern exists anywhere in this codebase.** This issue establishes all three for the first time in the repo.
2. **There is no existing "entry detail" view to navigate to.** The Canon Registry section above the dependency list is itself just a flat `<li>` list with no click handler, no expand, no selected-entry state. So AC #2 ("navigate to a linked entry") has no pre-existing destination — the most honest, minimally-scoped interpretation is "clicking a graph node scrolls to and highlights that entry's row in the existing Canon Registry list," not "open a new detail page" (which doesn't exist and isn't asked for by this issue).

## Decisions

1. **Use a purpose-built graph library (`@xyflow/react`, formerly React Flow) rather than hand-rolling SVG/canvas layout and interaction from scratch.** This is a stretch/lowest-priority feature — hand-rolling force-directed layout, drag, pan/zoom, and click hit-testing is disproportionate effort for a nice-to-have, and this codebase has zero precedent to build on for any of it. `@xyflow/react` is the de facto standard for exactly this shape of problem (declarative node/edge arrays in), is MIT-licensed, actively maintained, and its API (`<ReactFlow nodes={...} edges={...} onNodeClick={...}>`) fits this app's existing React/Next.js conventions directly — no custom layout math needed for a first version (its built-in automatic layout, or a simple deterministic grid/tier layout computed from the dependency graph's topology, is sufficient; see Decision 3). This is a new dependency, which is otherwise avoided in this codebase (ARCHITECTURE.md's general minimalism), but the alternative (hand-rolled layout/interaction code with zero test coverage in a repo with no test framework) is a worse risk for a feature explicitly marked lowest-priority.
2. **A toggle switches the existing dependency section between "List" (unchanged, exactly what's there today) and "Graph" (new)** — directly satisfying AC #3. Both views read the exact same `entries`/`dependsOn` data already fetched by `WorldSidePanel.tsx`; no new API route, no new data fetch.
3. **Layout is computed deterministically from the dependency graph's own topology (a simple tiered/layered layout: entries with no unresolved dependencies at tier 0, each entry's tier = 1 + max(dependency tiers)), not a physics-based force simulation.** A force simulation would need continuous re-computation/animation and is overkill for what's realistically a small number of entries per story; a deterministic tiered layout is stable (same input always produces the same layout, easy to verify/test), computes in one pass, and visually communicates the dependency direction naturally (later tiers depend on earlier ones) — arguably more informative than a force layout for this specific use case (understanding what depends on what, not just that things are related).
4. **Nodes are colored by canon status, reusing `CANON_STATUS_BADGE_STYLES`'s existing color convention** (already used by the Canon Registry list in the same panel) — Confirmed/Working/Exploring/Deferred each keep their already-established color meaning, rather than introducing a second, competing color language for the same statuses in the same panel.
5. **Only entries connected to at least one dependency edge (as source or target) appear as graph nodes** — matching the existing list view's own scope (`entriesWithDeps`, plus the entries they point to). An entry with zero dependency involvement adds no information to a *dependency* graph and would just be visual clutter; it's still fully visible in the Canon Registry list above.
6. **Clicking a node scrolls to and briefly highlights that entry's `<li>` in the Canon Registry list** (Decision 2's "no existing detail view to navigate to" finding) — implemented via a `ref` per Canon Registry list item (keyed by `entryId`) and a CSS-transition highlight class toggled briefly on click, matching this codebase's existing pattern of small, timed UI feedback (e.g. `setTimeout(() => URL.revokeObjectURL(url), 0)` in `download.ts`, though this uses a slightly longer timeout for visibility, ~1.5s).
7. **The library's CSS is imported once, scoped to not leak Tailwind/dark-theme conflicts** — `@xyflow/react`'s default styling needs its own stylesheet import (`@xyflow/react/dist/style.css`) and a small set of CSS custom-property overrides to match this app's dark neutral-950/red-orange-emerald palette rather than the library's default light theme, since this is the first non-Tailwind visual library in the codebase.

## Architecture

### `web/package.json` (extended)

New dependency: `@xyflow/react` (latest stable, exact version pinned at implementation time — this is a real, non-dev dependency since it renders in the browser).

### New component `web/src/components/DependencyGraphView.tsx`

```tsx
"use client";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

interface DependencyGraphViewProps {
  entries: ApiWorldEntry[]; // same shape WorldSidePanel.tsx already has
  onNodeClick: (entryId: string) => void;
}

export default function DependencyGraphView({ entries, onNodeClick }: DependencyGraphViewProps) {
  // 1. Filter to entries connected to >=1 dependency edge (Decision 5).
  // 2. Compute each node's tier via topological pass over dependsOn (Decision 3).
  // 3. Build Node[]/Edge[] arrays: node.data.label = entry name, node
  //    style/className derived from CANON_STATUS_BADGE_STYLES (Decision 4).
  // 4. Render <ReactFlow nodes={...} edges={...} onNodeClick={(e, node) => onNodeClick(node.id)} fitView>
  //    with <Background/> and <Controls/> for pan/zoom (built-in).
}
```

### `web/src/components/WorldSidePanel.tsx` (extended)

- New state: `graphView: boolean` (toggle), a `Map<string, HTMLLIElement>`-backed ref collection for the Canon Registry list items (keyed by `entryId`), and a `highlightedEntryId: string | null` for the brief post-click highlight.
- The existing "Dependency Graph" section gets a small List/Graph toggle control next to its label; renders either the existing `<ul>` (List, unchanged) or `<DependencyGraphView entries={entriesWithDeps-plus-their-targets} onNodeClick={handleNodeClick}>` (Graph).
- `handleNodeClick(entryId)`: scrolls the corresponding Canon Registry `<li>` into view (`scrollIntoView({ behavior: "smooth", block: "center" })`) and sets `highlightedEntryId` briefly (cleared via `setTimeout`, ~1.5s) to drive a CSS highlight class on that `<li>`.

## Error Handling

No new failure modes — the graph is a pure client-side rendering of already-fetched data (`WorldSidePanel.tsx`'s existing `entries` state, already has its own load-error handling). If `@xyflow/react` itself throws on some malformed input (shouldn't happen given the data is fully controlled/typed), the existing List view remains available via the toggle as a fallback, satisfying AC #3's intent even in a degraded case.

## Testing

No automated test framework exists in this repo. Verification is `npm run lint && npm run build`, plus:
- A `tsx` trace of the tiered-layout computation against constructed dependency graphs: a linear chain (A→B→C), a diamond (A→B→C, A→D→C), a cycle (A→B→A — must not infinite-loop; cyclic entries should degrade to some stable tier assignment rather than hanging), and a disconnected pair.
- **Real browser verification is required for this issue specifically** (unlike issues #49-52, which were server-logic/document-generation heavy) — per this session's own standing instruction to test UI changes in an actual running dev server before reporting completion. This means: start `npm run dev`, sign in / reach a Story Canvas with some World Entries and dependencies (or seed a minimal test story), toggle to Graph view, confirm nodes/edges render, click a node, confirm the Canon Registry list scrolls to and highlights the right entry, toggle back to List view and confirm it still renders exactly as before.
