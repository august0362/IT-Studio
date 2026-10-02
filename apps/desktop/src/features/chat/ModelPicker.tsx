import { ModelCapability, type ModelDescriptor, type ModelKey, type RouterConfig } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

export function ModelPicker({
  models,
  value,
  config,
  onChange,
  onLock,
}: {
  readonly models: readonly ModelDescriptor[];
  readonly value: ModelKey | undefined;
  readonly config: RouterConfig | null;
  readonly onChange: (value: ModelKey | undefined) => void;
  readonly onLock: (locked: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const available = models.filter((model) => model.enabled && model.capabilities.includes(ModelCapability.CHAT));
  const grouped = new Map<string, ModelDescriptor[]>();
  for (const model of available) grouped.set(model.provider, [...(grouped.get(model.provider) ?? []), model]);
  const selected = value ?? '';
  const locked = config?.lockedModelKey !== null && config?.lockedModelKey !== undefined;
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="chat-model">
        {t('chat.model')}
      </label>
      <select
        className="rounded border border-border bg-surface px-2 py-1"
        id="chat-model"
        onChange={(event) => {
          onChange(available.find((model) => model.key === event.currentTarget.value)?.key);
        }}
        value={selected}
      >
        <option value="">{t('chat.auto')}</option>
        {[...grouped.entries()].map(([provider, entries]) => (
          <optgroup key={provider} label={provider}>
            {entries.map((model) => (
              <option key={model.key} value={model.key}>
                {model.displayName}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <label className="flex items-center gap-1">
        <input
          checked={locked}
          disabled={value === undefined && !locked}
          onChange={(event) => {
            onLock(event.currentTarget.checked);
          }}
          type="checkbox"
        />
        {locked ? '🔒 ' : ''}
        {t('chat.lock')}
      </label>
    </div>
  );
}
