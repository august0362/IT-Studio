import type { ReviewVerdict } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeMarkdown } from '../../components/SafeMarkdown';

export function ReviewView({ verdict }: { readonly verdict: ReviewVerdict }): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="space-y-2 rounded border border-border p-4">
      <h3 className="font-semibold">{verdict.approved ? t('code.approved') : t('code.changesRequested')}</h3>
      <SafeMarkdown source={verdict.summary} />
      {verdict.findings.map((finding, index) => (
        <article className="border-t border-border pt-2" key={`${finding.path}-${index.toString()}`}>
          <strong>{t(`code.severity.${finding.severity}`)}</strong> · {finding.path}
          {finding.line === undefined ? '' : `:${finding.line.toString()}`}
          <SafeMarkdown source={finding.message} />
          <SafeMarkdown source={finding.suggestedFix} />
        </article>
      ))}
    </section>
  );
}
