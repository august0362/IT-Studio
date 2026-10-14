import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import './workflow.css';
import type { ModuleNodeData } from './layout';

const statusColor = {
  idle: 'bg-text-muted',
  active: 'bg-primary',
  error: 'bg-danger',
  disabled: 'bg-border',
} as const;

export function ModuleNode({ data, selected }: NodeProps<Node<ModuleNodeData, 'module'>>): JSX.Element {
  const { t } = useTranslation();
  const { module } = data;
  const active = module.status === 'active';
  const error = module.status === 'error';
  return (
    <article
      aria-label={`${t(module.labelKey)} · ${t(`workflow.status.${module.status}`)}`}
      className={`w-60 rounded-lg border border-border bg-surface p-3 shadow-sm ${active ? 'workflow-node-active' : data.pulsing ? 'workflow-node-pulse' : ''} ${error ? 'ring-2 ring-danger' : ''} ${selected ? 'outline outline-2 outline-focus-ring' : ''}`}
    >
      <Handle
        aria-hidden="true"
        className="!pointer-events-none !border-0 !bg-surface !opacity-0"
        position={Position.Left}
        type="target"
      />
      <h3 className="font-semibold">{t(module.labelKey)}</h3>
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <span aria-hidden="true" className={`size-2 rounded-full ${statusColor[module.status]}`} />
        {t(`workflow.status.${module.status}`)}
      </p>
      <Handle
        aria-hidden="true"
        className="!pointer-events-none !border-0 !bg-surface !opacity-0"
        position={Position.Right}
        type="source"
      />
    </article>
  );
}
