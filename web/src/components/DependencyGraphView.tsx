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
      // A trailing "⚠" marks an orphan node whose dependsOn target(s) were
      // filtered out as stale/missing (issue #136 finding 8) - the List
      // view already prints the raw missing id as text, so the graph gets
      // an equivalent (if terser) visual cue rather than silently
      // rendering a disconnected node with no explanation.
      data: { label: n.hasMissingDependency ? `${n.name} ⚠` : n.name },
      sourcePosition: Position.Left,
      targetPosition: Position.Right,
      style: {
        ...CANON_STATUS_NODE_STYLES[n.status],
        ...(n.hasMissingDependency ? { border: "1px dashed #f87171" } : {}),
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11,
        fontWeight: 600,
        maxWidth: 150,
        overflowWrap: "anywhere",
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
        // issue #135: use @xyflow/react's own dark-mode CSS variables
        // (background, selection/hover box-shadow, Controls button
        // colors) instead of fighting its cascade - this also fixes
        // node selection/hover giving no visible feedback, since the
        // library's dark box-shadow values are actually visible against
        // this app's bg-neutral-950 background (the light-mode defaults
        // were not). The per-status node background/color/border above
        // stays as an inline style regardless of colorMode - it encodes
        // canon status, not light/dark theme, so colorMode has no
        // equivalent for it.
        colorMode="dark"
        // issue #136 finding 4: nodes are controlled (no onNodesChange),
        // so a drag was already silently discarded on the next re-render.
        // Layout is deterministic by design - make that explicit instead
        // of letting a node visually "snap back" after a drag.
        nodesDraggable={false}
      >
        <Background color="#404040" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
