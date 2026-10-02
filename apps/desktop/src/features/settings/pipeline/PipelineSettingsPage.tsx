import type { AgentRole, ModelKey, RoleAssignment } from '@itstudio/schemas';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { SettingsFeedback, SettingsHeading, useSettingsSave } from '../settings-form';

const ROLES = ['pm', 'coder', 'reviewer'] as const satisfies readonly AgentRole[];

export function PipelineSettingsPage() {
  const { t } = useTranslation();
  const settings = useRpcQuery('settings.get', {});
  const models = useRpcQuery('models.list', {});
  const form = useSettingsSave();
  const [draft, setDraft] = useState<RoleAssignment | null>(null);
  const assignment = draft ?? settings.data?.pipeline.roleAssignment;
  function toggle(role: (typeof ROLES)[number], key: ModelKey, selected: boolean): void {
    if (assignment === undefined) return;
    const values = assignment[role];
    const next = selected ? [...values, key] : values.filter((item) => item !== key);
    setDraft({ ...assignment, [role]: next });
  }
  function move(role: (typeof ROLES)[number], index: number, delta: number): void {
    if (assignment === undefined) return;
    const values = [...assignment[role]];
    const target = index + delta;
    if (target < 0 || target >= values.length) return;
    const [item] = values.splice(index, 1);
    if (item !== undefined) values.splice(target, 0, item);
    setDraft({ ...assignment, [role]: values });
  }
  const valid = assignment !== undefined && ROLES.every((role) => assignment[role].length > 0);
  return (
    <section aria-labelledby="settings-heading" className="max-w-3xl space-y-5">
      <SettingsHeading section="pipeline" />
      {assignment !== undefined ? (
        <div className="space-y-5">
          {ROLES.map((role) => (
            <fieldset className="space-y-2 rounded border border-border bg-surface p-4" key={role}>
              <legend className="px-2 font-semibold">{t(`settings.pipeline.roles.${role}`)}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(models.data ?? []).map((model) => (
                  <label className="flex items-center gap-2" key={model.key}>
                    <input
                      checked={assignment[role].includes(model.key)}
                      disabled={form.saving}
                      onChange={(event) => {
                        toggle(role, model.key, event.target.checked);
                      }}
                      type="checkbox"
                    />
                    {model.displayName}
                  </label>
                ))}
              </div>
              <ol className="space-y-1">
                {assignment[role].map((key, index) => (
                  <li className="flex items-center gap-2 text-sm" key={key}>
                    <span className="flex-1">
                      {index + 1}. {models.data?.find((model) => model.key === key)?.displayName ?? key}
                    </span>
                    <button
                      aria-label={t('settings.pipeline.moveUp')}
                      className="rounded border border-border px-2"
                      disabled={index === 0 || form.saving}
                      onClick={() => {
                        move(role, index, -1);
                      }}
                      type="button"
                    >
                      ↑
                    </button>
                    <button
                      aria-label={t('settings.pipeline.moveDown')}
                      className="rounded border border-border px-2"
                      disabled={index === assignment[role].length - 1 || form.saving}
                      onClick={() => {
                        move(role, index, 1);
                      }}
                      type="button"
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ol>
            </fieldset>
          ))}
          <p className="text-sm text-text-muted">{t('settings.pipeline.validationCommands')}</p>
          <pre className="overflow-auto rounded border border-border bg-surface p-3 text-xs">
            {JSON.stringify(settings.data?.pipeline.validationCommands ?? [], null, 2)}
          </pre>
          <p className="text-sm text-text-muted">{t('settings.pipeline.editLater')}</p>
          <p>{t('settings.pipeline.maxFix', { count: settings.data?.pipeline.maxFixAttempts ?? 1 })}</p>
          <button
            className="rounded bg-primary px-4 py-2 text-primary-fg disabled:opacity-50"
            disabled={!valid || form.saving}
            onClick={() => {
              void form.save({ pipeline: { roleAssignment: assignment } });
            }}
            type="button"
          >
            {t('settings.save')}
          </button>
        </div>
      ) : (
        <p role="status">{t('settings.loading')}</p>
      )}
      <SettingsFeedback failure={form.failure} saved={form.saved} />
    </section>
  );
}
