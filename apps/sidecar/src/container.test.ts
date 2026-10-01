import { PassThrough } from 'node:stream';
import { Writable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from './infra/logger.js';
import { createFakeClock } from './infra/clock.js';
import { createContainer } from './container.js';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (!isJsonObject(value)) throw new Error('Expected JSON object');
  return value;
}

const tempDirectories: string[] = [];

describe('sidecar container', () => {
  it('publishes ready first, then answers system.ping over injected streams', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    let pending = '';
    output.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const chunks = pending.split('\n');
      pending = chunks.pop() ?? '';
      lines.push(...chunks.filter(Boolean));
    });
    const container = createContainer(
      {},
      {
        input,
        output,
        clock: createFakeClock(),
        logger: createLogger({
          streams: [
            new Writable({
              write(_chunk, _encoding, callback) {
                callback();
              },
            }),
          ],
        }),
      },
    );
    container.start();
    input.write('{"jsonrpc":"2.0","id":1,"method":"system.ping","params":{}}\n');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parseLine(lines[0] ?? '{}')).toMatchObject({ method: 'system.ready' });
    const ping = parseLine(lines[1] ?? '{}');
    expect(ping.id).toBe(1);
    const result = ping.result;
    if (!isJsonObject(result)) throw new Error('Expected ping result');
    expect(typeof result.version).toBe('string');
    expect(result.uptimeMs).toBe(0);
  });

  it('round trips all project and settings RPC methods', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines: string[] = [];
    let pending = '';
    output.on('data', (chunk: Buffer) => {
      pending += chunk.toString('utf8');
      const chunks = pending.split('\n');
      pending = chunks.pop() ?? '';
      lines.push(...chunks.filter(Boolean));
    });
    const workspace = mkdtempSync(join(tmpdir(), 'itstudio-rpc-workspace-'));
    tempDirectories.push(workspace);
    const exitCodes: number[] = [];
    const container = createContainer(
      {},
      {
        input,
        output,
        dataDir: ':memory:',
        exit: (code) => exitCodes.push(code),
        logger: createLogger({
          streams: [
            new Writable({
              write(_chunk, _encoding, callback) {
                callback();
              },
            }),
          ],
        }),
      },
    );
    container.start();
    const request = async (id: number, method: string, params: Record<string, unknown>) => {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const response = parseLine(lines.find((line) => parseLine(line).id === id) ?? '{}');
      expect(response.error).toBeUndefined();
      return response.result;
    };
    await request(1, 'settings.get', {});
    const updated = await request(2, 'settings.update', { patch: { ui: { locale: 'vi' } } });
    expect(updated).toMatchObject({ ui: { locale: 'vi' } });
    const created = await request(3, 'project.create', { name: 'RPC', workspaceRoot: workspace });
    expect(created).toMatchObject({ name: 'RPC', workspaceRoot: workspace });
    const listing = await request(4, 'project.list', {});
    expect(listing).toEqual([created]);
    if (!isJsonObject(created) || typeof created.id !== 'string') throw new Error('Project RPC did not return an id');
    const active = await request(5, 'project.setActive', { projectId: created.id });
    expect(active).toEqual(created);
    await request(6, 'system.shutdown', {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(exitCodes).toEqual([0]);
    container.database.client.close();
  });
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
