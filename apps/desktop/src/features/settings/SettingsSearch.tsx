import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeSettingsText, searchSettings, SETTINGS_SECTIONS, type SettingSuggestion } from './settings-sections';

function Highlight({ text, query }: { readonly text: string; readonly query: string }): ReactNode {
  const normalized = normalizeSettingsText(query.trim());
  const start = normalizeSettingsText(text).indexOf(normalized);
  if (!normalized || start < 0) return text;
  // Match normalized letters back to original UTF-16 offsets (including combining accents).
  const offsets: number[] = [];
  let offset = 0;
  for (const character of text) {
    offsets.push(...Array.from({ length: normalizeSettingsText(character).length }, () => offset));
    offset += character.length;
  }
  const parts: ReactNode[] = [];
  let match = start;
  let previous = 0;
  while (match >= 0) {
    const from = offsets[match] ?? 0;
    const to = offsets[match + normalized.length] ?? text.length;
    parts.push(
      text.slice(previous, from),
      <mark key={match} className="bg-primary text-primary-fg">
        {text.slice(from, to)}
      </mark>,
    );
    previous = to;
    match = normalizeSettingsText(text).indexOf(normalized, match + normalized.length);
  }
  parts.push(text.slice(previous));
  return <>{parts}</>;
}
export function SettingsSearch({
  value,
  onChange,
  onChoose,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onChoose: (entry: SettingSuggestion) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const entries = searchSettings(value);
  const expanded = open && entries.length > 0;
  const label = (entry: { readonly en: string; readonly vi: string }): string => {
    const preferred = i18n.language.startsWith('vi') ? entry.vi : entry.en;
    const alternative = i18n.language.startsWith('vi') ? entry.en : entry.vi;
    const query = normalizeSettingsText(value.trim());
    return !normalizeSettingsText(preferred).includes(query) && normalizeSettingsText(alternative).includes(query)
      ? alternative
      : preferred;
  };
  const choose = (entry: SettingSuggestion): void => {
    setOpen(false);
    onChoose(entry);
  };
  return (
    <div className="relative">
      <label className="mb-3 block text-sm font-medium" htmlFor="settings-search">
        {t('settings.search')}
      </label>
      <input
        id="settings-search"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls="settings-suggestions"
        aria-activedescendant={expanded ? 'settings-suggestion-' + String(active) : undefined}
        className="w-full rounded border border-border bg-surface px-3 py-2 text-text"
        value={value}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && entries.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              !expanded
                ? event.key === 'ArrowDown'
                  ? 0
                  : entries.length - 1
                : (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length,
            );
          } else if (event.key === 'Enter' && expanded) {
            event.preventDefault();
            const entry = entries[active];
            if (entry !== undefined) choose(entry);
          }
        }}
      />
      {expanded ? (
        <ul
          id="settings-suggestions"
          role="listbox"
          aria-label={t('settings.search')}
          className="absolute left-0 top-full z-40 mt-1 max-h-96 w-80 max-w-[90vw] overflow-auto rounded border border-border bg-surface p-1 shadow-lg"
        >
          {entries.map((entry, index) => {
            const section = SETTINGS_SECTIONS.find((item) => item.route === entry.section);
            return (
              <li
                key={entry.id ?? entry.section}
                id={'settings-suggestion-' + String(index)}
                role="option"
                aria-selected={active === index}
                className="cursor-pointer rounded px-3 py-2 aria-selected:bg-surface-alt"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={() => {
                  choose(entry);
                }}
              >
                <span className="block">
                  <Highlight text={label(entry)} query={value} />
                </span>
                <span className="block text-xs text-text-muted">
                  {section === undefined ? '' : <Highlight text={label(section)} query={value} />}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
