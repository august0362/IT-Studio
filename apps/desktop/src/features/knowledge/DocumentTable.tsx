import type { AppError, IngestJob, ProjectId, SourceDocument } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useRpcClient } from '../../rpc/rpc-context';

function relativeSource(source: string, root: string): string | null {
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  const prefix = `${normalizedRoot}/`;
  if (source.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()))
    return source.slice(prefix.length).replaceAll('\\', '/');
  const windowsPrefix = `${normalizedRoot}\\`;
  return source.toLocaleLowerCase().startsWith(windowsPrefix.toLocaleLowerCase())
    ? source.slice(windowsPrefix.length).replaceAll('\\', '/')
    : null;
}

export function DocumentTable({
  documents,
  projectId,
  workspaceRoot,
  onStarted,
  onChanged,
}: {
  readonly documents: readonly SourceDocument[];
  readonly projectId: ProjectId | null;
  readonly workspaceRoot: string | null;
  readonly onStarted: (job: IngestJob) => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const [selected, setSelected] = useState<SourceDocument | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  async function remove(): Promise<void> {
    if (selected === null) return;
    try {
      await rpc.call('rag.deleteDocument', { documentId: selected.id });
      setSelected(null);
      onChanged();
    } catch {
      setError({
        code: 'INTERNAL',
        message: t('knowledge.deleteError'),
        remediation: [t('knowledge.retry')],
        retryable: true,
      });
    }
  }
  async function reindex(document: SourceDocument): Promise<void> {
    const path = workspaceRoot === null ? null : relativeSource(document.sourcePath, workspaceRoot);
    if (projectId === null || path === null) return;
    try {
      onStarted(await rpc.call('rag.ingest', { projectId, paths: [path], tags: document.tags }));
    } catch {
      setError({
        code: 'INTERNAL',
        message: t('knowledge.reindexError'),
        remediation: [t('knowledge.retry')],
        retryable: true,
      });
    }
  }
  return (
    <section className="space-y-3" aria-labelledby="knowledge-docs-heading">
      <h2 className="font-semibold" id="knowledge-docs-heading">
        {t('knowledge.documents')}
      </h2>
      {error !== null ? (
        <p className="text-danger" role="alert">
          {error.message}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {['title', 'format', 'chunks', 'model', 'date', 'tags', 'actions'].map((item) => (
                <th className="border-b border-border p-2" key={item}>
                  {t(`knowledge.column.${item}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id}>
                <td className="border-b border-border p-2">{document.title}</td>
                <td className="border-b border-border p-2">{document.format}</td>
                <td className="border-b border-border p-2">{document.chunkCount}</td>
                <td className="border-b border-border p-2">{document.embeddingModel}</td>
                <td className="border-b border-border p-2">
                  {new Intl.DateTimeFormat(i18n.language).format(new Date(document.ingestedAt))}
                </td>
                <td className="border-b border-border p-2">{document.tags.join(', ')}</td>
                <td className="space-x-2 border-b border-border p-2">
                  {workspaceRoot !== null && relativeSource(document.sourcePath, workspaceRoot) !== null ? (
                    <button
                      className="underline"
                      onClick={() => {
                        void reindex(document);
                      }}
                      type="button"
                    >
                      {t('knowledge.reindex')}
                    </button>
                  ) : null}
                  <button
                    className="underline text-danger"
                    onClick={() => {
                      setSelected(document);
                    }}
                    type="button"
                  >
                    {t('knowledge.delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {documents.length === 0 ? <p className="text-text-muted">{t('knowledge.noDocuments')}</p> : null}
      <ConfirmDialog
        cancelLabel={t('knowledge.cancel')}
        confirmLabel={t('knowledge.delete')}
        message={t('knowledge.deletePrompt', { title: selected?.title ?? '' })}
        onCancel={() => {
          setSelected(null);
        }}
        onConfirm={() => {
          void remove();
        }}
        open={selected !== null}
        title={t('knowledge.deleteTitle')}
        tone="danger"
      />
    </section>
  );
}
