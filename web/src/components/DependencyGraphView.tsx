"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, MarkerType, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CANON_STATUS_NODE_STYLES } from "@/lib/canonEngine/statusBadge";
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
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      style: {
        ...CANON_STATUS_NODE_STYLES[n.status],
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11,
        fontWeight: 600,
      },
    }));
    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const flowEdges: Edge[] = edges
      .filter((e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to))
      .map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#a3a3a3" },
      }));
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
        fitViewOptions={{ minZoom: 0.1 }}
        preventScrolling={false}
      >
        <Background color="#404040" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
