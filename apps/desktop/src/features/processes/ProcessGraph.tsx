import {
  BaseEdge,
  getSmoothStepPath,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ProcessModule, ProcessRecord } from '@itstudio/schemas';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { readProcessLayout, saveProcessLayout } from './process-layout';

export interface ProcessPacket {
  readonly id: number;
  readonly from: string;
  readonly to: string;
}
interface ModuleData extends Record<string, unknown> {
  readonly module: ProcessModule;
  readonly onSelect: (id: string) => void;
}
type ProcessNode = Node<ModuleData, 'process'>;
type PacketEdge = Edge<{ readonly packets: readonly ProcessPacket[] }, 'process'>;
export const moduleBadge = (state: ProcessModule['state']): string =>
  ({ done: '✓', failed: '✕', waiting: '?', active: '●', idle: '—', skipped: '—' })[state];
function ModuleNode({ data }: NodeProps<ProcessNode>) {
  const { t } = useTranslation();
  const module = data.module;
  return (
    <div className={`studio-node studio-${module.state}`}>
      <Handle type="target" position={Position.Left} />
      <button
        type="button"
        className="studio-module"
        aria-label={`${module.label} — ${t(`pipelineStudio.states.${module.state}`)}`}
        onClick={(event) => {
          if (event.detail === 0) data.onSelect(module.id);
        }}
      >
        <span className="studio-glyph" aria-hidden="true">
          ◇
        </span>
        <span className="studio-module-name">{module.label}</span>
        <span className="studio-caption">
          {module.output ?? module.input ?? t(`pipelineStudio.states.${module.state}`)}
        </span>
        <span className={`studio-badge studio-${module.state}`} aria-hidden="true">
          {moduleBadge(module.state)}
        </span>
      </button>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
function PacketFlow(props: EdgeProps<PacketEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath(props);
  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} label={props.label} labelX={labelX} labelY={labelY} />
      {props.data?.packets.map((packet) => (
        <circle
          key={packet.id}
          className="studio-packet"
          data-testid="process-packet"
          r="5"
          fill="var(--color-primary)"
        >
          <animateMotion dur="750ms" path={path} fill="freeze" />
        </circle>
      ))}
    </>
  );
}
const nodeTypes = { process: ModuleNode };
const edgeTypes = { process: PacketFlow };
function Graph({
  record,
  packets,
  onSelect,
  fitRevision,
  onCanvasClick,
}: {
  readonly record: ProcessRecord;
  readonly packets: readonly ProcessPacket[];
  readonly onSelect: (id: string) => void;
  readonly onCanvasClick: () => void;
  readonly fitRevision: number;
}) {
  const { t } = useTranslation();
  const [layout, setLayout] = useState(() => readProcessLayout(record.kind));
  const api = useReactFlow<ProcessNode, PacketEdge>();
  useEffect(() => {
    void api.fitView({ padding: 0.15, duration: 0 });
  }, [api, fitRevision, record.modules.length]);
  const nodes = useMemo<ProcessNode[]>(
    () =>
      record.modules.map((module, index) => ({
        id: module.id,
        type: 'process',
        initialWidth: 210,
        initialHeight: 88,
        position: layout[module.id] ?? { x: (index % 5) * 270, y: Math.floor(index / 5) * 200 },
        data: { module, onSelect },
      })),
    [layout, onSelect, record.modules],
  );
  const edges: PacketEdge[] = record.edges.map((edge, index) => {
    const state = record.modules.find((module) => module.id === edge.to)?.state ?? 'idle';
    return {
      id: `${edge.from}:${edge.to}:${String(index)}`,
      source: edge.from,
      target: edge.to,
      type: 'process',
      ...(edge.label === undefined ? {} : { label: edge.label }),
      className: state === 'active' || state === 'waiting' ? 'studio-flowing' : '',
      style: { stroke: `var(--studio-edge-${state === 'skipped' ? 'idle' : state})`, strokeWidth: 3 },
      data: { packets: packets.filter((packet) => packet.from === edge.from && packet.to === edge.to) },
    };
  });
  return (
    <div className="studio-canvas" aria-label={t('processes.canvas')}>
      <ReactFlow<ProcessNode, PacketEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.05}
        maxZoom={2}
        nodesConnectable={false}
        edgesFocusable={false}
        nodesFocusable={false}
        deleteKeyCode={null}
        nodeClickDistance={5}
        proOptions={{ hideAttribution: true }}
        onPaneClick={onCanvasClick}
        onNodeClick={(_event, node) => {
          onSelect(node.id);
        }}
        onNodeDrag={(_event, node) => {
          setLayout((current) => ({ ...current, [node.id]: node.position }));
        }}
        onNodeDragStop={(_event, node) => {
          setLayout((current) => {
            const next = { ...current, [node.id]: node.position };
            saveProcessLayout(record.kind, next);
            return next;
          });
        }}
      />
    </div>
  );
}
export function ProcessGraph(props: Parameters<typeof Graph>[0]) {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
