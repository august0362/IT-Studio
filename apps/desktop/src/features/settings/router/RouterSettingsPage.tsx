import type { AppError, LadderEntry, ModelKey, RouterConfig } from '@itstudio/schemas';
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
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { useRpcClient } from '../../../rpc/rpc-context';
import { RpcCallError } from '../../../rpc/rpc-client';
import { SettingsFeedback, SettingsHeading } from '../settings-form';

function LadderRow({
  entry,
  name,
  saving,
  onChange,
}: {
  readonly entry: LadderEntry;
  readonly name: string;
  readonly saving: boolean;
  readonly onChange: (entry: LadderEntry) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.modelKey });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-3 rounded border border-border bg-surface p-3 ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        aria-label={t('settings.router.drag', { name })}
        className="cursor-grab rounded px-2 py-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
        disabled={saving}
        type="button"
        {...attributes}
        {...listeners}
      >
        ↕
      </button>
      <span className="min-w-0 flex-1">{name}</span>
      <label className="flex items-center gap-2">
        <input
          aria-label={t('settings.router.enabled', { name })}
          checked={entry.enabled}
          disabled={saving}
          onChange={(event) => {
            onChange({ ...entry, enabled: event.target.checked });
          }}
          type="checkbox"
        />
        {t('settings.router.enabledLabel')}
      </label>
    </li>
  );
}

export function RouterSettingsPage(): JSX.Element {
  const { t } = useTranslation();
  const rpc = useRpcClient();
  const query = useRpcQuery('router.getConfig', {});
  const models = useRpcQuery('models.list', {});
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);
  const current = config ?? query.data;
  const names = new Map((models.data ?? []).map((model) => [model.key, model.displayName]));
  const modelKeyFor = (value: string): ModelKey | null =>
    models.data?.find((model) => model.key === value)?.key ?? null;
  const displayNameFor = (value: string): string =>
    models.data?.find((model) => model.key === value)?.displayName ?? value;
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  async function update(next: RouterConfig): Promise<void> {
    setConfig(next);
    setSaving(true);
    setFailure(null);
    setSaved(false);
    try {
      setConfig(await rpc.call('router.updateConfig', { config: next }));
      setSaved(true);
    } catch (error: unknown) {
      setFailure(
        error instanceof RpcCallError
          ? error.appError
          : { code: 'INTERNAL', message: t('settings.saveError'), retryable: true, remediation: [t('settings.retry')] },
      );
    } finally {
      setSaving(false);
    }
  }
  function patch(patch: Partial<RouterConfig>): void {
    if (current !== undefined) {
      void update({ ...current, ...patch });
    }
  }
  function reorder(event: DragEndEvent): void {
    if (current === undefined || event.over === null || event.active.id === event.over.id) return;
    const from = current.ladder.findIndex((entry) => entry.modelKey === String(event.active.id));
    const to = current.ladder.findIndex((entry) => entry.modelKey === String(event.over?.id));
    if (from < 0 || to < 0) return;
    const ladder = arrayMove([...current.ladder], from, to).map((entry, index) => ({ ...entry, priority: index + 1 }));
    patch({ ladder });
  }
  if (current === undefined) return <p role="status">{t('settings.loading')}</p>;
  return (
    <section aria-labelledby="settings-heading" className="max-w-3xl space-y-5">
      <SettingsHeading section="router" />
      <p className="text-sm text-text-muted">{t('settings.router.description')}</p>
      <label className="flex items-center gap-3">
        <input
          checked={current.autoFallback}
          disabled={saving}
          onChange={(event) => {
            patch({ autoFallback: event.target.checked });
          }}
          type="checkbox"
        />
        {t('settings.router.autoFallback')}
      </label>
      <p className="text-sm text-text-muted">{t('settings.router.fallbackHelp')}</p>
      <label className="grid max-w-md gap-1">
        {t('settings.router.lockModel')}
        <select
          className="rounded border border-border bg-bg p-2"
          disabled={saving}
          onChange={(event) => {
            patch({ lockedModelKey: modelKeyFor(event.target.value) });
          }}
          value={current.lockedModelKey ?? ''}
        >
          <option value="">{t('settings.router.none')}</option>
          {(models.data ?? []).map((model) => (
            <option key={model.key} value={model.key}>
              {model.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="grid max-w-xs gap-1">
        {t('settings.router.timeout')}
        <input
          className="rounded border border-border bg-bg p-2"
          disabled={saving}
          max={300}
          min={10}
          onChange={(event) => {
            const seconds = Number(event.target.value);
            if (seconds >= 10 && seconds <= 300) patch({ userDecisionTimeoutMs: seconds * 1000 });
          }}
          type="number"
          value={current.userDecisionTimeoutMs / 1000}
        />
      </label>
      <h3 className="font-semibold">{t('settings.router.ladder')}</h3>
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={reorder}
        sensors={sensors}
        accessibility={{
          screenReaderInstructions: { draggable: t('settings.router.keyboardHelp') },
          announcements: {
            onDragStart: ({ active }) => t('settings.router.dragStart', { name: displayNameFor(String(active.id)) }),
            onDragOver: ({ active, over }) =>
              over
                ? t('settings.router.dragOver', {
                    name: displayNameFor(String(active.id)),
                    target: displayNameFor(String(over.id)),
                  })
                : '',
            onDragEnd: ({ active, over }) =>
              over
                ? t('settings.router.dragEnd', {
                    name: displayNameFor(String(active.id)),
                    target: displayNameFor(String(over.id)),
                  })
                : '',
            onDragCancel: () => t('settings.router.dragCancel'),
          },
        }}
      >
        <SortableContext items={current.ladder.map((entry) => entry.modelKey)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {current.ladder.map((entry) => (
              <LadderRow
                entry={entry}
                key={entry.modelKey}
                name={names.get(entry.modelKey) ?? entry.modelKey}
                onChange={(changed) => {
                  patch({
                    ladder: current.ladder.map((item) => (item.modelKey === changed.modelKey ? changed : item)),
                  });
                }}
                saving={saving}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <SettingsFeedback failure={failure} saved={saved} />
    </section>
  );
}
