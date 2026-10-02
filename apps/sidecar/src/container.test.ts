import { PassThrough } from 'node:stream';
import { Writable } from 'node:stream';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from './infra/logger.js';
import { createFakeClock } from './infra/clock.js';
import { createContainer } from './container.js';
import { MemorySecretStore } from './infra/memory-secret-store.js';
import type { IProviderKeyVerifier } from './infra/http/provider-key-verifier.js';
import { ProviderId } from '@itstudio/schemas';
import type { IHttpClient } from './ports/http-client.js';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (!isJsonObject(value)) throw new Error('Expected JSON object');
  return value;
}

const tempDirectories: string[] = [];
const testFxHttpClient: IHttpClient = {
  request: () => Promise.resolve(Response.json({ rates: { VND: 26_300 } })),
};

describe('sidecar container', () => {
  it('logs lifecycle events in order and creates the daily log file', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'itstudio-lifecycle-'));
    tempDirectories.push(dataDir);
    const input = new PassThrough();
    const output = new PassThrough();
    const stdoutLines: string[] = [];
    let pendingOutput = '';
    output.on('data', (chunk: Buffer) => {
      pendingOutput += chunk.toString('utf8');
      const chunks = pendingOutput.split('\n');
      pendingOutput = chunks.pop() ?? '';
      stdoutLines.push(...chunks.filter(Boolean));
    });
    let logOutput = '';
    const exits: number[] = [];
    const container = createContainer(
      {},
      {
        input,
        output,
        fxHttpClient: testFxHttpClient,
        dataDir,
        exit: (code) => exits.push(code),
        secretStore: new MemorySecretStore(),
        logger: createLogger({
          dataDir,
          streams: [
            new Writable({
              write(chunk: Buffer, _encoding, callback) {
                logOutput += chunk.toString('utf8');
                callback();
              },
            }),
          ],
        }),
      },
    );

    container.start();
    input.write('{"jsonrpc":"2.0","id":1,"method":"system.shutdown","params":{}}\n');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const entries = logOutput
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { readonly msg: string; readonly svc?: string });
    const lifecycle = entries.filter((entry) => entry.svc === 'sidecar').map((entry) => entry.msg);
    expect(lifecycle).toEqual([
      'sidecar starting',
      'migrations applied',
      'seeds loaded',
      'sidecar ready',
      'shutdown requested',
      'sidecar exiting',
    ]);
    expect(entries.every((entry) => entry.svc === 'sidecar' || entry.svc === 'fx')).toBe(true);
    expect(stdoutLines.map(parseLine).some((line) => line.msg !== undefined)).toBe(false);
    expect(exits).toEqual([0]);
    container.database.client.close();

    const fileDataDir = mkdtempSync(join(tmpdir(), 'itstudio-lifecycle-file-'));
    tempDirectories.push(fileDataDir);
    const fileInput = new PassThrough();
    const fileContainer = createContainer(
      {},
      {
        input: fileInput,
        output: new PassThrough(),
        fxHttpClient: testFxHttpClient,
        dataDir: fileDataDir,
        exit: () => undefined,
        secretStore: new MemorySecretStore(),
        logger: createLogger({ dataDir: fileDataDir }),
      },
    );
    fileContainer.start();
    fileInput.write('{"jsonrpc":"2.0","id":2,"method":"system.shutdown","params":{}}\n');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const logFiles = readdirSync(join(fileDataDir, 'logs'));
    expect(logFiles).toHaveLength(1);
    const fileContents = readFileSync(join(fileDataDir, 'logs', logFiles[0] ?? ''), 'utf8');
    for (const message of lifecycle) expect(fileContents).toContain(`"msg":"${message}"`);
    fileContainer.database.client.close();
  });

  it('publishes ready first, then answers system.ping over injected streams', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'itstudio-ping-'));
    tempDirectories.push(dataDir);
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
        fxHttpClient: testFxHttpClient,
        dataDir,
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
    container.database.client.close();
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
        fxHttpClient: testFxHttpClient,
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
    const models = await request(0, 'models.list', {});
    expect(Array.isArray(models)).toBe(true);
    expect(models).toHaveLength(container.modelRegistry.list().length);
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

  it('returns secret statuses over RPC without returning or logging the API key', async () => {
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
    let logs = '';
    const secret = 'rpc-secret-that-must-not-leak';
    const verifier: IProviderKeyVerifier = { verify: () => Promise.resolve({ ok: true, value: undefined }) };
    const container = createContainer(
      {},
      {
        input,
        output,
        fxHttpClient: testFxHttpClient,
        dataDir: ':memory:',
        secretStore: new MemorySecretStore(),
        keyVerifier: verifier,
        logger: createLogger({
          streams: [
            new Writable({
              write(chunk: Buffer, _encoding, callback) {
                logs += chunk.toString();
                callback();
              },
            }),
          ],
        }),
      },
    );
    container.start();
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'secrets.set', params: { provider: ProviderId.OPENAI, apiKey: secret } })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = lines.map(parseLine).find((line) => line.id === 1);
    expect(response?.result).toEqual({ provider: ProviderId.OPENAI, configured: true, hint: 'leak' });
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'secrets.verify', params: { provider: ProviderId.OPENAI } })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(JSON.stringify(lines.map(parseLine))).not.toContain(secret);
    expect(logs).not.toContain(secret);
    container.database.client.close();
  });
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
