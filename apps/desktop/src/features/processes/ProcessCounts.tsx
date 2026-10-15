import type { ProcessStatus } from '@itstudio/schemas';
import { useTranslation } from 'react-i18next';
import { useProcesses } from './useProcesses';
import './process-viewer.css';

export function ProcessDot({ status }: { readonly status: ProcessStatus }) {
  return <span aria-hidden="true" className={`process-dot-${status} inline-block h-2 w-2 shrink-0 rounded-full`} />;
}

export function ProcessCounts() {
  const { t } = useTranslation();
  const { records } = useProcesses();
  return (
    <span className="inline-flex gap-2 text-xs" aria-label={t('processes.counts')}>
      {(['running', 'waiting', 'stopped'] as const).map((status) => (
        <span
          key={status}
          className="inline-flex items-center gap-1"
          aria-label={`${t(`processes.status.${status}`)}: ${String(records.filter((record) => record.status === status).length)}`}
        >
          <ProcessDot status={status} />
          <span>{records.filter((record) => record.status === status).length}</span>
        </span>
      ))}
    </span>
  );
}
