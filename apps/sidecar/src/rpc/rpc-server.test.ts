import { PassThrough } from 'node:stream';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../infra/logger.js';
import { EventBus } from './event-bus.js';
import { LineTransport } from './line-transport.js';
import { RpcServer } from './rpc-server.js';
import type { RpcNotificationMap } from '@itstudio/schemas';

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function setup() {
  const output = new PassThrough();
  const lines: string[] = [];
  let pending = '';
  output.on('data', (chunk: Buffer) => {
    pending += chunk.toString('utf8');
    const chunks = pending.split('\n');
    pending = chunks.pop() ?? '';
    lines.push(...chunks.filter(Boolean));
  });
  const transport = new LineTransport({ input: new PassThrough(), output, onLine: () => undefined });
  const logger = createLogger({
    streams: [
      new Writable({
        write(_chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
          callback();
        },
      }),
    ],
  });
  const events = new EventBus<RpcNotificationMap>();
  const server = new RpcServer(transport, events, logger);
  return { events, lines, server };
}

describe('RpcServer', () => {
  it('handles protocol errors and validates method params', async () => {
    const { server, lines } = setup();
    await server.handleLine('{');
    await server.handleLine('{}');
    await server.handleLine('{"jsonrpc":"2.0","id":1,"method":"missing","params":{}}');
    await server.handleLine('{"jsonrpc":"2.0","id":2,"method":"system.ping"}');
    expect(lines.map((line) => (parseLine(line).error as Record<string, unknown>).code)).toEqual([
      -32700, -32600, -32601, -32602,
    ]);
  });

  it('returns handler errors and contains thrown exceptions', async () => {
    const { server, lines } = setup();
    server.register('system.ping', () =>
      Promise.resolve({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'missing', retryable: false },
      }),
    );
    await server.handleLine('{"jsonrpc":"2.0","id":5,"method":"system.ping","params":{}}');
    expect(parseLine(lines[0] ?? '{}')).toMatchObject({ id: 5, error: { code: -32000, data: { code: 'NOT_FOUND' } } });
    const second = setup();
    second.server.register('system.ping', () => Promise.reject(new Error('sensitive stack')));
    await second.server.handleLine('{"jsonrpc":"2.0","id":6,"method":"system.ping","params":{}}');
    expect(parseLine(second.lines[0] ?? '{}')).toMatchObject({
      id: 6,
      error: { code: -32000, data: { code: 'INTERNAL' } },
    });
    expect(second.lines[0]).not.toContain('sensitive stack');
  });

  it('keeps concurrent request ids and forwards notifications', async () => {
    const { server, events, lines } = setup();
    const requests = new Map([
      [1, deferred()],
      [2, deferred()],
    ]);
    server.register('system.ping', async (params, context) => {
      await requests.get(context.requestId)?.promise;
      return { ok: true, value: { version: String(context.requestId), uptimeMs: 0 } };
    });
    const first = server.handleLine('{"jsonrpc":"2.0","id":1,"method":"system.ping","params":{}}');
    const second = server.handleLine('{"jsonrpc":"2.0","id":2,"method":"system.ping","params":{}}');
    requests.get(2)?.resolve();
    await second;
    requests.get(1)?.resolve();
    await first;

    events.publish('system.ready', { version: '1', recoveredTransactions: 0 });
    await vi.waitFor(() => { expect(lines).toHaveLength(3); });

    const responses = lines.slice(0, 2).map(parseLine);
    expect(responses.map((response) => response.id)).toEqual([2, 1]);
    expect(responses[0]).toMatchObject({ id: 2, result: { version: '2' } });
    expect(responses[1]).toMatchObject({ id: 1, result: { version: '1' } });
    expect(parseLine(lines[2] ?? '{}')).toMatchObject({ method: 'system.ready' });
  });
});
