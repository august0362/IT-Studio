import type { AppError, IngestJob, Project, ProjectId, SourceDocument } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useMemo, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotification } from '../../hooks/use-notification';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { useRpcClient } from '../../rpc/rpc-context';
import { RpcCallError } from '../../rpc/rpc-client';
import { AddSourcesForm } from './AddSourcesForm';
import { DocumentTable } from './DocumentTable';
import { IngestProgress } from './IngestProgress';
import { ingestReducer, initialIngestState } from './ingest-store';
import { TestQueryPanel } from './TestQueryPanel';

export function KnowledgePage({
  project,
  projectId,
}: {
  readonly project: Project | undefined;
  readonly projectId: ProjectId | null;
}): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const settings = useRpcQuery('settings.get', {});
  const documentsQuery = useRpcQuery(
    'rag.listDocuments',
    { projectId: projectId ?? ('' as ProjectId) },
    { enabled: projectId !== null },
  );
  const [ingest, dispatch] = useReducer(ingestReducer, initialIngestState);
  const documents: readonly SourceDocument[] = documentsQuery.data ?? [];
  const jobs = useMemo(() => Object.values(ingest.jobs), [ingest.jobs]);
  useNotification('rag.progress', (job) => {
    dispatch(job);
    if (['indexed', 'failed', 'skipped_unchanged'].includes(job.status)) {
      void queryClient.invalidateQueries({ queryKey: ['rag.listDocuments', { projectId: job.projectId }] });
    }
  });
  function started(job: IngestJob): void {
    dispatch(job);
    if (['indexed', 'failed', 'skipped_unchanged'].includes(job.status))
      void queryClient.invalidateQueries({ queryKey: ['rag.listDocuments', { projectId: job.projectId }] });
  }
  async function reindexAll(): Promise<void> {
    if (projectId === null) return;
    const paths = documents
      .map((document) => (project?.workspaceRoot ? relativePath(document.sourcePath, project.workspaceRoot) : null))
      .filter((path): path is string => path !== null);
    if (paths.length === 0) return;
    try {
      started(await rpc.call('rag.ingest', { projectId, paths }));
    } catch {
      /* The query panel presents validation failures; progress failures arrive over notifications. */
    }
  }
  const storedError: AppError | null =
    documentsQuery.error instanceof RpcCallError ? documentsQuery.error.appError : null;
  return (
    <section className="space-y-6" aria-label={t('knowledge.heading')}>
      <h1 className="text-xl font-semibold">{t('knowledge.heading')}</h1>
      {projectId === null ? <p role="status">{t('knowledge.pickProject')}</p> : null}
      {storedError !== null ? (
        <p className="text-danger" role="alert">
          {storedError.message}
        </p>
      ) : null}
      <AddSourcesForm onStarted={started} projectId={projectId} />
      <IngestProgress jobs={jobs} skippedUnchanged={ingest.skippedUnchanged} />
      <DocumentTable
        documents={documents}
        onStarted={started}
        onChanged={() => void queryClient.invalidateQueries({ queryKey: ['rag.listDocuments', { projectId }] })}
        projectId={projectId}
        workspaceRoot={project?.workspaceRoot ?? null}
      />
      <TestQueryPanel
        defaultTopK={settings.data?.rag.defaultTopK ?? 5}
        minScore={settings.data?.rag.minScore ?? 0.2}
        onReindexAll={() => {
          void reindexAll();
        }}
        projectId={projectId}
      />
    </section>
  );
}

function relativePath(source: string, root: string): string | null {
  const prefix = `${root.replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}`;
  return source.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? source.slice(prefix.length).replaceAll('\\', '/')
    : null;
}
