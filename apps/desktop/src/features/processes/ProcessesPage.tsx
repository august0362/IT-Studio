import { ProcessKind, type ProcessId, type ProcessRecord, type Project, type ProjectId } from '@itstudio/schemas';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useTranslation } from 'react-i18next';
import { useRpcClient } from '../../rpc/rpc-context';
import { formatDateTime } from '../../i18n/format';
import { ProcessDot } from './ProcessCounts';
import { useProcesses } from './useProcesses';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/EmptyState';
import { Icon, type IconName } from '../../components/ui/Icon';

const KIND_ICONS: Readonly<Record<ProcessKind, IconName>> = {
  chat: 'chat',
  code_pipeline: 'code',
  knowledge_ingest: 'knowledge',
  image: 'gallery',
  price_update: 'pricing',
  key_verify: 'key',
  vscode_launch: 'open',
  web_chat: 'web',
  orchestration: 'studio',
};
const STATUSES = ['running', 'waiting', 'stopped', 'ended'] as const;
export function ProcessesPage({
  projectId,
  projects,
  initialKind = '',
  onOpen,
}: {
  readonly projectId: ProjectId | null;
  readonly projects: readonly Project[];
  readonly initialKind?: ProcessKind | '';
  readonly onOpen: (record: ProcessRecord) => void;
}) {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const [all, setAll] = useState(projectId === null);
  const query = useProcesses(all ? undefined : (projectId ?? undefined));
  const [kind, setKind] = useState<string>(initialKind);
  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState<readonly string[]>(STATUSES);
  const [busy, setBusy] = useState<ProcessId | null>(null);
  const [deleting, setDeleting] = useState<ProcessRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function action(
    method: 'process.cancel' | 'process.retry' | 'process.dismiss' | 'process.delete',
    id: ProcessId,
  ) {
    setBusy(id);
    setError(null);
    try {
      if (method === 'process.delete') {
        await rpc.call(method, { id });
        await query.applyChange({ type: 'removed', id });
      } else {
        const process = await rpc.call(method, { id });
        await query.applyChange({ type: 'upsert', process });
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('processes.error'));
    } finally {
      setBusy(null);
    }
  }
  const records = query.records.filter(
    (record) =>
      (all || record.projectId === projectId) &&
      (!kind || record.kind === kind) &&
      `${record.title} ${record.statusReason ?? ''} ${projects.find((project) => project.id === record.projectId)?.name ?? ''}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <section className="space-y-5" aria-labelledby="processes-heading">
      <PageHeader
        icon="processes"
        title={t('processes.heading')}
        subtitle={t('character.processes')}
        id="processes-heading"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => {
              setAll(event.target.checked);
            }}
          />{' '}
          {t('processes.allProjects')}
        </label>
        <label>
          {t('processes.kind')}{' '}
          <select
            className="rounded border border-border bg-surface p-2"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
            }}
          >
            <option value="">{t('processes.allKinds')}</option>
            {Object.values(ProcessKind).map((value) => (
              <option key={value} value={value}>
                {t(`processes.kinds.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('processes.search')}{' '}
          <input
            className="rounded border border-border bg-surface p-2"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </label>
        {STATUSES.map((status) => (
          <button
            className="rounded border border-border px-3 py-2"
            type="button"
            key={status}
            aria-pressed={statuses.includes(status)}
            onClick={() => {
              setStatuses((current) =>
                current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
              );
            }}
          >
            {t(`processes.status.${status}`)}
          </button>
        ))}
      </div>
      {query.isLoading ? <p role="status">{t('processes.loading')}</p> : null}
      {error || query.error ? (
        <p role="alert">
          {error ?? query.error?.message}{' '}
          <button
            type="button"
            onClick={() => {
              void query.refetch();
            }}
          >
            {t('processes.refresh')}
          </button>
        </p>
      ) : null}
      {!query.isLoading && !query.error && records.length === 0 ? (
        <EmptyState
          icon="processes"
          description={t('character.noProcesses')}
          action={
            <a className="studio-button studio-button-primary" href="#chat">
              <Icon name="chat" />
              {t('character.openChat')}
            </a>
          }
        />
      ) : null}
      {STATUSES.filter((status) => statuses.includes(status)).map((status) => (
        <section key={status} aria-label={t(`processes.status.${status}`)} className="space-y-2">
          <h2 className="font-semibold">
            {t(`processes.status.${status}`)}
            {status === 'ended' ? ` (${t('processes.newest20')})` : ''}
          </h2>
          <ul className="space-y-2">
            {records
              .filter((record) => record.status === status)
              .map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center gap-4 rounded border border-border bg-surface p-3"
                >
                  <span className="inline-flex items-center gap-2">
                    <ProcessDot status={status} />
                    {t(`processes.status.${status}`)}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Icon name={KIND_ICONS[record.kind]} /> {t(`processes.kinds.${record.kind}`)}
                  </span>
                  <div className="min-w-40 flex-1">
                    <p className="font-medium">{record.title}</p>
                    <p className="text-sm text-text-muted">
                      {projects.find((project) => project.id === record.projectId)?.name ?? t('processes.noProject')}
                    </p>
                    <p>{record.statusReason}</p>
                  </div>
                  <div className="text-xs text-text-muted">
                    <p>
                      {t('processes.started')}:{' '}
                      <time dateTime={record.createdAt}>{formatDateTime(record.createdAt, i18n.language)}</time>
                    </p>
                    <p>
                      {t('processes.updated')}:{' '}
                      <time dateTime={record.updatedAt}>{formatDateTime(record.updatedAt, i18n.language)}</time>
                    </p>
                    <p>{record.costText}</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(record);
                      }}
                    >
                      {t('processes.open')}
                    </button>
                    {status === 'running' || status === 'waiting' ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          void action('process.cancel', record.id);
                        }}
                      >
                        {t('processes.cancel')}
                      </button>
                    ) : null}
                    {status === 'stopped' && record.retryable ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          void action('process.retry', record.id);
                        }}
                      >
                        {t('processes.retry')}
                      </button>
                    ) : null}
                    {status === 'stopped' ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          void action('process.dismiss', record.id);
                        }}
                      >
                        {t('processes.dismiss')}
                      </button>
                    ) : null}
                    {status === 'ended' || status === 'stopped' ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          setDeleting(record);
                        }}
                      >
                        {t('processes.delete')}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
      <ConfirmDialog
        open={deleting !== null}
        title={t('processes.delete')}
        message={t('processes.deleteConfirm', { title: deleting?.title ?? '' })}
        confirmLabel={t('processes.delete')}
        cancelLabel={t('api.cancel')}
        tone="danger"
        onCancel={() => {
          setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting !== null) void action('process.delete', deleting.id);
          setDeleting(null);
        }}
      />
    </section>
  );
}
