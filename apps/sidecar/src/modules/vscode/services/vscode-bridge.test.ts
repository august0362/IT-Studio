import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../../../kernel/infra/logger.js';
import { createFakeIdGenerator } from '../../../kernel/infra/id.js';
import { projectIdSchema, workspaceRelativePathSchema } from '../../../kernel/validation/brand.js';
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
  let now = 0;
  const due = new Map<number, number>();
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const clock: VscodeBridgeTimers = {
    setTimeout: (callback, delayMs) => {
      due.set(nextHandle + 1, now + delayMs);
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
    advance(ms: number) {
      now += ms;
      for (const [handle, callback] of timeouts) {
        if ((due.get(handle) ?? Infinity) <= now) {
          timeouts.delete(handle);
          callback();
        }
      }
    },
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

async function setup(options: { readonly useDefaultTimers?: boolean; readonly failRealpath?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'itstudio-vscode-bridge-'));
  directories.push(root);
  const statuses: unknown[] = [];
  const diagnostics: unknown[] = [];
  const savedFiles: unknown[] = [];
  const activities: unknown[] = [];
  const timer = manualTimers();
  const logger = createLogger({ streams: [] });
  const warn = vi.spyOn(logger, 'warn');
  const info = vi.spyOn(logger, 'info');
  const closed = vi.fn();
  const bridge = new VSCodeBridge({
    ids: createFakeIdGenerator(['a1111111-1111-4111-8111-111111111111']),
    logger,
    ...(options.useDefaultTimers ? {} : { timers: timer.clock }),
    randomToken: () => 'a'.repeat(64),
    events: {
      windowClosed: closed,
      publishStatus: (value) => statuses.push(value),
      publishDiagnostics: (value) => diagnostics.push(value),
      publishInternal: (value) => savedFiles.push(value),
      publishActivity: (value) => activities.push(value),
    },
    realpath: (path) =>
      options.failRealpath ? Promise.reject(new Error('workspace unavailable')) : Promise.resolve(path),
  });
  bridges.push(bridge);
  await bridge.activate(projectIdSchema.parse('b1111111-1111-4111-8111-111111111111'), root);
  const sessionJson: unknown = JSON.parse(readFileSync(join(root, '.itstudio', 'session.json'), 'utf8'));
  const session = sessionSchema.parse(sessionJson);
  return { bridge, root, session, statuses, diagnostics, savedFiles, activities, timer, warn, info, closed };
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
  it('rejects a browser Origin header before opening a client session', async () => {
    const state = await setup();
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
    expect(state.statuses).toEqual([]);
  });

  it('uses the default timers for handshake cleanup and authenticated heartbeat lifecycle', async () => {
    const state = await setup({ useDefaultTimers: true });
    const socket = connect(state.session.port);
    await new Promise<void>((resolveWelcome, reject) => {
      socket.once('open', () => {
        hello(socket, state.session.token, state.root);
      });
      socket.once('message', () => {
        resolveWelcome();
      });
      socket.once('error', reject);
    });
    const closed = new Promise<void>((resolveClose) => socket.once('close', resolveClose));
    socket.close();
    await closed;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
    expect(state.statuses.at(-1)).toMatchObject({ connected: false });
  });

  it('rejects a matching token when workspace realpath validation fails', async () => {
    const state = await setup({ failRealpath: true });
    const socket = connect(state.session.port);
    const closed = new Promise<number>((resolveCode) => socket.once('close', resolveCode));
    socket.once('open', () => {
      hello(socket, state.session.token, state.root);
    });
    expect(await closed).toBe(4401);
  });

  it('authenticates a hello, sends welcome, and publishes diagnostics and internal saves', async () => {
    const state = await setup();
    state.bridge.send({ type: 'reveal', ref: 0, path: workspaceRelativePathSchema.parse('src/a.ts'), line: 1 });
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
      const outbound = new Promise<string>((resolveMessage) => {
        socket.once('message', (data) => {
          resolveMessage(Buffer.isBuffer(data) ? data.toString('utf8') : '');
        });
      });
      state.bridge.send({ type: 'reveal', ref: 0, path: workspaceRelativePathSchema.parse('src/a.ts'), line: 1 });
      expect(JSON.parse(await outbound)).toMatchObject({ type: 'reveal', ref: 1, path: 'src/a.ts', line: 1 });
      socket.send(JSON.stringify({ type: 'ack', ref: 1 }));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      expect(state.activities).toEqual([
        {
          type: 'vscode',
          phase: 'sent',
          projectId: 'b1111111-1111-4111-8111-111111111111',
          action: 'reveal',
          path: 'src/a.ts',
        },
        {
          type: 'vscode',
          phase: 'acked',
          projectId: 'b1111111-1111-4111-8111-111111111111',
          action: 'reveal',
          path: 'src/a.ts',
        },
      ]);
      expect(state.statuses).toHaveLength(1);
      socket.send(JSON.stringify({ type: 'diagnostics', diagnostics: [] }));
      socket.send(JSON.stringify({ type: 'file_saved_by_user', path: 'src/a.ts', hash: 'a'.repeat(64) }));
      socket.send(JSON.stringify({ type: 'diagnostics', diagnostics: [{ source: 'wrong', severity: 'error' }] }));
      socket.send(JSON.stringify({ type: 'file_saved_by_user', path: '../outside.ts', hash: 'bad' }));
      socket.send('{broken');
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      expect(state.diagnostics).toHaveLength(1);
      expect(state.savedFiles).toHaveLength(1);
      expect(state.diagnostics[0]).toMatchObject({
        projectId: 'b1111111-1111-4111-8111-111111111111',
        diagnostics: [],
      });
      expect(state.savedFiles[0]).toMatchObject({
        projectId: 'b1111111-1111-4111-8111-111111111111',
        path: 'src/a.ts',
        hash: 'a'.repeat(64),
      });
    } finally {
      socket.close();
    }
  });

  it('TC-M7-005 closes a client that sends no hello within the handshake timeout', async () => {
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

const projectA = projectIdSchema.parse('b1111111-1111-4111-8111-111111111111');
const projectB = projectIdSchema.parse('b2222222-2222-4222-8222-222222222222');
const closeSettings = {
  autoLaunch: true,
  codeExecutable: null,
  showDiffBeforeValidate: true,
  revealChangedFiles: true,
  closeWithStudio: true,
  closeWithProject: true,
  closeManuallyOpened: false,
};

async function connectWindow(state: Awaited<ReturnType<typeof setup>>, root = state.root) {
  const socket = connect(state.session.port);
  await new Promise<void>((resolveWelcome, reject) => {
    socket.once('error', reject);
    socket.once('open', () => {
      hello(socket, state.session.token, root);
    });
    socket.once('message', () => {
      resolveWelcome();
    });
  });
  const frames: unknown[] = [];
  socket.on('message', (data) => {
    const parsed = z
      .object({ type: z.string(), ref: z.number().optional() })
      .parse(JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : '') as unknown);
    frames.push(JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : '') as unknown);
    if (parsed.type === 'close_window') socket.send(JSON.stringify({ type: 'ack', ref: parsed.ref, closed: true }));
  });
  return { socket, frames };
}

describe('VSC-01 window ownership and closing', () => {
  it.each(['project_closed', 'project_deleted'] as const)(
    'closes only the launched project session on %s, with manual windows opt-in',
    async (reason) => {
      const state = await setup();
      state.bridge.recordLaunch(projectA, state.root, 10);
      const launched = await connectWindow(state);
      const manual = await connectWindow(state);
      const rootB = mkdtempSync(join(tmpdir(), 'itstudio-vscode-b-'));
      directories.push(rootB);
      await state.bridge.activate(projectB, rootB);
      state.bridge.recordLaunch(projectB, rootB, 20);
      const other = await connectWindow(state, rootB);
      await state.bridge.closeWindows(closeSettings, reason, projectA);
      expect(launched.frames).toEqual([expect.objectContaining({ type: 'close_window', reason })]);
      expect(manual.frames).toEqual([]);
      expect(other.frames).toEqual([]);
      expect(state.closed).toHaveBeenCalledWith(projectA, state.root, reason);
      await state.bridge.closeWindows({ ...closeSettings, closeManuallyOpened: true }, reason, projectA);
      expect(manual.frames).toEqual([expect.objectContaining({ type: 'close_window', reason })]);
      expect(other.frames).toEqual([]);
    },
  );

  it('clears launched ownership on disconnect so a later manual window stays open', async () => {
    const state = await setup();
    state.bridge.recordLaunch(projectA, state.root, 10);
    const launched = await connectWindow(state);
    const disconnected = new Promise<void>((resolve) =>
      launched.socket.once('close', () => {
        resolve();
      }),
    );
    launched.socket.close();
    await disconnected;
    const manual = await connectWindow(state);
    await state.bridge.closeWindows(closeSettings, 'project_closed', projectA);
    expect(manual.frames).toEqual([]);
  });

  it('sends nothing when the project or studio toggle is off', async () => {
    const state = await setup();
    state.bridge.recordLaunch(projectA, state.root, 10);
    const window = await connectWindow(state);
    await state.bridge.closeWindows({ ...closeSettings, closeWithProject: false }, 'project_closed', projectA);
    await state.bridge.closeWindows({ ...closeSettings, closeWithStudio: false }, 'studio_exit');
    expect(window.frames).toEqual([]);
  });

  it('sends exit to every owned project at once, logs older extension timeouts, and waits at most 2 seconds', async () => {
    const state = await setup();
    state.bridge.recordLaunch(projectA, state.root, 10);
    const first = await connectWindow(state);
    const rootB = mkdtempSync(join(tmpdir(), 'itstudio-vscode-b-'));
    directories.push(rootB);
    await state.bridge.activate(projectB, rootB);
    state.bridge.recordLaunch(projectB, rootB, 20);
    const second = await connectWindow(state, rootB);
    first.socket.removeAllListeners('message');
    second.socket.removeAllListeners('message');
    const received = [first, second].map(
      ({ socket }) =>
        new Promise<unknown>((resolve) =>
          socket.once('message', (data) => {
            resolve(JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : '') as unknown);
          }),
        ),
    );
    let finished = false;
    const closing = state.bridge.closeWindows(closeSettings, 'studio_exit').then(() => {
      finished = true;
    });
    expect(await Promise.all(received)).toEqual([
      expect.objectContaining({ type: 'close_window', reason: 'studio_exit' }),
      expect.objectContaining({ type: 'close_window', reason: 'studio_exit' }),
    ]);
    state.timer.advance(1999);
    await Promise.resolve();
    expect(finished).toBe(false);
    state.timer.advance(1);
    await closing;
    expect(finished).toBe(true);
    expect(state.warn).toHaveBeenCalledTimes(2);
    expect(state.warn).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'timeout', reason: 'studio_exit' }),
      expect.stringContaining('older'),
    );
  });

  it('logs project timeout at 3 seconds and a cancelled close without marking the process closed', async () => {
    const state = await setup();
    state.bridge.recordLaunch(projectA, state.root, 10);
    const window = await connectWindow(state);
    window.socket.removeAllListeners('message');
    const received = new Promise<number>((resolve) =>
      window.socket.once('message', (data) => {
        resolve(
          z.object({ ref: z.number() }).parse(JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : '') as unknown)
            .ref,
        );
      }),
    );
    const closing = state.bridge.closeWindows(closeSettings, 'project_closed', projectA);
    const ref = await received;
    window.socket.send(JSON.stringify({ type: 'ack', ref, closed: false }));
    await closing;
    expect(state.closed).not.toHaveBeenCalled();
    expect(state.info).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'cancelled' }), expect.any(String));
    const timeout = state.bridge.closeWindows(closeSettings, 'project_deleted', projectA);
    state.timer.advance(3000);
    await timeout;
    expect(state.warn).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'timeout' }), expect.any(String));
  });
});

describe('VSC-01 unsaved work after the ack deadline', () => {
  it('records a window that closes after a long unsaved-work prompt', async () => {
    const state = await setup();
    state.bridge.recordLaunch(projectA, state.root, 10);
    const window = await connectWindow(state);
    window.socket.removeAllListeners('message');
    const closing = state.bridge.closeWindows(closeSettings, 'project_closed', projectA);
    state.timer.advance(3000);
    await closing;
    expect(state.closed).not.toHaveBeenCalled();
    const disconnected = new Promise<void>((resolve) =>
      window.socket.once('close', () => {
        resolve();
      }),
    );
    window.socket.close();
    await disconnected;
    await vi.waitFor(() => {
      expect(state.closed).toHaveBeenCalledWith(projectA, state.root, 'project_closed');
    });
  });
});
