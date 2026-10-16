import { Select } from '../../../components/ui/primitives';
import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { APPEARANCE_EVENT, appearanceSchema, readAppearance, writeThemeCache } from '../../../theme/appearance';

const CONTROLS = {
  accent: ['theme', 'ocean', 'grove', 'ember', 'alternate'],
  density: ['comfortable', 'compact'],
  fontScale: ['small', 'default', 'large'],
  motion: ['system', 'full', 'reduced'],
} as const;

export function AppearanceControls(): JSX.Element {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState(readAppearance);
  const [storageFailed, setStorageFailed] = useState(false);
  return (
    <section className="studio-card p-4" aria-label={t('appearance.customize')}>
      <h3 className="mb-1 font-semibold">{t('appearance.customize')}</h3>
      <p className="mb-4 text-sm text-text-muted">{t('appearance.description')}</p>
      <div className="studio-appearance-controls">
        {(Object.keys(CONTROLS) as (keyof typeof CONTROLS)[]).map((key) => (
          <label key={key}>
            {t(`appearance.${key}`)}
            <Select
              className="studio-input w-full"
              value={preferences[key]}
              onChange={(event) => {
                const next = appearanceSchema.parse({ ...readAppearance(), [key]: event.target.value });
                if (writeThemeCache(next)) {
                  setPreferences(next);
                  setStorageFailed(false);
                  window.dispatchEvent(new Event(APPEARANCE_EVENT));
                } else {
                  setStorageFailed(true);
                }
              }}
            >
              {CONTROLS[key].map((value) => (
                <option key={value} value={value}>
                  {t(`appearance.options.${value}`)}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      {storageFailed ? (
        <p className="mt-3 text-danger" role="alert">
          {t('appearance.storageError')}
        </p>
      ) : null}
    </section>
  );
}
