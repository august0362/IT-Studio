import { IngestStatus, type IngestJob } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';

export function IngestProgress({
  jobs,
  skippedUnchanged,
}: {
  readonly jobs: readonly IngestJob[];
  readonly skippedUnchanged: number;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section aria-label={t('knowledge.progress')} className="space-y-3">
      <h2 className="font-semibold">{t('knowledge.progress')}</h2>
      {jobs.map((job) => {
        const percent =
          job.totalFiles === 0 ? 0 : Math.min(100, Math.round((job.processedFiles / job.totalFiles) * 100));
        const done =
          job.status === IngestStatus.INDEXED ||
          job.status === IngestStatus.FAILED ||
          job.status === IngestStatus.SKIPPED_UNCHANGED;
        return (
          <article className="rounded border border-border p-3" key={job.id}>
            <p>
              {job.paths.join(', ')} · {t(`knowledge.status.${job.status}`)}
            </p>
            <progress
              aria-label={t('knowledge.progressLabel')}
              className="w-full"
              max={100}
              value={done ? 100 : percent}
            />
            <p className="text-sm text-text-muted">
              {t('knowledge.progressCount', { processed: job.processedFiles, total: job.totalFiles })}
            </p>
            {job.status === IngestStatus.FAILED ? (
              <ErrorPanel
                error={
                  job.error ?? {
                    code: 'INTERNAL',
                    message: t('knowledge.ingestFailed'),
                    remediation: [t('knowledge.retry')],
                    retryable: true,
                  }
                }
              />
            ) : null}
          </article>
        );
      })}
      <p role="status">{t('knowledge.skipped', { count: skippedUnchanged })}</p>
    </section>
  );
}
