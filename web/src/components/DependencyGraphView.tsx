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
