import {
  BaseEdge,
  getSmoothStepPath,
  getViewportForBounds,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { PipelineRun, ProcessModule } from '@itstudio/schemas';
import {
  badge,
  CONNECTIONS,
  defaultPosition,
  MODULES,
  readLayout,
  writeLayout,
  type Layout,
  type ModuleId,
  type ModuleStatus,
} from './studio-model';
import type { Packet } from './useStudioAnimation';

interface ModuleData extends Record<string, unknown> {
  readonly module: ModuleId;
  readonly status: ModuleStatus;
  readonly caption: string;
  readonly pulse: number;
  readonly onSelect: (id: ModuleId) => void;
}
type StudioNode = Node<ModuleData, 'studio'>;
interface FlowData extends Record<string, unknown> {
  readonly packet?: Packet;
}
type StudioEdge = Edge<FlowData, 'studio'>;
const ICONS: Readonly<Record<ModuleId, string>> = {
  request: '↗',
  clarify: '◇',
  spec: '▤',
  code: '⌘',
  review: '◎',
  fix: '⚒',
  're-review': '◎',
  write: '▣',
  validate: '▷',
  done: '✧',
};

function ModuleNode({ data }: NodeProps<StudioNode>): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={`studio-node studio-${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <button
        aria-label={`${t(`pipelineStudio.modules.${data.module}`)} — ${t(`pipelineStudio.states.${data.status}`)}`}
        className="studio-module"
        type="button"
        onClick={(event) => {
          if (event.detail === 0) data.onSelect(data.module);
        }}
      >
        <span className="studio-glyph" aria-hidden="true">
          {ICONS[data.module]}
        </span>
        <span className="studio-module-name">{t(`pipelineStudio.modules.${data.module}`)}</span>
        <span className="studio-caption">{data.caption || t(`pipelineStudio.states.${data.status}`)}</span>
        <span
          className={`studio-badge studio-${data.status}${data.module === 'clarify' ? ' studio-question' : ''}`}
          key={data.status}
          aria-hidden="true"
        >
          {badge(data.module, data.status)}
        </span>
      </button>
      {data.pulse > 0 ? <span className="studio-arrival" key={data.pulse} /> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
function FlowEdge(props: EdgeProps<StudioEdge>): JSX.Element {
  const [path] = getSmoothStepPath(props);
  const packet = props.data?.packet;
  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} />
      {packet === undefined ? null : (
        <circle className="studio-packet" r="5" fill="var(--color-primary)" key={packet.id}>
          <animateMotion dur="750ms" path={path} fill="freeze" />
        </circle>
      )}
    </>
  );
}
const nodeTypes = { studio: ModuleNode };
const edgeTypes = { studio: FlowEdge };
const FIT_OPTIONS = { padding: 0.15, maxZoom: 1.2 };

function Graph({
  run,
  statuses,
  modules,
  packet,
  pulse,
  onSelect,
  onCanvasClick,
  fitRevision,
  resetRevision,
}: {
  readonly run: PipelineRun | undefined;
  readonly statuses: Readonly<Record<ModuleId, ModuleStatus>>;
  readonly modules?: readonly ProcessModule[] | undefined;
  readonly packet: Packet | undefined;
  readonly pulse: { readonly module: ModuleId; readonly id: number } | null;
  readonly onSelect: (id: ModuleId) => void;
  readonly onCanvasClick: () => void;
  readonly fitRevision: number;
  readonly resetRevision: number;
}): JSX.Element {
  const { t } = useTranslation();
  const [layout, setLayout] = useState<Layout>(readLayout);
  const api = useReactFlow<StudioNode, StudioEdge>();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const nodeCount = useStore((state) => state.nodeLookup.size);
  const ids = run === undefined ? MODULES.slice(0, 1) : MODULES;
  const nodes = useMemo<StudioNode[]>(
    () =>
      ids.map((id) => ({
        id,
        type: 'studio',
        initialWidth: 210,
        initialHeight: 88,
        position: layout[id] ?? defaultPosition(id),
        data: {
          module: id,
          status: statuses[id],
          caption: (() => {
            const module = modules?.find((item) => item.id === (id === 're-review' ? 're_review' : id));
            return module?.output ?? module?.input ?? '';
          })(),
          pulse: pulse?.module === id ? pulse.id : 0,
          onSelect,
        },
      })),
    [ids, layout, statuses, modules, pulse, onSelect],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (width <= 0 || height <= 0 || nodeCount !== ids.length) return;
      const bounds = api.getNodesBounds(api.getNodes());
      const viewport = getViewportForBounds(bounds, width, height, 0.15, FIT_OPTIONS.maxZoom, FIT_OPTIONS.padding);
      // Use all registered nodes, including nodes awaiting their first measurement.
      void api.setViewport(viewport, { duration: 0 });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [api, fitRevision, resetRevision, ids.length, nodeCount, width, height]);
  const edges: StudioEdge[] =
    run === undefined
      ? []
      : CONNECTIONS.filter(
          ([from, to]) =>
            (from !== 'spec' ||
              to !== 'clarify' ||
              run.stage === 'clarifying' ||
              (packet?.from === 'spec' && packet.to === 'clarify')) &&
            (from !== 'request' ||
              to !== 'spec' ||
              !run.clarifications?.length ||
              (packet?.from === 'request' && packet.to === 'spec')),
        ).map(([from, to]) => {
          const status = statuses[from] === 'skipped' ? 'skipped' : statuses[to];
          const flowing = status === 'active' || status === 'waiting';
          const glowing = flowing || status === 'done' || status === 'failed';
          const color = `var(--studio-edge-${glowing ? status : 'idle'})`;
          return {
            id: `${from}-${to}`,
            source: from,
            target: to,
            type: 'studio',
            className: flowing ? 'studio-flowing' : '',
            style: {
              stroke: color,
              strokeWidth: glowing ? 3 : 2,
              filter: glowing ? `drop-shadow(0 0 5px ${color})` : undefined,
              strokeDasharray: status === 'skipped' ? '5 7' : undefined,
            },
            data: packet?.from === from && packet.to === to ? { packet } : {},
          };
        });
  return (
    <div className="studio-canvas" aria-label={t('pipelineStudio.canvas')}>
      <ReactFlow<StudioNode, StudioEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.15}
        maxZoom={2}
        nodeClickDistance={5}
        nodesFocusable={false}
        edgesFocusable={false}
        proOptions={{ hideAttribution: true }}
        onPaneClick={onCanvasClick}
        onNodeClick={(_event, node) => {
          onSelect(node.data.module);
        }}
        nodesConnectable={false}
        deleteKeyCode={null}
        onNodeDrag={(_event, node) => {
          setLayout((current) => ({ ...current, [node.id]: node.position }));
        }}
        onNodeDragStop={(_event, node) => {
          setLayout((current) => {
            const next = { ...current, [node.id]: node.position };
            writeLayout(next);
            return next;
          });
        }}
      />
    </div>
  );
}
export function StudioGraph(props: Parameters<typeof Graph>[0]): JSX.Element {
  return (
    <ReactFlowProvider>
      <Graph {...props} />
    </ReactFlowProvider>
  );
}
