"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CANON_STATUS_BADGE_STYLES, type CanonBadgeStatus } from "@/lib/canonEngine/statusBadge";
import { WORLD_STAGE_NAMES } from "@/lib/worldEngine/worldTurnSchema";
import type { DependencyGraphNode, DependencyGraphEdge } from "@/lib/worldEngine/dependencyGraphLayout";

// issue #136 finding 1: the @xyflow/react chunk (~494 KB) was loading
// eagerly on every /world-bible visit via a static import, even though
// "Graph" isn't the default view and this is the lowest-priority stretch
// feature in the P3 backlog. Lazy-load it so the cost is deferred to the
// first "Graph" toggle click. ssr:false since react-flow measures the
// DOM and has no meaningful server-rendered output anyway.
const DependencyGraphView = dynamic(() => import("./DependencyGraphView"), { ssr: false });

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

/** A pillar-to-pillar dependency (issue #122) - read from
 * GET /api/world-chat/canon-status, which lists every pillar
 * CanonElement (WORLD_ELEMENTS_COLLECTION) and resolves both its own id
 * and its `depends_on` ids back to display names server-side (mirroring
 * the reverse-lookup pattern that route's PATCH handler already uses for
 * the Dependency Review gate). */
interface ApiPillarDependency {
  elementId: string;
  name: string;
  status: CanonBadgeStatus;
  dependsOn: { elementId: string; name: string }[];
}

export interface WorldSidePanelProps {
  storyId: string | null;
  currentStage: number | null;
  activePillar: string | null;
  refreshToken: number;
}

/** Dedupes a list by `elementId` (issue #136 finding 2, pillar side) -
 * `Array.from(new Set(...))` works for the plain-string `dependsOn` ids
 * entries use, but pillar dependencies carry `{elementId, name}` objects,
 * so this does the equivalent keyed on `elementId`. */
function dedupeByElementId<T extends { elementId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.elementId)) continue;
    seen.add(item.elementId);
    result.push(item);
  }
  return result;
}

