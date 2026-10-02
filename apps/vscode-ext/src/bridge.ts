import type { ExtHello, SidecarToExt } from '@itstudio/schemas';
import { readSession, type SessionFileSystem } from './session';

export interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface BridgeClock {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BridgeOptions {
  readonly workspaceRoot: string;
  readonly extensionVersion: string;
  readonly fs: SessionFileSystem;
  readonly createSocket: (url: string) => WebSocketLike;
  readonly clock: BridgeClock;
  readonly logger: (message: string) => void;
  readonly onState: (state: 'connected' | 'disconnected') => void;
}

export class SidecarBridge {
  private socket: WebSocketLike | undefined;
  private timer: unknown;
  private attempt = 0;
  private stopped = false;
  private connected = false;
  private generation = 0;
  private readonly handlers = new Set<(message: SidecarToExt) => void>();

  private readonly options: BridgeOptions;

  public constructor(options: BridgeOptions) {
    this.options = options;
  }

  public onMessage(handler: (message: SidecarToExt) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public sendSerialized(message: string): void {
    if (this.connected) this.socket?.send(message);
  }

  public connect(): void {
    this.stopped = false;
    this.connected = false;
    this.options.onState('disconnected');
    this.generation += 1;
    this.attempt = 0;
    this.clearTimer();
    this.socket?.close();
    void this.connectAttempt(this.generation);
  }

  public dispose(): void {
    this.stopped = true;
    this.connected = false;
    this.generation += 1;
    this.clearTimer();
    this.socket?.close();
    this.socket = undefined;
  }

  private async connectAttempt(generation: number): Promise<void> {
    if (!this.isCurrent(generation)) return;
    const session = await readSession(this.options.workspaceRoot, this.options.fs);
    if (!this.isCurrent(generation)) return;
    if (!session.ok) {
      this.options.logger(session.error.message);
      this.schedule(generation);
      return;
    }
    let socket: WebSocketLike;
    try {
      socket = this.options.createSocket(`ws://127.0.0.1:${String(session.value.port)}`);
    } catch {
      this.options.onState('disconnected');
      this.schedule(generation);
      return;
    }
    this.socket = socket;
    let welcomed = false;
    socket.onopen = () => {
      const hello: ExtHello = {
        type: 'hello',
        protocolVersion: 1,
        token: session.value.token,
        workspaceRoot: this.options.workspaceRoot,
        extensionVersion: this.options.extensionVersion,
      };
      socket.send(JSON.stringify(hello));
      this.timer = this.options.clock.setTimeout(() => {
        if (!welcomed && generation === this.generation) socket.close();
      }, 5000);
    };
    socket.onmessage = (event) => {
      const message = parseMessage(event.data);
      if (!message) return;
      if (message.type === 'welcome') {
        welcomed = true;
        this.connected = true;
        this.clearTimer();
        this.attempt = 0;
        this.options.onState('connected');
      } else if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      } else {
        for (const handler of this.handlers) handler(message);
      }
    };
    const disconnected = () => {
      if (generation !== this.generation) return;
      this.connected = false;
      this.clearTimer();
      this.options.onState('disconnected');
      this.schedule(generation);
    };
    socket.onclose = disconnected;
    socket.onerror = disconnected;
  }

  private schedule(generation: number): void {
    if (this.stopped || generation !== this.generation || this.timer !== undefined) return;
    const delay = Math.min(1000 * 2 ** this.attempt, 15000);
    this.attempt += 1;
    this.timer = this.options.clock.setTimeout(() => {
      this.timer = undefined;
      void this.connectAttempt(generation);
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) this.options.clock.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private isCurrent(generation: number): boolean {
    return !this.stopped && generation === this.generation;
  }
}

function parseMessage(data: unknown): SidecarToExt | undefined {
  if (typeof data !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return undefined;
  switch (parsed.type) {
    case 'welcome':
      return typeof parsed.sessionId === 'string' ? (parsed as unknown as SidecarToExt) : undefined;
    case 'ping':
      return { type: 'ping' };
    case 'request_diagnostics':
      return Number.isInteger(parsed.ref) ? { type: 'request_diagnostics', ref: parsed.ref as number } : undefined;
    case 'reveal':
      return Number.isInteger(parsed.ref) &&
        typeof parsed.path === 'string' &&
        (parsed.line === undefined || (Number.isInteger(parsed.line) && (parsed.line as number) >= 1))
        ? (parsed as unknown as SidecarToExt)
        : undefined;
    case 'show_diff':
      return Number.isInteger(parsed.ref) &&
        typeof parsed.path === 'string' &&
        typeof parsed.before === 'string' &&
        typeof parsed.after === 'string' &&
        typeof parsed.title === 'string'
        ? (parsed as unknown as SidecarToExt)
        : undefined;
    case 'transaction':
      return Number.isInteger(parsed.ref) &&
        typeof parsed.transactionId === 'string' &&
        ['prepared', 'committed', 'validated', 'rolled_back', 'rollback_failed'].includes(String(parsed.status)) &&
        Array.isArray(parsed.paths) &&
        parsed.paths.every((candidate: unknown) => typeof candidate === 'string')
        ? (parsed as unknown as SidecarToExt)
        : undefined;
    case 'notify':
      return Number.isInteger(parsed.ref) &&
        ['info', 'warning', 'error'].includes(String(parsed.level)) &&
        typeof parsed.message === 'string'
        ? (parsed as unknown as SidecarToExt)
        : undefined;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
