import type { Node, NodeProps } from '@xyflow/react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';
import type { ModuleNodeData } from './layout';

const statusMark = { idle: '○', active: '◉', error: '!', disabled: '⊘' } as const;

export function ModuleNode({ data, selected }: NodeProps<Node<ModuleNodeData, 'module'>>): JSX.Element {
  const { t } = useTranslation();
  const { module } = data;
  return (
    <article
      aria-label={`${t(module.labelKey)} · ${t(`workflow.status.${module.status}`)}`}
      className={`w-60 rounded-lg border border-border bg-surface p-3 shadow-sm ${data.pulsing ? 'workflow-pulse' : ''} ${selected ? 'outline outline-2 outline-focus-ring' : ''}`}
    >
      <h3 className="font-semibold">{t(module.labelKey)}</h3>
      <p className="text-sm text-text-muted">
        <span aria-hidden="true">{statusMark[module.status]}</span> {t(`workflow.status.${module.status}`)}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-2 text-xs">
        <dt>{t('workflow.inFlight')}</dt>
        <dd>{module.inFlight}</dd>
        <dt>{t('workflow.calls')}</dt>
        <dd>{module.calls24h}</dd>
        <dt>{t('workflow.errors')}</dt>
        <dd>{module.errors24h}</dd>
        <dt>{t('workflow.cost')}</dt>
        <dd>{module.cost24h === undefined ? '—' : <Money compact value={module.cost24h} />}</dd>
      </dl>
    </article>
  );
}
