import type { Edge, Node } from '@xyflow/react';
import type { WorkflowEdge, WorkflowLane, WorkflowNode } from '@itstudio/schemas';

export interface ModuleNodeData extends Record<string, unknown> {
  readonly module: WorkflowNode;
  readonly pulsing: boolean;
}

const LANES: readonly WorkflowLane[] = ['ui', 'engine', 'data', 'pipeline', 'storage'];
const NODE_WIDTH = 240;
const NODE_HEIGHT = 168;
const COLUMN_GAP = 72;
const ROW_GAP = 112;
const LEFT = 32;
const TOP = 32;

export function layoutWorkflow(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  pulsingIds: ReadonlySet<string> = new Set(),
): { readonly nodes: readonly Node<ModuleNodeData, 'module'>[]; readonly edges: readonly Edge[] } {
  const sorted = [...nodes].sort((left, right) => {
    const laneOrder = LANES.indexOf(left.lane) - LANES.indexOf(right.lane);
    return laneOrder === 0 ? left.id.localeCompare(right.id) : laneOrder;
  });
  const laneCounts = new Map<WorkflowLane, number>();
  const flowNodes = sorted.map((module) => {
    const index = laneCounts.get(module.lane) ?? 0;
    laneCounts.set(module.lane, index + 1);
    const position = {
      x: LEFT + index * (NODE_WIDTH + COLUMN_GAP),
      y: TOP + LANES.indexOf(module.lane) * (NODE_HEIGHT + ROW_GAP),
    };
    const flowNode: Node<ModuleNodeData, 'module'> = {
      id: module.id,
      type: 'module',
      position,
      data: { module, pulsing: pulsingIds.has(module.id) },
    };
    return flowNode;
  });
  const flowEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.contract,
    animated: false,
    style: { stroke: 'var(--color-border)', strokeWidth: 2 },
    labelStyle: { fill: 'var(--color-text-muted)', fontSize: 11 },
    labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.95 },
  }));
  return { nodes: flowNodes, edges: flowEdges };
}

export const workflowLaneOrder = LANES;
