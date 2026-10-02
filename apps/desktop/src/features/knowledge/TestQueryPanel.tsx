import type { AppError, ProjectId, RetrievalHit } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';
import { RpcCallError } from '../../rpc/rpc-client';
import { useRpcClient } from '../../rpc/rpc-context';

export function TestQueryPanel({
  projectId,
  defaultTopK,
  minScore,
  onReindexAll,
}: {
  readonly projectId: ProjectId | null;
  readonly defaultTopK: number;
  readonly minScore: number;
  readonly onReindexAll: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState<number | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [hits, setHits] = useState<readonly RetrievalHit[]>([]);
  const [error, setError] = useState<AppError | null>(null);
  const [mismatch, setMismatch] = useState(false);
  async function search(): Promise<void> {
    if (projectId === null || query.trim() === '') return;
    setError(null);
    setMismatch(false);
    try {
      setHits(
        await rpc.call('rag.query', {
          projectId,
          query: query.trim(),
          topK: Math.max(1, Math.min(20, topK ?? defaultTopK)),
          minScore: Math.max(0, Math.min(1, score ?? minScore)),
        }),
      );
    } catch (cause: unknown) {
      const appError =
        cause instanceof RpcCallError
          ? cause.appError
          : {
              code: 'INTERNAL' as const,
              message: t('knowledge.queryError'),
              remediation: [t('knowledge.retry')],
              retryable: true,
            };
      setError(appError);
      setMismatch(appError.code === 'VALIDATION');
    }
  }
  return (
    <section className="space-y-3 rounded border border-border p-4" aria-labelledby="knowledge-query-heading">
      <h2 className="font-semibold" id="knowledge-query-heading">
        {t('knowledge.testQuery')}
      </h2>
      <label className="block text-sm" htmlFor="knowledge-query">
        {t('knowledge.query')}
      </label>
      <textarea
        className="w-full rounded border border-border bg-bg p-2"
        disabled={projectId === null}
        id="knowledge-query"
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        value={query}
      />
      <div className="flex flex-wrap gap-4">
        <label>
          {t('knowledge.topK')}
          <input
            className="ml-2 w-20 rounded border border-border bg-bg p-1"
            max={20}
            min={1}
            onChange={(event) => {
              setTopK(Number(event.target.value));
            }}
            type="number"
            value={topK ?? defaultTopK}
          />
        </label>
        <label>
          {t('knowledge.minScore')}
          <input
            className="ml-2 w-24 rounded border border-border bg-bg p-1"
            max={1}
            min={0}
            onChange={(event) => {
              setScore(Number(event.target.value));
            }}
            step={0.01}
            type="number"
            value={score ?? minScore}
          />
        </label>
      </div>
      <button
        className="rounded border border-border px-3 py-2 disabled:opacity-50"
        disabled={projectId === null || query.trim() === ''}
        onClick={() => {
          void search();
        }}
        type="button"
      >
        {t('knowledge.search')}
      </button>
      {error !== null ? <ErrorPanel error={error} /> : null}
      {mismatch ? (
        <div role="status">
          <p>{t('knowledge.reindexRequired')}</p>
          <button className="underline" onClick={onReindexAll} type="button">
            {t('knowledge.reindexAll')}
          </button>
        </div>
      ) : null}
      <ol className="space-y-3">
        {hits.map((hit, index) => (
          <li className="rounded border border-border p-3" key={hit.chunkId}>
            <p className="font-medium">
              {index + 1}. {hit.documentTitle} › {hit.sectionPath.join(' › ')} · {hit.score.toFixed(2)}
            </p>
            <p className="whitespace-pre-wrap">{hit.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