export default function WorldSidePanel({ storyId, currentStage, activePillar, refreshToken }: WorldSidePanelProps) {
  const [entries, setEntries] = useState<ApiWorldEntry[]>([]);
  const [pillars, setPillars] = useState<ApiPillarDependency[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [graphView, setGraphView] = useState(false);
  const [pillarGraphView, setPillarGraphView] = useState(false);
  const [highlightedEntryId, setHighlightedEntryId] = useState<string | null>(null);
  const [highlightedPillarId, setHighlightedPillarId] = useState<string | null>(null);
  const entryRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const pillarRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  // Tracks the most recently *started* request, so that whichever call
  // began last always wins regardless of network resolve order or which
  // caller (the mount/refreshToken effect, or the Refresh button) started
  // it - refreshToken bumps twice per turn (once for the optimistic user
  // message, once for the assistant reply), so two requests are routinely
  // in flight at once; without this, a stale first request resolving
  // after the second would silently overwrite fresh data.
  const requestIdRef = useRef(0);

  async function loadEntries() {
    if (!storyId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/world-chat/entries?storyId=${encodeURIComponent(storyId)}`);
      const data = await res.json();
      if (requestId !== requestIdRef.current) return;
      if (!res.ok) throw new Error(data?.error || "Failed to load the Canon Registry.");
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      if (requestId === requestIdRef.current) setLoadError("Couldn't load the Canon Registry — try refreshing.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }

    // Pillar-to-pillar dependencies (issue #122) - a separate read path
    // against WORLD_ELEMENTS_COLLECTION. Kept in its own try/catch so a
    // failure here never blocks the Canon Registry/entries above from
    // loading; it just leaves the Pillar Dependencies section empty,
    // same as "no dependencies recorded yet."
    try {
      const pRes = await fetch(`/api/world-chat/canon-status?storyId=${encodeURIComponent(storyId)}`);
      const pData = await pRes.json();
      if (requestId !== requestIdRef.current) return;
      setPillars(pRes.ok && Array.isArray(pData.pillars) ? pData.pillars : []);
    } catch {
      if (requestId === requestIdRef.current) setPillars([]);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, refreshToken]);

  function handleNodeClick(entryId: string) {
    entryRefs.current.get(entryId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setHighlightedEntryId(entryId);
    setTimeout(() => {
      setHighlightedEntryId((cur) => (cur === entryId ? null : cur));
    }, 1500);
  }

  function handlePillarNodeClick(elementId: string) {
    pillarRefs.current.get(elementId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setHighlightedPillarId(elementId);
    setTimeout(() => {
      setHighlightedPillarId((cur) => (cur === elementId ? null : cur));
    }, 1500);
  }

  const entriesById = useMemo(() => new Map(entries.map((e) => [e.entryId, e])), [entries]);
  const outstandingQuestions = entries.flatMap((e) =>
    (e.value.outstandingQuestions ?? []).map((q) => ({ entryName: e.value.name, item: q.item, notes: q.notes }))
  );

  // issue #136 finding 2: dedupe each entry's dependsOn before building
  // edges, so a duplicated id doesn't produce colliding React keys
  // (`${from}->${to}`) or a redundant "depends on: Y, Y" in the List view.
  const entriesWithDeps = useMemo(
    () =>
      entries
        .map((e) => ({ ...e, dependsOn: Array.from(new Set(e.dependsOn ?? [])) }))
        .filter((e) => e.dependsOn.length > 0),
    [entries]
  );

  // issue #136 finding 5: wrap graphNodes/graphEdges construction in
  // useMemo([entries]) so DependencyGraphView's own internal
  // useMemo([nodes, edges]) sees stable array identities across
  // unrelated WorldSidePanel re-renders (e.g. the highlight-on/off timer)
  // instead of recomputing React Flow's layout and store every time.
  const { graphNodes, graphEdges } = useMemo(() => {
    const byId = new Map(entries.map((e) => [e.entryId, e]));
    const nodeIds = new Set<string>();
    for (const e of entriesWithDeps) {
      nodeIds.add(e.entryId);
      for (const depId of e.dependsOn) nodeIds.add(depId);
    }
    const nodes: DependencyGraphNode[] = Array.from(nodeIds)
      .map((id) => byId.get(id))
      .filter((e): e is ApiWorldEntry => e !== undefined)
      .map((e) => {
        const deduped = Array.from(new Set(e.dependsOn ?? []));
        return {
          id: e.entryId,
          name: e.value.name,
          status: e.status,
          // issue #136 finding 8: flag an entry whose dependsOn targets
          // were all filtered out as stale/missing, so it doesn't render
          // as an unexplained orphan in the graph.
          hasMissingDependency: deduped.some((depId) => !byId.has(depId)),
        };
      });
    const edges: DependencyGraphEdge[] = entriesWithDeps.flatMap((e) =>
      e.dependsOn.map((depId) => ({ from: e.entryId, to: depId }))
    );
    return { graphNodes: nodes, graphEdges: edges };
  }, [entries, entriesWithDeps]);

  // Same dedupe/orphan-flagging treatment for pillar-to-pillar
  // dependencies (issue #122 + #136 findings 2/8, pillar side).
  const pillarsWithDeps = useMemo(
    () =>
      pillars
        .map((p) => ({ ...p, dependsOn: dedupeByElementId(p.dependsOn ?? []) }))
        .filter((p) => p.dependsOn.length > 0),
    [pillars]
  );

  const { pillarGraphNodes, pillarGraphEdges } = useMemo(() => {
    const byId = new Map(pillars.map((p) => [p.elementId, p]));
    const nodeIds = new Set<string>();
    for (const p of pillarsWithDeps) {
      nodeIds.add(p.elementId);
      for (const dep of p.dependsOn) nodeIds.add(dep.elementId);
    }
    const nodes: DependencyGraphNode[] = Array.from(nodeIds)
      .map((id) => byId.get(id))
      .filter((p): p is ApiPillarDependency => p !== undefined)
      .map((p) => {
        const deduped = dedupeByElementId(p.dependsOn ?? []);
        return {
          id: p.elementId,
          name: p.name,
          status: p.status,
          hasMissingDependency: deduped.some((dep) => !byId.has(dep.elementId)),
        };
      });
    const edges: DependencyGraphEdge[] = pillarsWithDeps.flatMap((p) =>
      p.dependsOn.map((dep) => ({ from: p.elementId, to: dep.elementId }))
    );
    return { pillarGraphNodes: nodes, pillarGraphEdges: edges };
  }, [pillars, pillarsWithDeps]);

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
        {entries.length > 0 ? (
          <ul className="space-y-1.5">
            {entries.map((e) => (
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
                <span className="truncate">
                  {e.value.name}{" "}
                  <span className="text-neutral-500">
                    ({e.value.category} · {e.value.importance} · Depth {e.value.depth})
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${CANON_STATUS_BADGE_STYLES[e.status]}`}>
                  {e.status}
                </span>
              </li>
            ))}
          </ul>
        ) : loading ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : loadError ? null : (
          <p className="text-xs text-neutral-500">No World Entries yet — they&apos;ll appear here as you develop each pillar.</p>
        )}
      </div>

      <div className="mb-4">
        <p className="mb-2 text-[11px] uppercase tracking-widest text-neutral-500">Outstanding Questions</p>
        {outstandingQuestions.length === 0 ? (
          <p className="text-xs text-neutral-500">No outstanding questions right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {outstandingQuestions.map((q, i) => (
              <li key={`${q.entryName}-${i}`} className="text-xs text-neutral-300">
                <span className="font-semibold text-neutral-200">{q.entryName}:</span> {q.item}
                {q.notes && <span className="text-neutral-500"> — {q.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-widest text-neutral-500">Dependency Graph</p>
          {entriesWithDeps.length > 0 && (
            <div className="flex gap-1">
              <button
                onClick={() => setGraphView(false)}
                aria-pressed={!graphView}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  !graphView ? "bg-red-500/20 text-red-200" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                List
              </button>
              <button
                onClick={() => setGraphView(true)}
                aria-pressed={graphView}
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
                {e.dependsOn.map((depId) => entriesById.get(depId)?.value.name ?? depId).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          {/* Pillar-to-pillar dependencies (issue #48) were previously
              never surfaced here - this panel is titled "Dependency
              Graph" but, until issue #122, only ever showed entry-to-entry
              cross-references. This section closes that gap. */}
          <p className="text-[11px] uppercase tracking-widest text-neutral-500">Pillar Dependencies</p>
          {pillarsWithDeps.length > 0 && (
            <div className="flex gap-1">
              <button
                onClick={() => setPillarGraphView(false)}
                aria-pressed={!pillarGraphView}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  !pillarGraphView ? "bg-red-500/20 text-red-200" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                List
              </button>
              <button
                onClick={() => setPillarGraphView(true)}
                aria-pressed={pillarGraphView}
                className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                  pillarGraphView ? "bg-red-500/20 text-red-200" : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                Graph
              </button>
            </div>
          )}
        </div>
        {pillarsWithDeps.length === 0 ? (
          <p className="text-xs text-neutral-500">No pillar dependencies recorded yet.</p>
        ) : pillarGraphView ? (
          <DependencyGraphView nodes={pillarGraphNodes} edges={pillarGraphEdges} onNodeClick={handlePillarNodeClick} />
        ) : (
          <ul className="space-y-1.5">
            {pillarsWithDeps.map((p) => (
              <li
                key={p.elementId}
                ref={(el) => {
                  if (el) pillarRefs.current.set(p.elementId, el);
                  else pillarRefs.current.delete(p.elementId);
                }}
                className={`rounded px-1 text-xs text-neutral-300 transition-colors duration-500 ${
                  highlightedPillarId === p.elementId ? "bg-red-500/20" : ""
                }`}
              >
                <span className="font-semibold text-neutral-200">{p.name}</span> depends on:{" "}
                {p.dependsOn.map((dep) => dep.name).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
