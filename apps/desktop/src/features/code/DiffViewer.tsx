import { DiffEditor } from '@monaco-editor/react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function DiffViewer({
  path,
  before,
  after,
}: {
  readonly path: string;
  readonly before: string;
  readonly after: string;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden rounded border border-border">
      <h4 className="bg-surface-alt p-2">{path}</h4>
      <DiffEditor
        height="280px"
        language={path.endsWith('.json') ? 'json' : path.endsWith('.md') ? 'markdown' : 'typescript'}
        original={before}
        modified={after}
        options={{
          readOnly: true,
          originalEditable: false,
          renderSideBySide: true,
          minimap: { enabled: false },
          ariaLabel: t('code.diff', { path }),
        }}
        theme="itstudio-active"
      />
    </section>
  );
}
