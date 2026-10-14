import {
  ProviderId,
  type AppError,
  type ProviderId as Provider,
  type SecretHistoryEntry,
  type SecretStatus,
} from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type JSX, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { RpcCallError } from '../../../rpc/rpc-client';
import { useRpcClient } from '../../../rpc/rpc-context';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { ErrorPanel } from '../../../components/ErrorPanel';
import '../../../i18n';
import { formatDateTime } from '../../../i18n/format';

const PROVIDERS: readonly { readonly id: Provider; readonly name: string }[] = [
  { id: ProviderId.ANTHROPIC, name: 'Anthropic' },
  { id: ProviderId.OPENAI, name: 'OpenAI' },
  { id: ProviderId.GOOGLE, name: 'Google' },
  { id: ProviderId.XAI, name: 'xAI' },
  { id: ProviderId.GROQ, name: 'Groq' },
  { id: ProviderId.TOGETHER, name: 'Together' },
  { id: ProviderId.REPLICATE, name: 'Replicate' },
];

function errorFrom(cause: unknown): AppError {
  if (cause instanceof RpcCallError) return cause.appError;
  return {
    code: 'INTERNAL',
    message: 'The request could not be completed.',
    remediation: ['Check the sidecar connection and try again.'],
    retryable: true,
  };
}

