import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { AppError, ImageAsset, MoneyDisplay, PriceRow, Project, ProjectId } from '@itstudio/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Money } from '../../components/Money';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { formatDate } from '../../i18n/format';
import { useRpcQuery } from '../../hooks/use-rpc-query';
import { RpcCallError } from '../../rpc/rpc-client';
import { useRpcClient } from '../../rpc/rpc-context';
import { ImageLightbox } from './ImageLightbox';

function displayedCost(asset: ImageAsset, rows: readonly PriceRow[] | undefined): MoneyDisplay | undefined {
  const prefix = {
    openai_dalle3: 'openai/',
    flux_together: 'together/',
    flux_replicate: 'replicate/',
    midjourney_proxy: 'midjourney/',
  }[asset.provider];
  return rows?.find((row) => row.entry.modelKey.startsWith(prefix) && row.entry.perImageMicroUsd === asset.cost)
    ?.perImage;
}

export function GalleryPage({
  projectId,
  projects,
}: {
  readonly projectId: ProjectId | null;
  readonly projects: readonly Project[];
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const cache = useQueryClient();
  const prices = useRpcQuery('pricing.getRows', {});
  const projectsForQuery = projectId === null ? projects : projects.filter((project) => project.id === projectId);
  const query = useQuery({
    queryKey: ['gallery.assets', projectId, projectsForQuery.map((project) => project.id)],
    queryFn: async () => {
      const assets = await Promise.all(
        projectsForQuery.map((project) => rpc.call('images.list', { projectId: project.id })),
      );
      return assets.flat().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
    enabled: projectsForQuery.length > 0,
  });
  const [selected, setSelected] = useState<ImageAsset | null>(null);
  const [preview, setPreview] = useState<ImageAsset | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  async function remove(): Promise<void> {
    if (selected === null) return;
    try {
      await rpc.call('images.delete', { assetId: selected.id });
      setSelected(null);
      await cache.invalidateQueries({ queryKey: ['gallery.assets'] });
    } catch (cause: unknown) {
      setError(
        cause instanceof RpcCallError
          ? cause.appError
          : {
              code: 'INTERNAL',
              message: t('gallery.deleteError'),
              retryable: true,
              remediation: [t('gallery.retry')],
            },
      );
    }
  }
  const firstAssetPath = query.data?.[0]?.localPath;
  const separator = Math.max(firstAssetPath?.lastIndexOf('/') ?? -1, firstAssetPath?.lastIndexOf('\\') ?? -1);
  const imageDirectory = firstAssetPath?.slice(0, separator);
  return (
    <section aria-labelledby="gallery-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold" id="gallery-heading">
          {t('gallery.heading')}
        </h1>
        {imageDirectory !== undefined && imageDirectory.length > 0 ? (
          <button
            className="rounded border border-border px-3 py-2"
            onClick={() => void invoke('plugin:opener|open_path', { path: imageDirectory, with: null })}
            type="button"
          >
            {t('gallery.openFolder')}
          </button>
        ) : null}
      </div>
      {error !== null ? <p role="alert">{error.message}</p> : null}
      {query.isLoading ? <p role="status">{t('gallery.loading')}</p> : null}
      {query.isError ? <p role="alert">{t('gallery.loadError')}</p> : null}
      {query.data?.length === 0 || (query.data === undefined && projectsForQuery.length === 0) ? (
        <p className="text-text-muted">{t('gallery.empty')}</p>
      ) : null}
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(query.data ?? []).map((asset) => {
          const cost = displayedCost(asset, prices.data?.rows);
          return (
            <li className="overflow-hidden rounded border border-border bg-surface" key={asset.id}>
              <button
                aria-label={t('gallery.openImage', { prompt: asset.revisedPrompt ?? asset.prompt })}
                className="block w-full focus-visible:outline-2 focus-visible:outline-focus-ring"
                onClick={() => {
                  setPreview(asset);
                }}
                type="button"
              >
                <img
                  alt={asset.revisedPrompt ?? asset.prompt}
                  className="h-52 w-full object-cover"
                  loading="lazy"
                  src={convertFileSrc(asset.localPath)}
                />
              </button>
              <div className="space-y-2 p-3 text-sm">
                <p className="line-clamp-3">{asset.prompt}</p>
                {asset.revisedPrompt !== undefined ? (
                  <p className="line-clamp-3 text-text-muted">{asset.revisedPrompt}</p>
                ) : null}
                <p className="text-text-muted">
                  {t(`gallery.providers.${asset.provider}`)} · {formatDate(asset.createdAt, i18n.language)}
                </p>
                {cost === undefined ? null : <Money value={cost} />}
                <button
                  className="text-danger underline"
                  onClick={() => {
                    setSelected(asset);
                  }}
                  type="button"
                >
                  {t('gallery.delete')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {preview !== null ? (
        <ImageLightbox
          alt={preview.revisedPrompt ?? preview.prompt}
          onClose={() => {
            setPreview(null);
          }}
          src={convertFileSrc(preview.localPath)}
        />
      ) : null}
      <ConfirmDialog
        cancelLabel={t('gallery.cancel')}
        confirmLabel={t('gallery.delete')}
        message={t('gallery.deletePrompt', { prompt: selected?.prompt ?? '' })}
        onCancel={() => {
          setSelected(null);
        }}
        onConfirm={() => {
          void remove();
        }}
        open={selected !== null}
        title={t('gallery.deleteTitle')}
        tone="danger"
      />
    </section>
  );
}
