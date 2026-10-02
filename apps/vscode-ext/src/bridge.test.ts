import { describe, expect, it } from 'vitest';
import type {} from '../vitest.config';
import { SidecarBridge, type BridgeClock, type WebSocketLike } from './bridge';
import type { SessionFileSystem } from './session';

class FakeClock implements BridgeClock {
  private nextId = 0;
  public readonly delays: number[] = [];
  private readonly callbacks = new Map<number, () => void>();

  public setTimeout(callback: () => void, delay: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.delays.push(delay);
    this.callbacks.set(id, callback);
    return id;
  }

  public clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.callbacks.delete(handle);
  }

  public fireNext(): void {
    const next = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!next) throw new Error('No scheduled timer');
    this.callbacks.delete(next[0]);
    next[1]();
  }

  public get pendingCount(): number {
    return this.callbacks.size;
  }
}

class FakeSocket implements WebSocketLike {
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public readonly sent: string[] = [];
  public closed = false;

  public send(data: string): void {
    this.sent.push(data);
  }

  public close(): void {
    this.closed = true;
    this.onclose?.();
  }

  public open(): void {
    this.onopen?.();
  }

  public receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const token = 'b'.repeat(64);

function setup(
  readSession: () => Promise<string> = () =>
    Promise.resolve(
      JSON.stringify({
        port: 43210,
        token,
        protocolVersion: 1,
      }),
    ),
): {
  readonly bridge: SidecarBridge;
  readonly clock: FakeClock;
  readonly sockets: FakeSocket[];
  readonly logs: string[];
  readonly states: string[];
  readonly fs: SessionFileSystem;
} {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  const logs: string[] = [];
  const states: string[] = [];
  const fs: SessionFileSystem = { readFile: readSession };
  const bridge = new SidecarBridge({
    workspaceRoot: 'C:/project',
    extensionVersion: '1.2.3',
    fs,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    clock,
    logger: (message) => logs.push(message),
    onState: (state) => states.push(state),
  });
  return { bridge, clock, sockets, logs, states, fs };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SidecarBridge', () => {
  it('completes the hello and welcome handshake', async () => {
    const { bridge, sockets } = setup();
    bridge.connect();
    await settle();
    const socket = sockets[0];
    expect(socket).toBeDefined();
    socket?.open();
    expect(JSON.parse(socket?.sent[0] ?? 'null')).toEqual({
      type: 'hello',
      protocolVersion: 1,
      token,
      workspaceRoot: 'C:/project',
      extensionVersion: '1.2.3',
    });
    socket?.receive(JSON.stringify({ type: 'welcome', sessionId: 'session-1' }));
    bridge.dispose();
  });

  it('reconnects after the welcome timeout', async () => {
    const { bridge, clock, sockets } = setup();
    bridge.connect();
    await settle();
    sockets[0]?.open();
    clock.fireNext();
    expect(sockets[0]?.closed).toBe(true);
    expect(clock.delays).toEqual([5000, 1000]);
    clock.fireNext();
    await settle();
    expect(sockets).toHaveLength(2);
    bridge.dispose();
  });

  it('answers pings and dispatches validated sidecar messages', async () => {
    const { bridge, sockets } = setup();
    const received: string[] = [];
    bridge.onMessage((message) => received.push(message.type));
    bridge.connect();
    await settle();
    const socket = sockets[0];
    socket?.open();
    socket?.receive(JSON.stringify({ type: 'ping' }));
    expect(socket?.sent).toContain('{"type":"pong"}');
    socket?.receive(JSON.stringify({ type: 'notify', ref: 1, level: 'info', message: 'ready' }));
    expect(received).toEqual(['notify']);
    bridge.dispose();
  });

  it('ignores malformed and unknown messages', async () => {
    const { bridge, sockets } = setup();
    const received: string[] = [];
    bridge.onMessage((message) => received.push(message.type));
    bridge.connect();
    await settle();
    const socket = sockets[0];
    socket?.open();
    for (const value of [
      '{',
      JSON.stringify({ type: 'unknown' }),
      JSON.stringify({ type: 'welcome', sessionId: 1 }),
      JSON.stringify({ type: 'request_diagnostics', ref: 'bad' }),
      JSON.stringify({ type: 'reveal', ref: 1 }),
      JSON.stringify({ type: 'show_diff', ref: 1, path: 'x', before: '', after: '' }),
      JSON.stringify({ type: 'transaction', ref: 1, transactionId: 'id', status: 'bad', paths: 'bad' }),
      JSON.stringify({ type: 'notify', ref: 1, level: 'fatal', message: 'bad' }),
      new ArrayBuffer(4),
    ])
      socket?.receive(value);
    expect(received).toEqual([]);
    bridge.dispose();
  });

  it('uses capped exponential backoff after repeated disconnects', async () => {
    const { bridge, clock, sockets } = setup();
    bridge.connect();
    await settle();
    for (const delay of [1000, 2000, 4000, 8000, 15000, 15000]) {
      sockets.at(-1)?.close();
      expect(clock.delays.at(-1)).toBe(delay);
      clock.fireNext();
      await settle();
    }
    bridge.dispose();
  });

  it('rereads session data and uses the rotated port and token', async () => {
    let reads = 0;
    const { bridge, clock, sockets } = setup(() => {
      reads += 1;
      return Promise.resolve(
        JSON.stringify({
          port: reads === 1 ? 43210 : 43211,
          token: reads === 1 ? token : 'c'.repeat(64),
          protocolVersion: 1,
        }),
      );
    });
    bridge.connect();
    await settle();
    sockets[0]?.close();
    clock.fireNext();
    await settle();
    expect(reads).toBe(2);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    expect(sockets[1]?.sent[0]).toContain('c'.repeat(64));
    bridge.dispose();
  });

  it('stops timers and reconnects after disposal', async () => {
    const { bridge, clock, sockets } = setup();
    bridge.connect();
    await settle();
    sockets[0]?.close();
    bridge.dispose();
    expect(clock.pendingCount).toBe(0);
    expect(sockets[0]?.closed).toBe(true);
    expect(sockets).toHaveLength(1);
  });

  it('does not write the session token to logs', async () => {
    const { bridge, logs } = setup(() => Promise.reject(new Error('session unavailable')));
    bridge.connect();
    await settle();
    expect(logs.join('\n')).not.toContain(token);
    bridge.dispose();
  });

  it('retries socket construction failures', async () => {
    const clock = new FakeClock();
    let attempts = 0;
    const bridge = new SidecarBridge({
      workspaceRoot: 'C:/project',
      extensionVersion: '1.0.0',
      fs: { readFile: () => Promise.resolve(JSON.stringify({ port: 10, token, protocolVersion: 1 })) },
      createSocket: () => {
        attempts += 1;
        throw new Error('socket unavailable');
      },
      clock,
      logger: () => undefined,
      onState: () => undefined,
    });
    bridge.connect();
    await settle();
    expect(attempts).toBe(1);
    clock.fireNext();
    await settle();
    expect(attempts).toBe(2);
    bridge.dispose();
  });
});
