import { ProviderId, type AppError, type ProviderId as Provider, type SecretStatus } from '@itstudio/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type JSX, type SyntheticEvent } from 'react';
import { useRpcQuery } from '../../../hooks/use-rpc-query';
import { RpcCallError } from '../../../rpc/rpc-client';
import { useRpcClient } from '../../../rpc/rpc-context';
import { neutralClasses } from '../../../components/ui/neutral-classes';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

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

function ErrorDetails({ error }: { readonly error: AppError }): JSX.Element {
  return (
    <div className="mt-2 text-sm font-medium" role="alert">
      <p>{error.message}</p>
      {error.remediation !== undefined ? (
        <ul className="list-disc pl-5">
          {error.remediation.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function statusText(status: SecretStatus | undefined, invalid: boolean): string {
  if (invalid) return 'Invalid';
  if (status?.lastVerifiedAt !== undefined) return `Verified at ${new Date(status.lastVerifiedAt).toLocaleString()}`;
  if (status?.configured) return `Set ••••${status.hint ?? ''}`;
  return 'Not set';
}

export function ApiKeysPage(): JSX.Element {
  const rpc = useRpcClient();
  const queryClient = useQueryClient();
  const statuses = useRpcQuery('secrets.status', {});
  const [keys, setKeys] = useState<Partial<Record<Provider, string>>>({});
  const [invalid, setInvalid] = useState<Partial<Record<Provider, boolean>>>({});
  const [busy, setBusy] = useState<Partial<Record<Provider, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Provider, AppError>>>({});
  const [providerToDelete, setProviderToDelete] = useState<Provider | null>(null);

  function setProviderBusy(provider: Provider, value: boolean): void {
    setBusy((current) => ({ ...current, [provider]: value }));
  }

  function setProviderError(provider: Provider, error: AppError | undefined): void {
    setErrors((current) => {
      const updated: Partial<Record<Provider, AppError>> = {};
      if (error === undefined) {
        for (const { id } of PROVIDERS) {
          if (id === provider) continue;
          const existing = current[id];
          if (existing !== undefined) updated[id] = existing;
        }
      } else updated[provider] = error;
      return updated;
    });
  }

  function refreshStatuses(updated: SecretStatus): void {
    queryClient.setQueryData<readonly SecretStatus[]>(['secrets.status', {}], (current) => {
      const next = (current ?? []).filter((status) => status.provider !== updated.provider);
      return [...next, updated];
    });
  }

  async function save(provider: Provider, event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const apiKey = keys[provider] ?? '';
    if (apiKey.length === 0) return;

    // Clear React state before the RPC settles so the secret is never retained after success.
    setKeys((current) => ({ ...current, [provider]: '' }));
    setProviderError(provider, undefined);
    setProviderBusy(provider, true);
    try {
      const updated = await rpc.call('secrets.set', { provider, apiKey });
      setInvalid((current) => ({ ...current, [provider]: false }));
      refreshStatuses(updated);
    } catch (cause) {
      setProviderError(provider, errorFrom(cause));
    } finally {
      setProviderBusy(provider, false);
    }
  }

  async function verify(provider: Provider): Promise<void> {
    setProviderError(provider, undefined);
    setProviderBusy(provider, true);
    try {
      const updated = await rpc.call('secrets.verify', { provider });
      setInvalid((current) => ({ ...current, [provider]: false }));
      refreshStatuses(updated);
    } catch (cause) {
      setInvalid((current) => ({ ...current, [provider]: true }));
      setProviderError(provider, errorFrom(cause));
    } finally {
      setProviderBusy(provider, false);
    }
  }

  async function remove(provider: Provider): Promise<void> {
    setProviderError(provider, undefined);
    setProviderBusy(provider, true);
    try {
      const updated = await rpc.call('secrets.delete', { provider });
      setInvalid((current) => ({ ...current, [provider]: false }));
      refreshStatuses(updated);
    } catch (cause) {
      setProviderError(provider, errorFrom(cause));
    } finally {
      setProviderBusy(provider, false);
    }
  }

  const statusByProvider = new Map((statuses.data ?? []).map((status) => [status.provider, status]));

  return (
    <section aria-labelledby="api-keys-heading" className="mx-auto max-w-4xl">
      <h2 className="mb-2 text-2xl font-semibold" id="api-keys-heading">
        API keys
      </h2>
      <p className={`mb-6 ${neutralClasses.secondaryText}`}>Keys are stored securely and never displayed in full.</p>
      {statuses.isError ? <ErrorDetails error={errorFrom(statuses.error)} /> : null}
      <div className={`divide-y ${neutralClasses.border} border-y`}>
        {PROVIDERS.map(({ id, name }) => {
          const error = errors[id];
          return (
            <article className="grid gap-4 py-5 md:grid-cols-[minmax(10rem,1fr)_2fr]" key={id}>
              <div>
                <h3 className="font-medium">{name}</h3>
                <p
                  aria-label={`${name} key status`}
                  className={`mt-1 text-sm ${neutralClasses.secondaryText}`}
                  role="status"
                >
                  {statusText(statusByProvider.get(id), invalid[id] === true)}
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
                    className={`min-w-0 flex-1 rounded border ${neutralClasses.controlBorder} px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2`}
                    id={`api-key-${id}`}
                    onChange={(event) => {
                      setKeys((current) => ({ ...current, [id]: event.target.value }));
                    }}
                    placeholder="Enter API key"
                    type="password"
                    value={keys[id] ?? ''}
                  />
                  <button
                    className={`rounded border ${neutralClasses.controlBorder} px-3 py-2 ${neutralClasses.hoverSurface}`}
                    disabled={busy[id]}
                    type="submit"
                  >
                    Save
                  </button>
                  <button
                    className={`rounded border ${neutralClasses.controlBorder} px-3 py-2 ${neutralClasses.hoverSurface}`}
                    disabled={busy[id]}
                    onClick={() => {
                      void verify(id);
                    }}
                    type="button"
                  >
                    Verify
                  </button>
                  <button
                    className={`rounded border ${neutralClasses.controlBorder} px-3 py-2 ${neutralClasses.hoverSurface}`}
                    disabled={busy[id]}
                    onClick={() => {
                      setProviderToDelete(id);
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </form>
                {error !== undefined ? <ErrorDetails error={error} /> : null}
              </div>
            </article>
          );
        })}
      </div>
      <ConfirmDialog
        cancelLabel="Cancel"
        confirmLabel="Delete"
        message={`Delete the ${PROVIDERS.find((item) => item.id === providerToDelete)?.name ?? providerToDelete ?? ''} API key?`}
        onCancel={() => {
          setProviderToDelete(null);
        }}
        onConfirm={() => {
          const provider = providerToDelete;
          setProviderToDelete(null);
          if (provider !== null) void remove(provider);
        }}
        open={providerToDelete !== null}
        title="Delete API key?"
        tone="danger"
      />
    </section>
  );
}
