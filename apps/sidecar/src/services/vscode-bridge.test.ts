import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../infra/logger.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { projectIdSchema } from '../validation/brand.js';
import { VSCodeBridge, type VscodeBridgeTimers } from './vscode-bridge.js';

const directories: string[] = [];
const bridges: VSCodeBridge[] = [];
const sessionSchema = z.object({ port: z.number(), token: z.string() });

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function manualTimers() {
  let nextHandle = 0;
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const clock: VscodeBridgeTimers = {
    setTimeout: (callback) => {
      const handle = ++nextHandle;
      timeouts.set(handle, callback);
      return handle;
    },
    clearTimeout: (handle) => timeouts.delete(handle as number),
    setInterval: (callback) => {
      const handle = ++nextHandle;
      intervals.set(handle, callback);
      return handle;
    },
    clearInterval: (handle) => intervals.delete(handle as number),
  };
  return {
    clock,
    fireTimeout() {
      const [handle, callback] = timeouts.entries().next().value ?? [];
      if (typeof handle === 'number' && callback !== undefined) {
        timeouts.delete(handle);
        callback();
      }
    },
    fireInterval() {
      for (const callback of intervals.values()) callback();
    },
  };
}

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'itstudio-vscode-bridge-'));
  directories.push(root);
  const statuses: unknown[] = [];
  const diagnostics: unknown[] = [];
  const savedFiles: unknown[] = [];
  const timer = manualTimers();
  const bridge = new VSCodeBridge({
    ids: createFakeIdGenerator(['a1111111-1111-4111-8111-111111111111']),
    logger: createLogger({ streams: [] }),
    timers: timer.clock,
    randomToken: () => 'a'.repeat(64),
    events: {
      publishStatus: (value) => statuses.push(value),
      publishDiagnostics: (value) => diagnostics.push(value),
      publishInternal: (value) => savedFiles.push(value),
    },
    realpath: (path) => Promise.resolve(path),
  });
  bridges.push(bridge);
  await bridge.activate(projectIdSchema.parse('b1111111-1111-4111-8111-111111111111'), root);
  const sessionJson: unknown = JSON.parse(readFileSync(join(root, '.itstudio', 'session.json'), 'utf8'));
  const session = sessionSchema.parse(sessionJson);
  return { bridge, root, session, statuses, diagnostics, savedFiles, timer };
}

function connect(port: number, options: { readonly origin?: string } = {}): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${String(port)}`, {
    ...(options.origin === undefined ? {} : { headers: { Origin: options.origin } }),
  });
}

function hello(socket: WebSocket, token: string, workspaceRoot: string, protocolVersion = 1): void {
  socket.send(JSON.stringify({ type: 'hello', protocolVersion, token, workspaceRoot, extensionVersion: 'test' }));
}

describe('VSCodeBridge', () => {
  it('authenticates a hello, sends welcome, and publishes diagnostics and internal saves', async () => {
    const state = await setup();
    const socket = connect(state.session.port);
    try {
      const firstMessage = new Promise<string>((resolveMessage, reject) => {
        socket.once('open', () => {
          hello(socket, state.session.token, state.root);
        });
        socket.once('message', (data) => {
          resolveMessage(Buffer.isBuffer(data) ? data.toString('utf8') : '');
        });
        socket.once('error', reject);
      });
      const welcomeJson: unknown = JSON.parse(await firstMessage);
      expect(z.object({ type: z.literal('welcome'), sessionId: z.string() }).parse(welcomeJson)).toMatchObject({
        type: 'welcome',
      });
      expect(state.statuses).toHaveLength(1);
      socket.send(JSON.stringify({ type: 'diagnostics', diagnostics: [] }));
      socket.send(JSON.stringify({ type: 'file_saved_by_user', path: 'src/a.ts', hash: 'a'.repeat(64) }));
      socket.send('{broken');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      expect(state.diagnostics).toHaveLength(1);
      expect(state.savedFiles).toHaveLength(1);
    } finally {
      socket.close();
    }
  });

  it('rejects bad tokens, protocol versions, roots, browser origins, and expired handshakes', async () => {
    const state = await setup();
    for (const attempt of [
      { token: 'b'.repeat(64), root: state.root, version: 1 },
      { token: state.session.token, root: `${state.root}-wrong`, version: 1 },
      { token: state.session.token, root: state.root, version: 2 },
    ]) {
      const socket = connect(state.session.port);
      const code = new Promise<number>((resolveCode) =>
        socket.once('close', (value) => {
          resolveCode(value);
        }),
      );
      socket.once('open', () => {
        hello(socket, attempt.token, attempt.root, attempt.version);
      });
      expect([4400, 4401]).toContain(await code);
    }
    const browser = connect(state.session.port, { origin: 'https://example.test' });
    await expect(
      new Promise<void>((resolveOpen, reject) => {
        browser.once('open', resolveOpen);
        browser.once('unexpected-response', (_request, response) => {
          response.resume();
          reject(new Error(`HTTP ${String(response.statusCode)}`));
        });
        browser.once('error', reject);
      }),
    ).rejects.toThrow('HTTP 403');

    const silent = connect(state.session.port);
    const timeoutCode = new Promise<number>((resolveCode) =>
      silent.once('close', (value) => {
        resolveCode(value);
      }),
    );
    await new Promise<void>((resolveOpen) => silent.once('open', resolveOpen));
    state.timer.fireTimeout();
    expect(await timeoutCode).toBe(4400);
  });

  it('closes after two missed heartbeat replies and publishes disconnected status', async () => {
    const state = await setup();
    const socket = connect(state.session.port);
    const closed = new Promise<number>((resolveCode) =>
      socket.once('close', (value) => {
        resolveCode(value);
      }),
    );
    socket.once('open', () => {
      hello(socket, state.session.token, state.root);
    });
    await new Promise<void>((resolveWelcome) =>
      socket.once('message', () => {
        resolveWelcome();
      }),
    );
    state.timer.fireInterval();
    state.timer.fireInterval();
    state.timer.fireInterval();
    expect(await closed).toBe(4400);
    expect(state.statuses).toHaveLength(2);
    expect(state.statuses[1]).toMatchObject({ connected: false });
  });
});
