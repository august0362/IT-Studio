import { ErrorCode, type AppError, type RpcMethod, type RpcMethodMap, type RpcNotificationMap, type RpcNotificationName } from '@itstudio/schemas';
import type { ISidecarTransport, SidecarStatus } from './transport';

export class RpcCallError extends Error {
  public readonly appError: AppError;

  public constructor(appError: AppError) {
    super(appError.message);
    this.name = 'RpcCallError';
    this.appError = appError;
  }
}

export interface RpcCallOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface PendingCall {
  readonly method: RpcMethod;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: RpcCallError) => void;
  readonly signal?: AbortSignal;
  abortListener?: () => void;
  timeout?: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_QUEUED_CALLS = 100;

function syntheticError(code: AppError['code'], message: string, retryable = false): RpcCallError {
  return new RpcCallError({ code, message, retryable });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class RpcClient {
  private nextId = 1;
  private ready = false;
  private statusEventReceived = false;
  private status: SidecarStatus = { running: false, ready: false, restarts: 0 };
  private readonly pending = new Map<number, PendingCall>();
  private readonly queued: number[] = [];
  private readonly handlers = new Map<RpcNotificationName, Set<(payload: unknown) => void>>();
  private readonly unlisteners: (() => void)[];
  private readonly transport: ISidecarTransport;

  public constructor(transport: ISidecarTransport) {
    this.transport = transport;
    this.unlisteners = [
      transport.onMessage((line) => {
        this.receive(line);
      }),
      transport.onStatus((status) => {
        this.statusEventReceived = true;
        this.receiveStatus(status);
      }),
    ];
    void transport.status().then((status) => {
      if (!this.statusEventReceived) this.receiveStatus(status);
    }).catch(() => undefined);
  }

  public call<M extends RpcMethod>(
    method: M,
    params: RpcMethodMap[M]['params'],
    opts: RpcCallOptions = {},
  ): Promise<RpcMethodMap[M]['result']> {
    if (opts.signal?.aborted) {
      return Promise.reject(syntheticError(ErrorCode.CANCELLED, 'request cancelled'));
    }

    const id = this.nextId++;
    return new Promise<RpcMethodMap[M]['result']>((resolve, reject) => {
      const entry: PendingCall = {
        method,
        resolve: (result) => {
          resolve(result as RpcMethodMap[M]['result']);
        },
        reject,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      };
      entry.timeout = setTimeout(() => {
        this.finish(id, syntheticError(ErrorCode.INTERNAL, 'request timed out'));
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (opts.signal !== undefined) {
        entry.abortListener = () => {
          this.finish(id, syntheticError(ErrorCode.CANCELLED, 'request cancelled'));
        };
        opts.signal.addEventListener('abort', entry.abortListener, { once: true });
      }
      this.pending.set(id, entry);

      if (this.ready) {
        void this.send(id, method, params);
      } else if (this.queued.length >= MAX_QUEUED_CALLS) {
        this.finish(id, syntheticError(ErrorCode.INTERNAL, 'sidecar request queue is full'));
      } else {
        this.queued.push(id);
      }
    });
  }

  public on<N extends RpcNotificationName>(name: N, handler: (payload: RpcNotificationMap[N]) => void): () => void {
    let handlers = this.handlers.get(name);
    if (handlers === undefined) {
      handlers = new Set<(payload: unknown) => void>();
      this.handlers.set(name, handlers);
    }
    const listener = handler as (payload: unknown) => void;
    handlers.add(listener);
    return () => {
      handlers.delete(listener);
      if (handlers.size === 0) this.handlers.delete(name);
    };
  }

  public dispose(): void {
    for (const unlisten of this.unlisteners) unlisten();
    this.rejectAll(syntheticError(ErrorCode.CANCELLED, 'RPC client disposed'));
    this.handlers.clear();
  }

  private async send<M extends RpcMethod>(id: number, method: M, params: RpcMethodMap[M]['params']): Promise<void> {
    if (!this.pending.has(id)) return;
    try {
      await this.transport.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    } catch {
      this.finish(id, syntheticError(ErrorCode.INTERNAL, 'failed to send request to sidecar', true));
    }
  }

  private receive(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      if (import.meta.env.DEV) console.warn('Ignored malformed sidecar RPC message');
      return;
    }
    if (!isRecord(message) || message.jsonrpc !== '2.0') return;

    if (typeof message.id === 'number') {
      const entry = this.pending.get(message.id);
      if (entry === undefined) return;
      if ('error' in message && isRecord(message.error)) {
        const error = message.error;
        if ('data' in error) {
          this.finish(message.id, new RpcCallError(error.data as AppError));
        } else {
          const messageText = typeof error.message === 'string' ? error.message : 'sidecar RPC error';
          this.finish(message.id, syntheticError(ErrorCode.INTERNAL, messageText));
        }
      } else if ('result' in message) {
        this.finish(message.id, undefined, message.result);
      }
      return;
    }

    if (typeof message.method !== 'string' || !('params' in message)) return;
    if (message.method === 'system.ready') {
      this.statusEventReceived = true;
      this.ready = true;
      this.status = { ...this.status, running: true, ready: true };
      this.flushQueue();
    }
    const listeners = this.handlers.get(message.method as RpcNotificationName);
    if (listeners !== undefined) {
      for (const handler of [...listeners]) handler(message.params);
    }
  }

  private receiveStatus(status: SidecarStatus): void {
    const restarted = (this.status.running && !status.running) || status.restarts > this.status.restarts;
    this.status = status;
    this.ready = status.ready;
    if (restarted) this.rejectAll(syntheticError(ErrorCode.INTERNAL, 'sidecar restarted', true));
    if (this.ready) this.flushQueue();
  }

  private flushQueue(): void {
    while (this.ready && this.queued.length > 0) {
      const id = this.queued.shift();
      if (id === undefined) continue;
      const entry = this.pending.get(id);
      if (entry !== undefined) void this.sendQueued(id, entry);
    }
  }

  private async sendQueued(id: number, entry: PendingCall): Promise<void> {
    try {
      await this.transport.send(JSON.stringify({ jsonrpc: '2.0', id, method: entry.method, params: this.paramsForQueuedCall(id) }));
    } catch {
      this.finish(id, syntheticError(ErrorCode.INTERNAL, 'failed to send request to sidecar', true));
    }
  }

  private paramsById = new Map<number, unknown>();

  private paramsForQueuedCall(id: number): unknown {
    return this.paramsById.get(id);
  }

  private finish(id: number, error?: RpcCallError, result?: unknown): void {
    const entry = this.pending.get(id);
    if (entry === undefined) return;
    this.pending.delete(id);
    this.paramsById.delete(id);
    if (entry.timeout !== undefined) clearTimeout(entry.timeout);
    if (entry.signal !== undefined && entry.abortListener !== undefined) {
      entry.signal.removeEventListener('abort', entry.abortListener);
    }
    const queueIndex = this.queued.indexOf(id);
    if (queueIndex >= 0) this.queued.splice(queueIndex, 1);
    if (error !== undefined) entry.reject(error);
    else entry.resolve(result);
  }

  private rejectAll(error: RpcCallError): void {
    for (const id of [...this.pending.keys()]) this.finish(id, error);
  }
}
