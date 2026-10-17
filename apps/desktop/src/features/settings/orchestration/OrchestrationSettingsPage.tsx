import type { AppError, OrchRole, OrchestrationSettings } from '@itstudio/schemas';
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { useRpcClient } from '../../../rpc/rpc-context';
import { SettingsFeedback, SettingsHeading } from '../settings-form';

const roleFields = ['supervisor', 'workerA', 'workerB', 'reviewer'] as const;
type RoleField = (typeof roleFields)[number];
const roleFor: Readonly<Record<RoleField, OrchRole>> = {
  supervisor: 'supervisor',
  workerA: 'worker',
  workerB: 'worker',
  reviewer: 'reviewer',
};
const limits = [
  { key: 'maxCostMicroUsd', min: 0, max: 100_000_000, step: 100_000, scale: 1_000_000, label: 'maxCost' },
  { key: 'maxWallClockMs', min: 1, max: 1440, step: 1, scale: 60_000, label: 'wallClock' },
  { key: 'maxAgentCalls', min: 1, max: 1000, step: 1, scale: 1, label: 'agentCalls' },
  { key: 'maxConcurrentWorkers', min: 1, max: 4, step: 1, scale: 1, label: 'concurrentWorkers' },
  { key: 'maxFixRounds', min: 0, max: 3, step: 1, scale: 1, label: 'fixRounds' },
  { key: 'transientRetries', min: 0, max: 2, step: 1, scale: 1, label: 'transientRetries' },
] as const;

export function OrchestrationSettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const settingsQuery = useRpcQuery('settings.get', {});
  const modelsQuery = useRpcQuery('models.list', {});
  const adaptersQuery = useRpcQuery('orch.adapters', {});
  const [value, setValue] = useState<OrchestrationSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<AppError | null>(null);
  const [invalid, setInvalid] = useState(false);
  const current = value ?? settingsQuery.data?.orchestration;
  const models = (modelsQuery.data ?? []).filter((model) => model.capabilities.includes('code') && model.enabled);
  function setRole(field: RoleField, modelKey: string): void {
    const model = models.find((candidate) => candidate.key === modelKey);
    if (model === undefined || current === undefined) return;
    const nextRef = {
      agentId: `${field}:${model.key}`,
      role: roleFor[field],
      transport: 'api' as const,
      providerId: model.provider,
      modelId: model.providerModelId,
    };
    setValue({ ...current, roles: { ...current.roles, [field]: nextRef } });
    setSaved(false);
  }
  function setLimit(key: (typeof limits)[number]['key'], raw: string): void {
    if (current === undefined) return;
    const spec = limits.find((item) => item.key === key);
    if (spec === undefined) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < spec.min || parsed > spec.max) setInvalid(true);
    else setInvalid(false);
    setValue({ ...current, limits: { ...current.limits, [key]: Math.round(parsed * spec.scale) } });
    setSaved(false);
  }
  async function save(): Promise<void> {
    if (current === undefined || invalid) return;
    setSaving(true);
    setSaved(false);
    setFailure(null);
    try {
      const result = await rpc.call('settings.update', { patch: { orchestration: current } });
      setValue(result.orchestration);
      setSaved(true);
    } catch (cause: unknown) {
      setFailure(
        cause instanceof Error
          ? {
              code: 'VALIDATION',
              message: cause.message,
              retryable: false,
              remediation: [t('settings.orchestration.invalid')],
            }
          : { code: 'INTERNAL', message: t('settings.saveError'), retryable: true, remediation: [t('settings.retry')] },
      );
    } finally {
      setSaving(false);
    }
  }
  if (current === undefined) return <p role="status">{t('settings.loading')}</p>;
  return (
    <div className="space-y-5">
      <SettingsHeading section="orchestration" />
      <p className="text-sm text-text-muted">{t('settings.orchestration.description')}</p>
      <fieldset className="space-y-3 rounded border border-border p-4">
        <legend className="px-1 font-semibold">{t('settings.orchestration.roles')}</legend>
        {roleFields.map((field) => (
          <label className="block" key={field}>
            <span className="mb-1 block">{t(`settings.orchestration.${field}`)}</span>
            <select
              className="w-full rounded border border-border bg-surface px-3 py-2"
              value={
                models.find(
                  (model) =>
                    model.provider === current.roles[field].providerId &&
                    model.providerModelId === current.roles[field].modelId,
                )?.key ?? ''
              }
              onChange={(event) => {
                setRole(field, event.target.value);
              }}
            >
              <option value="" disabled>
                {t('settings.orchestration.model')}
              </option>
              {models.map((model) => (
                <option key={model.key} value={model.key}>
                  {model.displayName} · {model.provider}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      <section className="space-y-2 rounded border border-border p-4" aria-labelledby="orch-adapters-heading">
        <h3 id="orch-adapters-heading" className="font-semibold">
          {t('settings.orchestration.adapterStatus')}
        </h3>
        {adaptersQuery.isPending ? (
          <p role="status">{t('settings.orchestration.loadingAdapters')}</p>
        ) : (
          (adaptersQuery.data ?? []).map((adapter) => (
            <p className="flex flex-wrap gap-2" key={adapter.transport}>
              <span>{t(`settings.orchestration.transportNames.${adapter.transport}`)}</span>
              <span>{t(`settings.orchestration.${adapter.status}`)}</span>
              {adapter.version ? (
                <span>
                  {t('settings.orchestration.version')}: {adapter.version}
                </span>
              ) : null}
              {adapter.reason ? (
                <span className="text-text-muted">
                  {t('settings.orchestration.reason')}: {adapter.reason}
                </span>
              ) : null}
            </p>
          ))
        )}
      </section>
      <fieldset className="grid gap-3 rounded border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 font-semibold">{t('settings.orchestration.maxCost')}</legend>
        {limits.map((item) => (
          <label key={item.key} className="block">
            <span className="mb-1 block">{t(`settings.orchestration.${item.label}`)}</span>
            <input
              aria-label={t(`settings.orchestration.${item.label}`)}
              className="w-full rounded border border-border bg-surface px-3 py-2"
              type="number"
              min={item.min}
              max={item.max}
              step={item.step}
              value={current.limits[item.key] / item.scale}
              onChange={(event) => {
                setLimit(item.key, event.target.value);
              }}
            />
          </label>
        ))}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={current.limits.hardStop}
            onChange={(event) => {
              setValue({ ...current, limits: { ...current.limits, hardStop: event.target.checked } });
              setSaved(false);
            }}
          />
          {t('settings.orchestration.hardStop')}
        </label>
      </fieldset>
      {invalid ? (
        <p className="text-danger" role="alert">
          {t('settings.orchestration.invalid')}
        </p>
      ) : null}
      <SettingsFeedback failure={failure} saved={saved} />
      <button
        className="rounded border border-border px-4 py-2 disabled:opacity-50"
        disabled={saving || invalid}
        onClick={() => {
          void save();
        }}
        type="button"
      >
        {t('settings.save')}
      </button>
    </div>
  );
}
