import { convertFileSrc } from '@tauri-apps/api/core';
import type { ImageAsset } from '@itstudio/schemas';
import type { JSX } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImageLightbox } from '../gallery/ImageLightbox';

export function ChatImage({ asset }: { readonly asset: ImageAsset }): JSX.Element {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const src = convertFileSrc(asset.localPath);
  const alt = asset.revisedPrompt ?? asset.prompt;
  return (
    <>
      <button
        aria-label={t('chat.openImage', { alt })}
        className="mt-2 block max-w-full rounded focus-visible:outline-2 focus-visible:outline-focus-ring"
        onClick={() => {
          setExpanded(true);
        }}
        type="button"
      >
        <img alt={alt} className="max-h-96 max-w-full rounded object-contain" loading="lazy" src={src} />
      </button>
      {expanded ? (
        <ImageLightbox
          alt={alt}
          onClose={() => {
            setExpanded(false);
          }}
          src={src}
        />
      ) : null}
    </>
  );
}
