import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startSidecar, type SidecarHarness, waitFor } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

async function rawResponse(id: number | null): Promise<unknown> {
  if (sidecar === undefined) throw new Error('Sidecar has not started');
  const harness = sidecar;
  const line = await new Promise<string>((resolve) => {
    const listener = (value: string): void => {
      const parsed: unknown = JSON.parse(value);
      const envelope = z.object({ id: z.number().nullable().optional() }).safeParse(parsed);
      if (envelope.success && envelope.data.id === id) {
        harness.notifications.off('line', listener);
        resolve(value);
      }
    };
    harness.notifications.on('line', listener);
  });
  return JSON.parse(line) as unknown;
}

describe('NDJSON protocol integration', () => {
  it('TC-M1-010 invalid JSON line returns parse error and stays alive', async () => {
    sidecar = await startSidecar();
    const response = rawResponse(null);
    sidecar.writeLine('{bad json');
    await expect(response).resolves.toMatchObject({ error: { code: -32700 }, id: null });
    await expect(sidecar.call('system.ping')).resolves.toMatchObject({ result: { version: '0.1.0' } });
  }, 30_000);

  it('TC-M1-011 invalid envelope returns invalid request', async () => {
    sidecar = await startSidecar();
    const raw = rawResponse(null);
    sidecar.writeLine('{"jsonrpc":"1.0","id":91,"method":"system.ping"}');
    await expect(raw).resolves.toMatchObject({ error: { code: -32600 }, id: null });
  }, 30_000);

  it('TC-M1-012 unknown method returns method not found', async () => {
    sidecar = await startSidecar();
    const response = rawResponse(77);
    sidecar.writeLine('{"jsonrpc":"2.0","id":77,"method":"nope.method","params":{}}');
    await expect(response).resolves.toMatchObject({ error: { code: -32601 }, id: 77 });
  }, 30_000);

  it('TC-M1-013 params fail validation without echoing input', async () => {
    sidecar = await startSidecar();
    const raw = rawResponse(31);
    sidecar.writeLine(
      '{"jsonrpc":"2.0","id":31,"method":"project.create","params":{"name":5,"workspaceRoot":"secret-input"}}',
    );
    const response = await raw;
    expect(response).toMatchObject({ error: { code: -32602, data: { code: 'VALIDATION' } } });
    expect(sidecar.stdoutLines.join('')).not.toContain('secret-input');
  }, 30_000);

  it('TC-M1-014 enforces the 8 MiB line boundary and continues', async () => {
    sidecar = await startSidecar();
    const base = '{"jsonrpc":"2.0","id":50,"method":"system.ping","params":{}}';
    const atLimit = base + ' '.repeat(8 * 1024 * 1024 - Buffer.byteLength(base));
    sidecar.writeLine(atLimit);
    sidecar.writeLine(`${atLimit} `);
    await waitFor(
      () =>
        sidecar !== undefined &&
        sidecar.stdoutLines.some((line) => line.includes('"id":50')) &&
        sidecar.stdoutLines.some((line) => line.includes('"code":-32700')),
      10_000,
    );
    const oversizedLineResponse = sidecar.stdoutLines
      .map((line) => JSON.parse(line) as unknown)
      .find((message) => {
        const parsed = z.object({ error: z.object({ code: z.number() }) }).safeParse(message);
        return parsed.success && parsed.data.error.code === -32700;
      });
    expect(oversizedLineResponse).toMatchObject({ error: { code: -32700 } });
    const followingResponse = await sidecar.call('system.ping');
    expect(followingResponse).toMatchObject({ result: { version: '0.1.0' } });
  }, 30_000);

  it('TC-M1-015 concurrent requests preserve response ids', async () => {
    const harness = await startSidecar();
    sidecar = harness;
    const ids = Array.from({ length: 100 }, (_, index) => 1000 - index);
    const responses = new Set<number>();
    const finished = new Promise<void>((resolve) => {
      const listener = (line: string): void => {
        const response = z.object({ id: z.number() }).safeParse(JSON.parse(line));
        if (response.success) responses.add(response.data.id);
        if (responses.size === ids.length) {
          harness.notifications.off('line', listener);
          resolve();
        }
      };
      harness.notifications.on('line', listener);
    });
    for (const id of ids) {
      harness.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method: 'system.ping', params: {} }));
    }
    await finished;
    expect(responses).toEqual(new Set(ids));
  }, 30_000);

  it('TC-M1-016 handles partial writes and CRLF framing', async () => {
    sidecar = await startSidecar();
    const response = rawResponse(10);
    sidecar.writeChunk('{"jsonrpc":"2.0","id":10,');
    sidecar.writeChunk('"method":"system.ping","params":{}}\r\n');
    await expect(response).resolves.toMatchObject({ result: { version: '0.1.0' }, id: 10 });
  }, 30_000);
});
