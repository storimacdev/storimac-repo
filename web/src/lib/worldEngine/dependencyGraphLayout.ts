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
