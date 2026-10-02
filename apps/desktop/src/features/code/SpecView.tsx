import type { TaskSpec } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { SafeMarkdown } from '../../components/SafeMarkdown';

export function SpecView({ spec }: { readonly spec: TaskSpec }): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="space-y-2 rounded border border-border p-4">
      <h3 className="font-semibold">{spec.title}</h3>
      <SafeMarkdown source={spec.userStory} />
      {(
        [
          ['criteria', spec.acceptanceCriteria],
          ['paths', spec.allowedPaths],
          ['constraints', spec.constraints],
          ['tests', spec.testPlan],
        ] as const
      ).map(([label, values]) => (
        <div key={label}>
          <h4 className="font-medium">{t(`code.${label}`)}</h4>
          <ul className="list-disc pl-5">
            {values.map((value) => (
              <li key={value}>
                <SafeMarkdown source={value} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {spec.contracts ? <SafeMarkdown source={`\`\`\`ts\n${spec.contracts}\n\`\`\``} /> : null}
    </section>
  );
}
