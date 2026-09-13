"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type CanonBadgeStatus } from "@/lib/canonEngine/statusBadge";
import {
  computeDependencyGraphLayout,
  type DependencyGraphNode,
  type DependencyGraphEdge,
} from "@/lib/worldEngine/dependencyGraphLayout";

// @xyflow/react/dist/style.css's own `.react-flow__node-default` rule and
// Tailwind's utility classes are both single-class-specificity selectors,
// so whichever stylesheet loads later in the bundle wins the cascade - and
// it was winning over the Tailwind status-color classes (issue #53 follow-
// up), leaving every node plain white/black regardless of status. Inline
// styles always beat stylesheet rules regardless of load order or
// specificity, so node coloring is expressed here instead of via className.
const NODE_STATUS_STYLE: Record<CanonBadgeStatus, React.CSSProperties> = {
  Exploring: { background: "#404040", color: "#d4d4d4", border: "1px solid #525252" },
  Working: { background: "rgba(245, 158, 11, 0.2)", color: "#fcd34d", border: "1px solid rgba(245, 158, 11, 0.4)" },
  Confirmed: { background: "rgba(16, 185, 129, 0.2)", color: "#6ee7b7", border: "1px solid rgba(16, 185, 129, 0.4)" },
  Parked: { background: "rgba(14, 165, 233, 0.2)", color: "#7dd3fc", border: "1px solid rgba(14, 165, 233, 0.4)" },
  Deferred: { background: "rgba(14, 165, 233, 0.2)", color: "#7dd3fc", border: "1px solid rgba(14, 165, 233, 0.4)" },
};

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
      style: {
        ...NODE_STATUS_STYLE[n.status],
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11,
        fontWeight: 600,
      },
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
