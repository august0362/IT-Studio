import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { JSX, KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowEdge, WorkflowNode } from '@itstudio/schemas';
import { layoutWorkflow, type ModuleNodeData } from './layout';
import { ModuleNode } from './ModuleNode';
import { ActivityEdge, type ActivityFlowEdge } from './ActivityEdge';
import type { WorkflowEdgeAnimation } from './workflow-store';
import './workflow.css';

const nodeTypes = { module: ModuleNode };
const edgeTypes = { activity: ActivityEdge };

function currentReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function WorkflowGraph({
  nodes,
  edges,
  pulses,
  activeEdges,
  edgeAnimations,
  onSelect,
}: {
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly pulses: Readonly<Record<string, number>>;
  readonly activeEdges: Readonly<Record<string, number>>;
  readonly edgeAnimations: readonly WorkflowEdgeAnimation[];
  readonly onSelect: (id: WorkflowNode['id']) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [reducedMotion, setReducedMotion] = useState(currentReducedMotion);
  const pulsingIds = useMemo(() => new Set(Object.keys(pulses)), [pulses]);
  const graph = useMemo(() => layoutWorkflow(nodes, edges, pulsingIds), [nodes, edges, pulsingIds]);
  const flowEdges = useMemo<ActivityFlowEdge[]>(
    () =>
      graph.edges.map((edge): ActivityFlowEdge => {
        const isActive = activeEdges[edge.id] !== undefined;
        return {
          ...edge,
          type: 'activity',
          animated: false,
          data: {
            animations: reducedMotion ? [] : edgeAnimations.filter((animation) => animation.edgeId === edge.id),
            reducedMotion,
          },
          style: { stroke: isActive ? 'var(--color-primary)' : 'var(--color-border)', strokeWidth: 2 },
        };
      }),
    [activeEdges, edgeAnimations, graph.edges, reducedMotion],
  );
  const flowNodes = graph.nodes.map((node): Node<ModuleNodeData, 'module'> => node);
  const wrapper = useRef<HTMLDivElement>(null);
  const api = useReactFlow();
  useEffect(() => {
    void api.fitView({ padding: 0.15 });
  }, [api, graph.nodes.length, graph.edges.length]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = (event: MediaQueryListEvent): void => {
      setReducedMotion(event.matches);
    };
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);

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
      aria-label={t('workflow.graphLabel')}
      className="h-[min(72vh,900px)] min-h-[520px] rounded-lg border border-border bg-bg"
      onKeyDown={handleKeyDown}
      ref={wrapper}
      role="region"
    >
      <ReactFlow
        edges={flowEdges}
        edgeTypes={edgeTypes}
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
        <Controls className="!border-border !bg-surface !fill-text [&_button]:!border-border [&_button]:!bg-surface [&_button]:!text-text [&_button:hover]:!bg-surface-alt" />
        <MiniMap
          ariaLabel={t('workflow.minimapLabel')}
          bgColor="var(--color-surface)"
          className="!border !border-border !bg-surface"
          maskColor="color-mix(in srgb, var(--color-bg) 75%, transparent)"
          maskStrokeColor="var(--color-border)"
          nodeColor="var(--color-surface-alt)"
          nodeStrokeColor="var(--color-border)"
        />
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
