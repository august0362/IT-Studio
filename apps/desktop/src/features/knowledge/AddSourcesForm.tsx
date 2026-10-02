import type { AppError, IngestJob, ProjectId } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';
import { RpcCallError } from '../../rpc/rpc-client';
import { useRpcClient } from '../../rpc/rpc-context';

export function AddSourcesForm({
  projectId,
  onStarted,
}: {
  readonly projectId: ProjectId | null;
  readonly onStarted: (job: IngestJob) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const [paths, setPaths] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> {
    if (projectId === null) return;
    const sourcePaths = paths
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean);
    if (sourcePaths.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const job = await rpc.call('rag.ingest', {
        projectId,
        paths: sourcePaths,
        ...(tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean).length === 0
          ? {}
          : {
              tags: tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            }),
      });
      onStarted(job);
      setPaths('');
    } catch (cause: unknown) {
      setError(
        cause instanceof RpcCallError
          ? cause.appError
          : {
              code: 'INTERNAL',
              message: t('knowledge.addError'),
              remediation: [t('knowledge.addRemediation')],
              retryable: true,
            },
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded border border-border p-4" aria-labelledby="knowledge-add-heading">
      <h2 className="font-semibold" id="knowledge-add-heading">
        {t('knowledge.addHeading')}
      </h2>
      <label className="block text-sm" htmlFor="knowledge-paths">
        {t('knowledge.paths')}
      </label>
      <textarea
        className="w-full rounded border border-border bg-bg p-2"
        disabled={projectId === null || busy}
        id="knowledge-paths"
        onChange={(event) => {
          setPaths(event.target.value);
        }}
        placeholder={t('knowledge.pathsHint')}
        rows={3}
        value={paths}
      />
      <label className="block text-sm" htmlFor="knowledge-tags">
        {t('knowledge.tags')}
      </label>
      <input
        className="w-full rounded border border-border bg-bg p-2"
        disabled={projectId === null || busy}
        id="knowledge-tags"
        onChange={(event) => {
          setTags(event.target.value);
        }}
        value={tags}
      />
      {projectId === null ? <p role="status">{t('knowledge.pickProject')}</p> : null}
      <button
        className="rounded border border-border px-3 py-2 disabled:opacity-50"
        disabled={projectId === null || busy || paths.trim().length === 0}
        onClick={() => {
          void submit();
        }}
        type="button"
      >
        {t('knowledge.add')}
      </button>
      {error !== null ? <ErrorPanel error={error} /> : null}
    </section>
  );
}
