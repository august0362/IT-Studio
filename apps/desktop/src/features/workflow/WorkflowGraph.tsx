import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { JSX, KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type { WorkflowEdge, WorkflowNode } from '@itstudio/schemas';
import { layoutWorkflow, type ModuleNodeData } from './layout';
import { ModuleNode } from './ModuleNode';

const nodeTypes = { module: ModuleNode };

export function WorkflowGraph({
  nodes,
  edges,
  pulses,
  activeEdges,
  onSelect,
}: {
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly pulses: Readonly<Record<string, number>>;
  readonly activeEdges: Readonly<Record<string, number>>;
  readonly onSelect: (id: WorkflowNode['id']) => void;
}): JSX.Element {
  const pulsingIds = useMemo(() => new Set(Object.keys(pulses)), [pulses]);
  const graph = useMemo(() => layoutWorkflow(nodes, edges, pulsingIds), [nodes, edges, pulsingIds]);
  const flowEdges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        ...edge,
        animated: activeEdges[edge.id] !== undefined,
        style: {
          stroke: activeEdges[edge.id] !== undefined ? 'var(--color-focus-ring)' : 'var(--color-border)',
          strokeWidth: 2,
        },
      })),
    [activeEdges, graph.edges],
  );
  const flowNodes = graph.nodes.map((node): Node<ModuleNodeData, 'module'> => node);
  const wrapper = useRef<HTMLDivElement>(null);
  const api = useReactFlow();
  useEffect(() => {
    void api.fitView({ padding: 0.15 });
  }, [api, graph.nodes.length, graph.edges.length]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!['Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
    const focusable = [...(wrapper.current?.querySelectorAll<HTMLElement>('.react-flow__node') ?? [])];
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Enter' && current >= 0) {
      event.preventDefault();
      const id = focusable[current]?.getAttribute('data-id');
      const node = nodes.find((candidate) => candidate.id === id);
      if (node !== undefined) onSelect(node.id);
      return;
    }
    if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
      event.preventDefault();
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      const next = focusable[(current + delta + focusable.length) % focusable.length];
      next?.focus();
    }
  }

  return (
    <div
      aria-label="Workflow graph"
      className="h-[min(72vh,900px)] min-h-[520px] rounded-lg border border-border bg-bg"
      onKeyDown={handleKeyDown}
      ref={wrapper}
    >
      <ReactFlow
        edges={flowEdges}
        fitView
        nodes={flowNodes}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => {
          onSelect(node.id as WorkflowNode['id']);
        }}
        nodesFocusable
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-border)" />
        <Controls className="!border-border !bg-surface !fill-text" />
      </ReactFlow>
    </div>
  );
}

export function WorkflowGraphProvider(props: Parameters<typeof WorkflowGraph>[0]): JSX.Element {
  return (
    <ReactFlowProvider>
      <WorkflowGraph {...props} />
    </ReactFlowProvider>
  );
}
