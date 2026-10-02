import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { SettingsFeedback, SettingsHeading, useSettingsSave } from '../settings-form';

export function VSCodeSettingsPage() {
  const { t } = useTranslation();
  const settings = useRpcQuery('settings.get', {});
  const form = useSettingsSave();
  const value = settings.data?.vscode;
  return (
    <section aria-labelledby="settings-heading" className="max-w-2xl space-y-5">
      <SettingsHeading section="vscode" />
      {value ? (
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              checked={value.autoLaunch}
              disabled={form.saving}
              onChange={(event) => void form.save({ vscode: { autoLaunch: event.target.checked } })}
              type="checkbox"
            />
            {t('settings.vscode.autoLaunch')}
          </label>
          <label className="grid gap-1">
            {t('settings.vscode.executable')}
            <input
              className="rounded border border-border bg-bg p-2"
              disabled={form.saving}
              onBlur={(event) => {
                const codeExecutable = event.target.value.trim() || null;
                if (codeExecutable !== value.codeExecutable) void form.save({ vscode: { codeExecutable } });
              }}
              defaultValue={value.codeExecutable ?? ''}
              type="text"
            />
          </label>
          <label className="flex items-center gap-3">
            <input
              checked={value.showDiffBeforeValidate}
              disabled={form.saving}
              onChange={(event) => void form.save({ vscode: { showDiffBeforeValidate: event.target.checked } })}
              type="checkbox"
            />
            {t('settings.vscode.showDiff')}
          </label>
          <label className="flex items-center gap-3">
            <input
              checked={value.revealChangedFiles}
              disabled={form.saving}
              onChange={(event) => void form.save({ vscode: { revealChangedFiles: event.target.checked } })}
              type="checkbox"
            />
            {t('settings.vscode.reveal')}
          </label>
        </div>
      ) : (
        <p role="status">{t('settings.loading')}</p>
      )}
      <SettingsFeedback failure={form.failure} saved={form.saved} />
    </section>
  );
}
