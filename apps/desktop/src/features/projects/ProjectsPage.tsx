import type { AppError, Project, ProjectId } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { RpcCallError } from '../../rpc/rpc-client';
import { useRpcClient } from '../../rpc/rpc-context';

export function ProjectsPage({
  onOpen,
  onDeleted,
  onNew,
}: {
  readonly onOpen: (id: ProjectId) => Promise<void>;
  readonly onDeleted: (id: ProjectId) => void;
  readonly onNew: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const projectsQuery = useRpcQuery('project.list', {});
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const projects = projectsQuery.data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const filtered = projects.filter((project) =>
    `${project.name}\n${project.workspaceRoot}`.toLocaleLowerCase().includes(needle),
  );

  function date(value: string | undefined): JSX.Element | string {
    return value === undefined ? (
      t('projects.never')
    ) : (
      <time dateTime={value} title={value}>
        {new Date(value).toLocaleString(i18n.language)}
      </time>
    );
  }

  async function remove(project: Project): Promise<void> {
    setSelected(null);
    setBusy(true);
    setError(null);
    try {
      await rpc.call('project.delete', { projectId: project.id });
      onDeleted(project.id);
      queryClient.setQueryData<readonly Project[]>(['project.list', {}], (current) =>
        (current ?? []).filter((item) => item.id !== project.id),
      );
      await queryClient.invalidateQueries({ queryKey: ['project.list', {}] });
      await queryClient.invalidateQueries({ queryKey: ['settings.get', {}] });
    } catch (cause: unknown) {
      const appError =
        cause instanceof RpcCallError
          ? cause.appError
          : {
              code: 'INTERNAL' as const,
              message: t('projects.deleteError'),
              retryable: true,
              remediation: [t('projects.tryAgain')],
            };
      setError(appError.code === 'CONFLICT' ? { ...appError, message: t('projects.deleteConflict') } : appError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t('nav.projects')} className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t('nav.projects')}</h1>
        <button className="rounded bg-primary px-3 py-2 text-primary-fg" onClick={onNew} type="button">
          {t('projects.new')}
        </button>
      </header>
      <label className="block">
        {t('projects.search')}
        <input
          className="mt-1 block w-full rounded border border-border bg-surface px-3 py-2"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          type="search"
          value={search}
        />
      </label>
      {error !== null ? <ErrorPanel error={error} /> : null}
      {projectsQuery.isPending ? (
        <p role="status">{t('projects.loading')}</p>
      ) : projectsQuery.isError ? (
        <ErrorPanel error={projectsQuery.error.appError} />
      ) : projects.length === 0 ? (
        <p>{t('projects.empty')}</p>
      ) : filtered.length === 0 ? (
        <p>{t('projects.noMatches')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                {[
                  t('projects.name'),
                  t('projects.folder'),
                  t('projects.lastOpened'),
                  t('projects.created'),
                  t('projects.actions'),
                ].map((label) => (
                  <th className="p-3" key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => (
                <tr className="border-t border-border" key={project.id}>
                  <th className="p-3" scope="row">
                    {project.name}
                  </th>
                  <td className="p-3">
                    <span className="block max-w-xs truncate" title={project.workspaceRoot}>
                      {project.workspaceRoot}
                    </span>
                  </td>
                  <td className="p-3">{date(project.lastOpenedAt)}</td>
                  <td className="p-3">{date(project.createdAt)}</td>
                  <td className="space-x-2 whitespace-nowrap p-3">
                    <button
                      aria-label={t('projects.openNamed', { name: project.name })}
                      className="rounded border border-border px-3 py-2 disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        void onOpen(project.id);
                      }}
                      type="button"
                    >
                      {t('projects.open')}
                    </button>
                    <button
                      aria-label={t('projects.deleteNamed', { name: project.name })}
                      className="rounded border border-danger px-3 py-2 text-danger disabled:opacity-50"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        setSelected(project);
                      }}
                      type="button"
                    >
                      {t('projects.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        cancelLabel={t('projects.cancel')}
        confirmLabel={t('projects.delete')}
        message={
          selected === null ? '' : t('projects.deleteConfirm', { name: selected.name, path: selected.workspaceRoot })
        }
        onCancel={() => {
          setSelected(null);
        }}
        onConfirm={() => {
          if (selected !== null) void remove(selected);
        }}
        open={selected !== null}
        title={t('projects.deleteTitle')}
        tone="danger"
      />
    </section>
  );
}
