import { ImageProviderId, ProviderId, type AppError, type ImageSettings } from '@itstudio/schemas';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { useRpcClient } from '../../../rpc/rpc-context';
import { SettingsFeedback, SettingsHeading } from '../settings-form';

const PROVIDERS = [
  { id: ImageProviderId.OPENAI_DALLE3, keyProvider: ProviderId.OPENAI },
  { id: ImageProviderId.FLUX_TOGETHER, keyProvider: ProviderId.TOGETHER },
  { id: ImageProviderId.FLUX_REPLICATE, keyProvider: ProviderId.REPLICATE },
  { id: ImageProviderId.MIDJOURNEY_PROXY, keyProvider: null },
] as const;

function ProviderRow({
  id,
  configured,
}: {
  readonly id: ImageProviderId;
  readonly configured: boolean | null;
}): JSX.Element {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      className={`flex items-center gap-3 rounded border border-border bg-surface p-3 ${isDragging ? 'opacity-50' : ''}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        aria-label={t('settings.images.reorder', { provider: t(`settings.images.providers.${id}`) })}
        className="cursor-grab rounded px-2 py-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
        type="button"
        {...attributes}
        {...listeners}
      >
        ↕
      </button>
      <span className="flex-1">{t(`settings.images.providers.${id}`)}</span>
      {configured === null ? null : (
        <span className="text-sm text-text-muted">
          {t(configured ? 'settings.images.keySet' : 'settings.images.keyMissing')}
        </span>
      )}
    </li>
  );
}

export function ImagesSettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const settings = useRpcQuery('settings.get', {});
  const statuses = useRpcQuery('secrets.status', {});
  const [current, setCurrent] = useState<ImageSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);
  const image = current ?? settings.data?.image;
  async function update(next: ImageSettings): Promise<void> {
    setCurrent(next);
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      await rpc.call('settings.update', { patch: { image: next } });
      setSaved(true);
    } catch {
      setFailure({
        code: 'INTERNAL',
        message: t('settings.saveError'),
        retryable: true,
        remediation: [t('settings.retry')],
      });
    } finally {
      setSaving(false);
    }
  }
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function reorder(event: DragEndEvent): void {
    if (image === undefined || event.over === null || event.active.id === event.over.id) return;
    const from = image.providerOrder.indexOf(String(event.active.id) as ImageProviderId);
    const to = image.providerOrder.indexOf(String(event.over.id) as ImageProviderId);
    if (from < 0 || to < 0) return;
    void update({ ...image, providerOrder: arrayMove([...image.providerOrder], from, to) });
  }
  if (image === undefined) return <p role="status">{t('settings.loading')}</p>;
  const keyStatus = (provider: (typeof PROVIDERS)[number]['keyProvider']): boolean | null => {
    if (provider === null) return null;
    return statuses.data?.find((status) => status.provider === provider)?.configured ?? false;
  };
  return (
    <section aria-labelledby="settings-heading" className="max-w-3xl space-y-5">
      <SettingsHeading section="images" />
      <label className="flex items-center gap-3">
        <input
          aria-label={t('settings.images.enabled')}
          checked={image.enabled}
          disabled={saving}
          onChange={(event) => void update({ ...image, enabled: event.target.checked })}
          type="checkbox"
        />
        {t('settings.images.enabled')}
      </label>
      <p className="text-sm text-text-muted">{t('settings.images.costNote')}</p>
      <p className="text-sm text-text-muted">
        {t('settings.images.apiKeyHint')}{' '}
        <a className="underline" href="#settings-api-keys">
          {t('settings.images.apiKeys')}
        </a>
      </p>
      <h3 className="font-semibold">{t('settings.images.providerOrder')}</h3>
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={reorder}
        sensors={sensors}
        accessibility={{ screenReaderInstructions: { draggable: t('settings.images.keyboardHelp') } }}
      >
        <SortableContext items={[...image.providerOrder]} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {image.providerOrder.map((id) => (
              <ProviderRow
                configured={keyStatus(PROVIDERS.find((provider) => provider.id === id)?.keyProvider ?? null)}
                id={id}
                key={id}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <SettingsFeedback failure={failure} saved={saved} />
    </section>
  );
}
