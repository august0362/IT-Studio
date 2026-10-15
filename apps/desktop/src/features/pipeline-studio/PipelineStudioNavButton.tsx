import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function PipelineStudioNavButton({ onOpen }: { readonly onOpen: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="mt-2 w-full rounded border border-border px-3 py-2 text-left text-sm hover:bg-surface-alt focus-visible:outline-2 focus-visible:outline-focus-ring"
      onClick={onOpen}
    >
      {t('nav.pipelineStudio')}
    </button>
  );
}
