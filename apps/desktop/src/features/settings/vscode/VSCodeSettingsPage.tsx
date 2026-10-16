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
              id="vscode-auto-launch"
              checked={value.autoLaunch}
              disabled={form.saving}
              onChange={(event) => void form.save({ vscode: { autoLaunch: event.target.checked } })}
              type="checkbox"
            />
            {t('settings.vscode.autoLaunch')}
          </label>
          {(
            [
              [
                'closeWithStudio',
                'Close VS Code when IT Studio quits',
                'Closes project windows launched by IT Studio on a normal exit.',
              ],
              [
                'closeWithProject',
                'Close VS Code when a project closes',
                'Closes the related windows when you close its tab or delete the project.',
              ],
              [
                'closeManuallyOpened',
                'Also close VS Code windows I opened myself for that project',
                'Includes connected windows with the same project folder.',
              ],
            ] as const
          ).map(([key, label, explanation]) => (
            <label key={key} className="flex items-start gap-3">
              <input
                type="checkbox"
                disabled={form.saving}
                checked={value[key]}
                onChange={(event) => void form.save({ vscode: { [key]: event.target.checked } })}
              />
              <span>
                {label}
                <span className="block text-sm text-muted">{explanation}</span>
              </span>
            </label>
          ))}
          <p className="text-sm text-muted">
            IT Studio never closes VS Code windows by force; unsaved work prompts as usual. Windows stay open if IT
            Studio crashes or is killed.
          </p>
          <label className="grid gap-1">
            {t('settings.vscode.executable')}
            <input
              id="vscode-executable"
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
              id="vscode-show-diff"
              checked={value.showDiffBeforeValidate}
              disabled={form.saving}
              onChange={(event) => void form.save({ vscode: { showDiffBeforeValidate: event.target.checked } })}
              type="checkbox"
            />
            {t('settings.vscode.showDiff')}
          </label>
          <label className="flex items-center gap-3">
            <input
              id="vscode-reveal"
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
