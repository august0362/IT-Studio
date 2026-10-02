import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { SettingsFeedback, SettingsHeading, useSettingsSave } from '../settings-form';

export function BudgetSettingsPage() {
  const { t } = useTranslation();
  const settings = useRpcQuery('settings.get', {});
  const form = useSettingsSave();
  const hardStop = settings.data?.budget.hardStop ?? false;
  return (
    <section aria-labelledby="settings-heading" className="max-w-2xl space-y-5">
      <SettingsHeading section="budget" />
      <p className="text-text-muted">{t('settings.budget.description')}</p>
      <label className="flex items-center gap-3">
        <input
          checked={hardStop}
          disabled={form.saving || settings.isLoading}
          onChange={(event) => void form.save({ budget: { hardStop: event.target.checked } })}
          type="checkbox"
        />
        {t('settings.budget.hardStop')}
      </label>
      <p className="rounded border border-warning p-3 text-sm">{t('settings.budget.warning')}</p>
      <a className="text-primary underline" href="#cost">
        {t('settings.budget.limits')}
      </a>
      <SettingsFeedback failure={form.failure} saved={form.saved} />
    </section>
  );
}
