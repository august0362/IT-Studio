import type { AppError, SettingsPatch } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorPanel } from '../../components/ErrorPanel';
import { RpcCallError } from '../../rpc/rpc-client';
import { useRpcClient } from '../../rpc/rpc-context';

export function useSettingsSave(): {
  readonly saving: boolean;
  readonly failure: AppError | null;
  readonly saved: boolean;
  readonly save: (patch: SettingsPatch) => Promise<void>;
} {
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(patch: SettingsPatch): Promise<void> {
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      const next = await rpc.call('settings.update', { patch });
      cache.setQueryData(['settings.get', {}], next);
      setSaved(true);
    } catch (error: unknown) {
      setFailure(
        error instanceof RpcCallError
          ? error.appError
          : {
              code: 'INTERNAL',
              message: 'Settings could not be saved.',
              retryable: true,
              remediation: ['Check the sidecar connection and try again.'],
            },
      );
    } finally {
      setSaving(false);
    }
  }
  return { saving, failure, saved, save };
}

export function SettingsFeedback({
  failure,
  saved,
}: {
  readonly failure: AppError | null;
  readonly saved: boolean;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (failure !== null) return <ErrorPanel error={failure} />;
  if (saved)
    return (
      <p className="text-sm text-success" role="status">
        {t('settings.saved')}
      </p>
    );
  return null;
}

export function SettingsHeading({ section }: { readonly section: string }): JSX.Element {
  const { t } = useTranslation();
  return (
    <h2 className="text-xl font-semibold" id="settings-heading">
      {t(`settings.nav.${section}`)}
    </h2>
  );
}
