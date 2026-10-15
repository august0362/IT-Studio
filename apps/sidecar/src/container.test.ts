import { PassThrough } from 'node:stream';
import { Writable } from 'node:stream';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from './infra/logger.js';
import { createFakeClock } from './infra/clock.js';
import { createContainer, scriptedLlmProvider } from './container.js';
import { MemorySecretStore } from './infra/memory-secret-store.js';
import type { IProviderKeyVerifier } from './infra/http/provider-key-verifier.js';
import { ProviderId } from '@itstudio/schemas';
import type { IHttpClient } from './ports/http-client.js';
import type { ProviderRequest } from './ports/llm-provider.js';
import type { SecretHistoryEntry } from '@itstudio/schemas';
import type { ISecretHistoryRepository } from './infra/sqlite/secret-history-repository.js';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLine(line: string): Record<string, unknown> {
  const value: unknown = JSON.parse(line);
  if (!isJsonObject(value)) throw new Error('Expected JSON object');
  return value;
}

const tempDirectories: string[] = [];
function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'itstudio-container-'));
  tempDirectories.push(dataDir);
  return dataDir;
}

const testFxHttpClient: IHttpClient = {
  request: () => Promise.resolve(Response.json({ rates: { VND: 26_300 } })),
};

describe('sidecar container', () => {
  it('verifies saves deletes and reads masked history through the migrated production repository', async () => {
    const store = new MemorySecretStore();
    const clock = createFakeClock(new Date('2026-10-04T00:00:00.000Z'));
    const container = createContainer(
      {},
      {
        dataDir: makeDataDir(),
        clock,
        secretStore: store,
        keyVerifier: { verify: () => Promise.resolve({ ok: true, value: undefined }) },
        fxHttpClient: testFxHttpClient,
        logger: createLogger({ streams: [] }),
      },
    );
    try {
      expect(await container.secretsService.verifyAndSave(ProviderId.OPENAI, 'candidate-test-key-1234')).toMatchObject({
        ok: true,
        value: { configured: true, hint: '1234' },
      });
      expect(container.secretsService.history(ProviderId.OPENAI)).toMatchObject({
        ok: true,
        value: [{ action: 'saved', hint: '1234' }],
      });
      clock.advance(1000);
      expect(await container.secretsService.delete(ProviderId.OPENAI)).toMatchObject({
        ok: true,
        value: { configured: false },
      });
      const history = container.secretsService.history(ProviderId.OPENAI);
      expect(history.ok && history.value.map((entry) => entry.action)).toEqual(['deleted', 'saved']);
      expect(JSON.stringify(history)).not.toContain('candidate-test-key');
      expect(await store.get(ProviderId.OPENAI)).toEqual({ ok: true, value: null });
    } finally {
      container.database.client.close();
    }
  });

  it('scripts a tool call and then returns the follow-up assistant text', async () => {
    const modelId = 'scripted-model';
    const provider = scriptedLlmProvider(
      ProviderId.ANTHROPIC,
      'Image created.',
      { [`anthropic/${modelId}`]: ['tool:{"name":"generate_image","arguments":{"prompt":"a blue bird"}}', 'ok'] },
      new Map(),
    );
    const request: ProviderRequest = {
      modelId,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Generate a blue bird image' }] }],
      maxOutputTokens: 128,
      responseFormat: 'text',
      timeoutMs: 1_000,
    };

    const streamedText: string[] = [];
    const toolResponse = await provider.stream(request, 'test-key', new AbortController().signal, (text) => {
      streamedText.push(text);
    });
    expect(streamedText).toEqual([]);
    expect(toolResponse).toMatchObject({
      ok: true,
      value: {
        text: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'call_scripted', name: 'generate_image', arguments: { prompt: 'a blue bird' } }],
      },
    });
    const followUp = await provider.complete(request, 'test-key', new AbortController().signal);
    expect(followUp).toMatchObject({
      ok: true,
      value: { text: 'Image created.', finishReason: 'stop', toolCalls: [] },
    });
  });

  it('captures scripted LLM request messages as JSON lines when capture is enabled', async () => {
    const capturePath = join(makeDataDir(), 'llm-capture.jsonl');
    const provider = scriptedLlmProvider(ProviderId.ANTHROPIC, 'Captured response.', {}, new Map(), capturePath);
    const request: ProviderRequest = {
      modelId: 'capture-model',
      system: 'Captured system prompt.',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'capture this prompt' }] }],
      maxOutputTokens: 128,
      responseFormat: 'text',
      timeoutMs: 1_000,
    };

    await provider.complete(request, 'test-key', new AbortController().signal);

    const captured = readFileSync(capturePath, 'utf8').trim().split('\n').map(parseLine);
    expect(captured).toEqual([{ system: request.system, messages: request.messages }]);
  });

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
        dataDir: makeDataDir(),
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
      let responseLine = lines.find((line) => parseLine(line).id === id);
      for (let attempt = 0; responseLine === undefined && attempt < 100; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        responseLine = lines.find((line) => parseLine(line).id === id);
      }
      if (responseLine === undefined) throw new Error(`No RPC response received for request ${String(id)}`);
      const response = parseLine(responseLine);
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
    const entries: SecretHistoryEntry[] = [];
    const secretHistoryRepository: ISecretHistoryRepository = {
      append: (entry) => entries.unshift(entry),
      list: (provider, limit) =>
        entries.filter((entry) => provider === undefined || entry.provider === provider).slice(0, limit),
    };
    const secret = 'rpc-secret-that-must-not-leak';
    const verifier: IProviderKeyVerifier = { verify: () => Promise.resolve({ ok: true, value: undefined }) };
    const container = createContainer(
      {},
      {
        input,
        output,
        fxHttpClient: testFxHttpClient,
        dataDir: makeDataDir(),
        secretStore: new MemorySecretStore(),
        secretHistoryRepository,
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
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'secrets.verifyAndSave', params: { provider: ProviderId.GOOGLE, apiKey: 'candidate-key-9876' } })}\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'secrets.history', params: { limit: 10 } })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(JSON.stringify(lines.map(parseLine))).not.toContain(secret);
    expect(JSON.stringify(lines.map(parseLine))).not.toContain('candidate-key-9876');
    expect(lines.map(parseLine).find((line) => line.id === 4)?.result).toMatchObject([
      { provider: 'google', hint: '9876', action: 'saved', resultCode: null },
    ]);
    expect(logs).not.toContain('candidate-key-9876');
    expect(logs).not.toContain(secret);
    container.database.client.close();
  });
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
