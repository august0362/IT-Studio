import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  readonly src: string;
  readonly alt: string;
  readonly onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        aria-label={t('gallery.preview')}
        aria-modal="true"
        className="relative max-h-full max-w-full"
        role="dialog"
      >
        <button
          aria-label={t('gallery.closePreview')}
          className="absolute right-2 top-2 rounded bg-black/70 px-3 py-2 text-white focus-visible:outline-2 focus-visible:outline-focus-ring"
          onClick={onClose}
          ref={closeRef}
          type="button"
        >
          {t('gallery.close')}
        </button>
        <img alt={alt} className="max-h-[90vh] max-w-[90vw] object-contain" src={src} />
      </section>
    </div>
  );
}
