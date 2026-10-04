import { WebChatBrowser, type RpcMethodMap, type WebChatLink, type WebChatSettings } from '@itstudio/schemas';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { SettingsHeading, useSettingsSave } from '../settings-form';

type BrowserOption = RpcMethodMap['webchat.browsers']['result'][number];

const defaults: readonly WebChatLink[] = [
  { id: 'chatgpt' as WebChatLink['id'], name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
  { id: 'gemini' as WebChatLink['id'], name: 'Gemini', url: 'https://gemini.google.com/app', enabled: true },
  { id: 'grok' as WebChatLink['id'], name: 'Grok', url: 'https://grok.com/', enabled: true },
  { id: 'claude' as WebChatLink['id'], name: 'Claude', url: 'https://claude.ai/new', enabled: true },
  {
    id: 'google-ai-studio' as WebChatLink['id'],
    name: 'Google AI Studio',
    url: 'https://aistudio.google.com/',
    enabled: true,
  },
  { id: 'perplexity' as WebChatLink['id'], name: 'Perplexity', url: 'https://www.perplexity.ai/', enabled: true },
];
const browsers = [
  WebChatBrowser.DEFAULT,
  WebChatBrowser.COCCOC,
  WebChatBrowser.CHROME,
  WebChatBrowser.EDGE,
  WebChatBrowser.FIREFOX,
  WebChatBrowser.CUSTOM,
] as const;

export function WebChatSettingsPage() {
  const { t } = useTranslation();
  const query = useRpcQuery('settings.get', {});
  const browserQuery = useRpcQuery('webchat.browsers', {});
  if (query.data === undefined)
    return (
      <section aria-labelledby="settings-heading" className="max-w-4xl space-y-5">
        <SettingsHeading section="web-chat" />
        <p role="status">{t('settings.loading')}</p>
      </section>
    );
  return (
    <WebChatSettingsForm
      initial={query.data.webChat}
      browserOptions={browserQuery.data ?? []}
      key={JSON.stringify(query.data.webChat)}
    />
  );
}

function WebChatSettingsForm({
  initial,
  browserOptions,
}: {
  readonly initial: WebChatSettings;
  readonly browserOptions: readonly BrowserOption[];
}) {
  const { t } = useTranslation();
  const form = useSettingsSave();
  const [value, setValue] = useState(initial);
  const issues = issueMap(form.failure?.details);

  function updateLink(index: number, patch: Partial<WebChatLink>): void {
    setValue((current) => ({
      ...current,
      links: current.links.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    }));
  }
  function move(index: number, direction: -1 | 1): void {
    setValue((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.links.length) return current;
      const links = [...current.links];
      const source = links[index];
      const destination = links[target];
      if (source === undefined || destination === undefined) return current;
      links[index] = destination;
      links[target] = source;
      return { ...current, links };
    });
  }

  return (
    <section aria-labelledby="settings-heading" className="max-w-4xl space-y-5">
      <SettingsHeading section="web-chat" />
      <div className="space-y-5">
        <label className="grid max-w-lg gap-1">
          {t('settings.webChat.browser')}
          <select
            className="rounded border border-border bg-bg p-2"
            value={value.browser}
            onChange={(event) => {
              const selected = browsers.find((browser) => browser === event.target.value);
              if (selected !== undefined) setValue({ ...value, browser: selected });
            }}
          >
            {browsers.map((browser) => {
              const installed = browserOptions.find((item) => item.browser === browser)?.installed;
              const unavailable =
                browser !== WebChatBrowser.DEFAULT && browser !== WebChatBrowser.CUSTOM && installed !== true;
              return (
                <option disabled={unavailable} key={browser} value={browser}>
                  {t(`settings.webChat.browserName.${browser}`)}
                  {unavailable ? ` ${t('settings.webChat.notInstalled')}` : ''}
                </option>
              );
            })}
          </select>
        </label>
        {value.browser === WebChatBrowser.CUSTOM ? (
          <label className="grid max-w-lg gap-1">
            {t('settings.webChat.customPath')}
            <input
              className="rounded border border-border bg-bg p-2"
              value={value.customBrowserPath ?? ''}
              onChange={(event) => {
                setValue({ ...value, customBrowserPath: event.target.value || null });
              }}
              type="text"
            />
            {issues.customBrowserPath ? <span className="text-sm text-danger">{issues.customBrowserPath}</span> : null}
          </label>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {['name', 'url', 'enabled', 'actions'].map((column) => (
                  <th className="border-b border-border p-2" key={column}>
                    {t(`settings.webChat.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {value.links.map((link, index) => (
                <tr key={link.id}>
                  <td className="border-b border-border p-2">
                    <input
                      aria-label={t('settings.webChat.name')}
                      className="w-full rounded border border-border bg-bg p-2"
                      maxLength={40}
                      value={link.name}
                      onChange={(event) => {
                        updateLink(index, { name: event.target.value });
                      }}
                    />
                    {issues[`links.${String(index)}.name`] ? (
                      <span className="text-sm text-danger">{issues[`links.${String(index)}.name`]}</span>
                    ) : null}
                  </td>
                  <td className="border-b border-border p-2">
                    <input
                      aria-label={t('settings.webChat.url')}
                      className="min-w-64 w-full rounded border border-border bg-bg p-2"
                      value={link.url}
                      onChange={(event) => {
                        updateLink(index, { url: event.target.value });
                      }}
                    />
                    {issues[`links.${String(index)}.url`] ? (
                      <span className="text-sm text-danger">{issues[`links.${String(index)}.url`]}</span>
                    ) : null}
                  </td>
                  <td className="border-b border-border p-2">
                    <input
                      aria-label={`${t('settings.webChat.enabled')} ${link.name}`}
                      checked={link.enabled}
                      onChange={(event) => {
                        updateLink(index, { enabled: event.target.checked });
                      }}
                      type="checkbox"
                    />
                  </td>
                  <td className="border-b border-border p-2">
                    <div className="flex gap-1">
                      <button
                        aria-label={`${t('settings.webChat.moveUp')} ${link.name}`}
                        className="rounded border border-border px-2"
                        disabled={index === 0}
                        onClick={() => {
                          move(index, -1);
                        }}
                        type="button"
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`${t('settings.webChat.moveDown')} ${link.name}`}
                        className="rounded border border-border px-2"
                        disabled={index === value.links.length - 1}
                        onClick={() => {
                          move(index, 1);
                        }}
                        type="button"
                      >
                        ↓
                      </button>
                      <button
                        aria-label={`${t('settings.webChat.delete')} ${link.name}`}
                        className="rounded border border-border px-2"
                        onClick={() => {
                          setValue({ ...value, links: value.links.filter((_, i) => i !== index) });
                        }}
                        type="button"
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {issues.links ? <p className="text-sm text-danger">{issues.links}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-border px-3 py-2"
            disabled={value.links.length >= 20}
            onClick={() => {
              setValue({
                ...value,
                links: [
                  ...value.links,
                  { id: crypto.randomUUID() as WebChatLink['id'], name: '', url: 'https://', enabled: true },
                ],
              });
            }}
            type="button"
          >
            {t('settings.webChat.add')}
          </button>
          <button
            className="rounded border border-border px-3 py-2"
            onClick={() => {
              setValue({
                ...value,
                links: defaults.map((link) => ({ ...link })),
                browser: WebChatBrowser.DEFAULT,
                customBrowserPath: null,
              });
            }}
            type="button"
          >
            {t('settings.webChat.reset')}
          </button>
          <button
            className="rounded bg-accent px-3 py-2 text-on-accent disabled:opacity-50"
            disabled={form.saving}
            onClick={() => {
              void form.save({ webChat: value });
            }}
            type="button"
          >
            {form.saving ? t('settings.save') : t('settings.webChat.save')}
          </button>
        </div>
        {form.failure ? (
          <p className="text-sm text-danger" role="alert">
            {form.failure.message}
          </p>
        ) : null}
        {form.saved ? (
          <p className="text-sm text-success" role="status">
            {t('settings.saved')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function issueMap(details: unknown): Record<string, string> {
  if (!isRecord(details) || !Array.isArray(details.issues)) return {};
  const result: Record<string, string> = {};
  for (const issue of details.issues as unknown[]) {
    if (!isRecord(issue) || typeof issue.path !== 'string' || typeof issue.message !== 'string') continue;
    result[issue.path.replace(/^webChat\./u, '')] = issue.message;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
