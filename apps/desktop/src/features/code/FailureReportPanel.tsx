import type { FailureReport } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';

export function FailureReportPanel({ report }: { readonly report: FailureReport }): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="rounded border border-danger p-4">
      <h3 className="font-semibold">{t('code.failure')}</h3>
      <p>{t('code.failureStage', { stage: t(`code.stages.${report.stage}`) })}</p>
      <ErrorPanel error={report.error} />
      <p>{t(report.rolledBack ? 'code.rolledBack' : 'code.notRolledBack')}</p>
      <ol className="list-decimal pl-5">
        {report.nextSteps.map((step, index) => (
          <li key={`${index.toString()}-${step}`}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
