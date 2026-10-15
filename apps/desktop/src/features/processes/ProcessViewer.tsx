import type { ProcessModule, ProcessRecord } from '@itstudio/schemas';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { useNotification } from '../../hooks/use-notification';
import { formatDateTime } from '../../i18n/format';
import { SafeMarkdown } from '../../components/SafeMarkdown';
import { ProcessGraph } from './ProcessGraph';
import { saveProcessLayout } from './process-layout';
import { useProcessPackets } from './useProcessPackets';
import './process-viewer.css';

export interface RichProcessPanelProps {
  readonly record: ProcessRecord;
  readonly module: ProcessModule;
  readonly onClose: () => void;
  readonly children: ReactNode;
}
function ModulePanel({ module, onClose, children }: RichProcessPanelProps) {
  const close = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <aside className={`studio-panel-fixed studio-${module.state}`} role="dialog" aria-labelledby="process-module-title">
      <header className="studio-panel-header">
        <h2 id="process-module-title">{module.label}</h2>
        <button ref={close} type="button" aria-label={t('pipelineStudio.close')} onClick={onClose}>
          ×
        </button>
      </header>
      <div className="studio-panel-body space-y-4">{children}</div>
    </aside>
  );
}
export function ProcessViewer({
  initial,
  onBack,
  onOpenRef,
  renderRichPanel,
}: {
  readonly initial: ProcessRecord;
  readonly onBack: () => void;
  readonly onOpenRef: (record: ProcessRecord) => void;
  readonly renderRichPanel?: ((props: RichProcessPanelProps) => ReactNode) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [live, setLive] = useState<ProcessRecord | null>(null);
  const [removed, setRemoved] = useState(false);
  const query = useRpcQuery('process.get', { id: initial.id });
  const record = live ?? query.data ?? initial;
  const [selected, setSelected] = useState<string | null>(null);
  const [fit, setFit] = useState(0);
  const [reset, setReset] = useState(0);
  const animation = useProcessPackets(record);
  const select = useCallback((id: string) => {
    setSelected(id);
  }, []);
  const close = useCallback(() => {
    setSelected(null);
  }, []);
  useNotification('process.event', (event) => {
    if (event.type === 'removed' && event.id === initial.id) setRemoved(true);
    if (event.type === 'upsert' && event.process.id === initial.id) setLive(event.process);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (selected !== null) close();
        else onBack();
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, [close, onBack, selected]);
  const module = record.modules.find((item) => item.id === selected);
  const details =
    module === undefined ? null : (
      <>
        <p>
          {t('pipelineStudio.status')}: {t(`pipelineStudio.states.${module.state}`)}
        </p>
        {module.startedAt ? (
          <p>
            {t('processes.started')}:{' '}
            <time dateTime={module.startedAt}>{formatDateTime(module.startedAt, i18n.language)}</time>
          </p>
        ) : null}
        {module.endedAt ? (
          <p>
            {t('processes.ended')}:{' '}
            <time dateTime={module.endedAt}>{formatDateTime(module.endedAt, i18n.language)}</time>
          </p>
        ) : null}
        <h3>{t('processes.input')}</h3>
        <SafeMarkdown source={module.input ?? '—'} />
        <h3>{t('processes.output')}</h3>
        <SafeMarkdown source={module.output ?? '—'} />
        <dl>
          {Object.entries(module.detail ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt className="font-semibold">{key}</dt>
              <dd className="whitespace-pre-wrap">
                {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              </dd>
            </div>
          ))}
        </dl>
        {record.ref ? (
          <button
            className="rounded border border-border p-2"
            type="button"
            onClick={() => {
              onOpenRef(record);
            }}
          >
            {t(`processes.refs.${record.ref.type}`)}
          </button>
        ) : null}
      </>
    );
  return (
    <section className="studio-root fixed inset-0" style={{ background: 'black' }} aria-label={t('processes.viewer')}>
      <header className="studio-topbar">
        <button type="button" onClick={onBack}>
          {t('pipelineStudio.back')}
        </button>
        <h1>{record.title}</h1>
        <p>
          {t(`processes.kinds.${record.kind}`)} · {t(`processes.status.${record.status}`)} · {record.costText}
        </p>
        <p>{record.statusReason}</p>
        <button
          type="button"
          onClick={() => {
            setFit((value) => value + 1);
          }}
        >
          {t('pipelineStudio.fit')}
        </button>
        <button
          type="button"
          onClick={() => {
            saveProcessLayout(record.kind, {});
            setReset((value) => value + 1);
          }}
        >
          {t('pipelineStudio.reset')}
        </button>
        <button type="button" onClick={animation.replay}>
          {t('pipelineStudio.replay')}
        </button>
      </header>
      {query.error ? (
        <p role="alert" className="studio-alert">
          {query.error.message}
        </p>
      ) : null}
      {removed ? (
        <p role="status">{t('processes.removed')}</p>
      ) : (
        <ProcessGraph
          key={`${record.kind}:${String(reset)}`}
          record={record}
          packets={animation.packets}
          onSelect={select}
          onCanvasClick={close}
          fitRevision={fit}
        />
      )}
      {record.result ? (
        <div className="studio-empty">
          <SafeMarkdown source={record.result} />
        </div>
      ) : null}
      {module
        ? (renderRichPanel?.({ record, module, onClose: close, children: details }) ?? (
            <ModulePanel record={record} module={module} onClose={close}>
              {details}
            </ModulePanel>
          ))
        : null}
    </section>
  );
}