export function ApiKeysPage(): JSX.Element {
  const { t, i18n } = useTranslation();
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const statuses = useRpcQuery('secrets.status', {});
  const history = useRpcQuery('secrets.history', { limit: 50 });
  const [keys, setKeys] = useState<Partial<Record<Provider, string>>>({});
  const [emptyHints, setEmptyHints] = useState<Partial<Record<Provider, boolean>>>({});
  const [busy, setBusy] = useState<Partial<Record<Provider, boolean>>>({});
  const [verifying, setVerifying] = useState<Partial<Record<Provider, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Provider, AppError>>>({});
  const [providerToDelete, setProviderToDelete] = useState<Provider | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  function setProviderBusy(provider: Provider, value: boolean): void {
    setBusy((current) => ({ ...current, [provider]: value }));
  }

  function setProviderError(provider: Provider, error: AppError | undefined): void {
    setErrors((current) => {
      if (error !== undefined) return { ...current, [provider]: error };
      const remaining: Partial<Record<Provider, AppError>> = {};
      for (const { id } of PROVIDERS) {
        if (id !== provider && current[id] !== undefined) remaining[id] = current[id];
      }
      return remaining;
    });
  }

  function showToast(message: string): void {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
    }, 3_500);
  }

  function refreshStatuses(updated: SecretStatus): void {
    queryClient.setQueryData<readonly SecretStatus[]>(['secrets.status', {}], (current) => {
      const next = (current ?? []).filter((status) => status.provider !== updated.provider);
      return [...next, updated];
    });
  }

  function refreshHistory(): void {
    void queryClient.invalidateQueries({ queryKey: ['secrets.history'] });
  }

  async function save(provider: Provider, event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const apiKey = keys[provider] ?? '';
    if (apiKey.trim().length === 0) {
      setEmptyHints((current) => ({ ...current, [provider]: true }));
      return;
    }

    setEmptyHints((current) => ({ ...current, [provider]: false }));
    setProviderError(provider, undefined);
    setProviderBusy(provider, true);
    setVerifying((current) => ({ ...current, [provider]: true }));
    try {
      const updated = await rpc.call('secrets.verifyAndSave', { provider, apiKey });
      setKeys((current) => ({ ...current, [provider]: '' }));
      refreshStatuses(updated);
      refreshHistory();
      showToast(t('api.keySaved', { provider: PROVIDERS.find((item) => item.id === provider)?.name ?? provider }));
    } catch (cause) {
      const error = errorFrom(cause);
      setProviderError(provider, error);
      refreshHistory();
      if (error.details?.keyStateMayHaveChanged === true)
        await queryClient.invalidateQueries({ queryKey: ['secrets.status', {}] });
    } finally {
      setVerifying((current) => ({ ...current, [provider]: false }));
      setProviderBusy(provider, false);
    }
  }

  async function remove(provider: Provider): Promise<void> {
    setProviderError(provider, undefined);
    setProviderBusy(provider, true);
    try {
      const updated = await rpc.call('secrets.delete', { provider });
      refreshStatuses(updated);
      refreshHistory();
    } catch (cause) {
      const error = errorFrom(cause);
      setProviderError(provider, error);
      if (error.details?.keyStateMayHaveChanged === true)
        await queryClient.invalidateQueries({ queryKey: ['secrets.status', {}] });
    } finally {
      setProviderBusy(provider, false);
    }
  }

  const statusByProvider = new Map((statuses.data ?? []).map((status) => [status.provider, status]));

  function statusText(status: SecretStatus | undefined): string {
    if (status?.lastVerifiedAt !== undefined) return t('api.verified', { hint: status.hint ?? '' });
    if (status?.configured) return t('api.configured', { hint: status.hint ?? '' });
    return t('api.notSet');
  }

  function providerName(provider: Provider): string {
    return PROVIDERS.find((item) => item.id === provider)?.name ?? provider;
  }

  function historyResult(entry: SecretHistoryEntry): string {
    if (entry.action === 'saved') return t('api.historySaved');
    if (entry.action === 'deleted') return t('api.historyDeleted');
    return t('api.historyFailed', { code: entry.resultCode ?? 'UNKNOWN' });
  }

  return (
    <section aria-labelledby="api-keys-heading" className="mx-auto max-w-4xl">
      <h2 className="mb-2 text-2xl font-semibold" id="api-keys-heading">
        {t('api.heading')}
      </h2>
      <p className="mb-6 text-text-muted">{t('api.description')}</p>
      {statuses.isError ? <ErrorPanel error={errorFrom(statuses.error)} /> : null}
      <div className="divide-y divide-border border-y border-border">
        {PROVIDERS.map(({ id, name }) => {
          const error = errors[id];
          return (
            <article
              aria-busy={busy[id] === true}
              className="grid gap-4 py-5 md:grid-cols-[minmax(10rem,1fr)_2fr]"
              key={id}
            >
              <div>
                <h3 className="font-medium">{name}</h3>
                <p aria-label={`${name} key status`} className="mt-1 text-sm text-text-muted" role="status">
                  {statusText(statusByProvider.get(id))}
                </p>
              </div>
              <div>
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(event) => {
                    void save(id, event);
                  }}
                >
                  <label className="sr-only" htmlFor={`api-key-${id}`}>
                    {name} API key
                  </label>
                  <input
                    autoComplete="new-password"
                    className="min-w-0 flex-1 rounded border border-border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    disabled={busy[id] === true}
                    id={`api-key-${id}`}
                    onChange={(event) => {
                      setKeys((current) => ({ ...current, [id]: event.target.value }));
                      setEmptyHints((current) => ({ ...current, [id]: false }));
                      setProviderError(id, undefined);
                    }}
                    placeholder={t('api.enter')}
                    type="password"
                    value={keys[id] ?? ''}
                  />
                  <button
                    className="rounded border border-border px-3 py-2 hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy[id] === true}
                    type="submit"
                  >
                    {verifying[id] === true ? (
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-4 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin"
                        />
                        {t('api.verifying')}
                      </span>
                    ) : (
                      t('api.verifyAndSave')
                    )}
                  </button>
                  <button
                    className="rounded border border-border px-3 py-2 hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={busy[id] === true}
                    onClick={() => {
                      setProviderToDelete(id);
                    }}
                    type="button"
                  >
                    {t('api.delete')}
                  </button>
                </form>
                {emptyHints[id] === true ? (
                  <p className="mt-2 text-sm text-danger" role="status">
                    {t('api.emptyHint')}
                  </p>
                ) : null}
                {error !== undefined ? <ErrorPanel error={error} /> : null}
              </div>
            </article>
          );
        })}
      </div>
      <details className="mt-5 rounded border border-border p-4">
        <summary className="cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-focus-ring">
          {t('api.history')}
        </summary>
        {history.isError ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {t('api.historyError')}
          </p>
        ) : history.data === undefined || history.data.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">{t('api.historyEmpty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="px-2 py-2 font-medium">{t('api.historyTime')}</th>
                  <th className="px-2 py-2 font-medium">{t('api.historyProvider')}</th>
                  <th className="px-2 py-2 font-medium">{t('api.historyKey')}</th>
                  <th className="px-2 py-2 font-medium">{t('api.historyResult')}</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((entry) => (
                  <tr className="border-b border-border last:border-0" key={entry.id}>
                    <td className="px-2 py-2">
                      <time dateTime={entry.at}>{formatDateTime(entry.at, i18n.language)}</time>
                    </td>
                    <td className="px-2 py-2">{providerName(entry.provider)}</td>
                    <td className="px-2 py-2">••••{entry.hint}</td>
                    <td className="px-2 py-2">{historyResult(entry)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
      {toast !== null ? (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded border border-border bg-surface px-4 py-3 text-text shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}
      <ConfirmDialog
        cancelLabel={t('api.cancel')}
        confirmLabel={t('api.delete')}
        message={t('api.deletePrompt', { provider: providerName(providerToDelete ?? ProviderId.OPENAI) })}
        onCancel={() => {
          setProviderToDelete(null);
        }}
        onConfirm={() => {
          const provider = providerToDelete;
          setProviderToDelete(null);
          if (provider !== null) void remove(provider);
        }}
        open={providerToDelete !== null}
        title={t('api.deleteTitle')}
        tone="danger"
      />
    </section>
  );
}
