import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { projectSchema } from '../../src/validation/projects.js';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { pipelineRunSchema } from '../../src/validation/pipeline.js';
import { providerIdSchema } from '../../src/validation/common.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;
let workspace: string | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe('VS Code bridge integration', () => {
  it('TC-M7-001 writes the session, completes a loopback handshake and publishes connected status', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-e2e-'));
    workspace = activeWorkspace;
    const project = await sidecar.call('project.create', { name: 'VS Code E2E', workspaceRoot: activeWorkspace });
    const parsedProject = projectSchema.safeParse(project.result);
    if (!parsedProject.success) {
      throw new Error('Project creation did not return a project');
    }
    await sidecar.call('project.setActive', { projectId: parsedProject.data.id });
    const sessionSchema = z.object({ port: z.number(), token: z.string(), protocolVersion: z.number() });
    const sessionJson: unknown = JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8'));
    const session = sessionSchema.parse(sessionJson);
    expect(session.protocolVersion).toBe(1);
    expect(session.token).toMatch(/^[a-f0-9]{64}$/u);

    const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
    try {
      const welcome = new Promise<unknown>((resolveWelcome, reject) => {
        socket.once('open', () => {
          socket.send(
            JSON.stringify({
              type: 'hello',
              protocolVersion: 1,
              token: session.token,
              workspaceRoot: activeWorkspace,
              extensionVersion: 'test',
            }),
          );
        });
        socket.once('message', (data) => {
          const text = Buffer.isBuffer(data) ? data.toString('utf8') : '';
          const parsed: unknown = JSON.parse(text);
          resolveWelcome(z.object({ type: z.literal('welcome'), sessionId: z.string() }).parse(parsed));
        });
        socket.once('error', reject);
      });
      const welcomeMessage = z.object({ type: z.literal('welcome'), sessionId: z.string() }).parse(await welcome);
      expect(welcomeMessage.type).toBe('welcome');
      expect(typeof welcomeMessage.sessionId).toBe('string');
      await waitFor(
        () =>
          sidecar?.stdoutLines.some(
            (line) => line.includes('"method":"vscode.status"') && line.includes('"connected":true'),
          ) ?? false,
      );
    } finally {
      socket.close();
    }
  }, 30_000);

  it('TC-M7-002 rejects a wrong token without publishing connected status', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-wrong-token-'));
    workspace = activeWorkspace;
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Wrong token', workspaceRoot: activeWorkspace })).result,
    );
    await sidecar.call('project.setActive', { projectId: project.id });
    const session = z
      .object({ port: z.number(), token: z.string(), protocolVersion: z.number() })
      .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
    const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
    let welcomed = false;
    socket.on('message', () => {
      welcomed = true;
    });
    const closed = new Promise<{ readonly code: number; readonly reason: string }>((resolveClose) => {
      socket.once('close', (code, reason) => {
        resolveClose({ code, reason: reason.toString() });
      });
    });
    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          protocolVersion: session.protocolVersion,
          token: '0'.repeat(64),
          workspaceRoot: activeWorkspace,
          extensionVersion: 'test',
        }),
      );
    });
    const result = await closed;
    expect(result.code).toBe(4401);
    expect(result.reason).toBe('Authentication failed');
    expect(welcomed).toBe(false);
    expect(sidecar.stdoutLines.some((line) => line.includes('"connected":true'))).toBe(false);
  }, 30_000);

  it('TC-M7-003 rejects browser Origin headers before WebSocket handshake', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-origin-'));
    workspace = activeWorkspace;
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Origin check', workspaceRoot: activeWorkspace })).result,
    );
    await sidecar.call('project.setActive', { projectId: project.id });
    const session = z
      .object({ port: z.number() })
      .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
    const browser = new WebSocket(`ws://127.0.0.1:${String(session.port)}`, {
      headers: { Origin: 'https://example.test' },
    });
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
  }, 30_000);

  it('TC-M7-004 closes a protocol version mismatch with a clear reason', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-version-'));
    workspace = activeWorkspace;
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Protocol version', workspaceRoot: activeWorkspace })).result,
    );
    await sidecar.call('project.setActive', { projectId: project.id });
    const session = z
      .object({ port: z.number(), token: z.string() })
      .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
    const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
    const closed = new Promise<{ readonly code: number; readonly reason: string }>((resolveClose) => {
      socket.once('close', (code, reason) => {
        resolveClose({ code, reason: reason.toString() });
      });
    });
    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          type: 'hello',
          protocolVersion: 2,
          token: session.token,
          workspaceRoot: activeWorkspace,
          extensionVersion: 'test',
        }),
      );
    });
    expect(await closed).toEqual({ code: 4401, reason: 'Invalid hello' });
  }, 30_000);

  it('TC-M7-006 exposes the bridge through its loopback session endpoint', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-loopback-'));
    workspace = activeWorkspace;
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Loopback', workspaceRoot: activeWorkspace })).result,
    );
    await sidecar.call('project.setActive', { projectId: project.id });
    const session = z
      .object({ port: z.number(), token: z.string() })
      .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
    const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
    const greeting = new Promise<string>((resolveMessage, reject) => {
      socket.once('open', () => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion: 1,
            token: session.token,
            workspaceRoot: activeWorkspace,
            extensionVersion: 'test',
          }),
        );
      });
      socket.once('message', (data) => {
        resolveMessage(Buffer.isBuffer(data) ? data.toString('utf8') : '');
      });
      socket.once('error', reject);
    });
    expect(JSON.parse(await greeting)).toMatchObject({ type: 'welcome' });
    socket.close();
  }, 30_000);

  it('TC-M7-007 rotates the session token after sidecar restart and rejects the old token', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-rotation-'));
    workspace = activeWorkspace;
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Rotation', workspaceRoot: activeWorkspace })).result,
    );
    await sidecar.call('project.setActive', { projectId: project.id });
    const sessionSchema = z.object({ port: z.number(), token: z.string(), protocolVersion: z.number() });
    const readSession = async () =>
      sessionSchema.parse(
        JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown,
      );
    const previous = await readSession();
    await sidecar.restart();
    await sidecar.call('project.setActive', { projectId: project.id });
    const current = await readSession();
    expect(current.token).not.toBe(previous.token);
    const stale = new WebSocket(`ws://127.0.0.1:${String(current.port)}`);
    const staleClosed = new Promise<number>((resolveClose) => stale.once('close', resolveClose));
    stale.once('open', () => {
      stale.send(
        JSON.stringify({
          type: 'hello',
          protocolVersion: previous.protocolVersion,
          token: previous.token,
          workspaceRoot: activeWorkspace,
          extensionVersion: 'test',
        }),
      );
    });
    expect(await staleClosed).toBe(4401);
  }, 30_000);

  it('TC-M7-023 drops malformed extension messages without crashing the sidecar', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-malformed-'));
    workspace = activeWorkspace;
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Malformed messages', workspaceRoot: activeWorkspace })).result,
    );
    await sidecar.call('project.setActive', { projectId: project.id });
    const session = z
      .object({ port: z.number(), token: z.string() })
      .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
    const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
    const welcomed = new Promise<void>((resolveWelcome, reject) => {
      socket.once('open', () => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion: 1,
            token: session.token,
            workspaceRoot: activeWorkspace,
            extensionVersion: 'test',
          }),
        );
      });
      socket.once('message', () => {
        resolveWelcome();
      });
      socket.once('error', reject);
    });
    await welcomed;
    socket.send(JSON.stringify({ type: 'diagnostics', diagnostics: [{ malformed: true }] }));
    socket.send(JSON.stringify({ type: 'file_saved_by_user', path: '../outside.ts', hash: 'invalid' }));
    socket.send('{malformed json');
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect((await sidecar.call('settings.get')).error).toBeUndefined();
    socket.close();
  }, 30_000);

  it('TC-M7-031 reconnects a client with the same session file', async () => {
    sidecar = await startSidecar();
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-reconnect-'));
    workspace = activeWorkspace;
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Reconnect', workspaceRoot: activeWorkspace })).result,
    );
    await sidecar.call('project.setActive', { projectId: project.id });
    const session = z
      .object({ port: z.number(), token: z.string() })
      .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
    const connect = async (): Promise<WebSocket> => {
      const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
      await new Promise<void>((resolveWelcome, reject) => {
        socket.once('open', () => {
          socket.send(
            JSON.stringify({
              type: 'hello',
              protocolVersion: 1,
              token: session.token,
              workspaceRoot: activeWorkspace,
              extensionVersion: 'test',
            }),
          );
        });
        socket.once('message', () => {
          resolveWelcome();
        });
        socket.once('error', reject);
      });
      return socket;
    };
    const first = await connect();
    first.close();
    await waitFor(() => sidecar?.stdoutLines.filter((line) => line.includes('"connected":false')).length === 1);
    const second = await connect();
    await waitFor(() => sidecar?.stdoutLines.filter((line) => line.includes('"connected":true')).length === 2);
    second.close();
  }, 30_000);

  it('TC-M7-032 closes a connected client with 1001 when stdin reaches EOF', async () => {
    const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const mainPath = resolve(sidecarRoot, 'src/main.ts');
    const dataDir = await mkdtemp(join(tmpdir(), 'itstudio-vscode-eof-data-'));
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-eof-workspace-'));
    workspace = activeWorkspace;
    const processChild = spawn(process.execPath, ['--import', 'tsx', mainPath], {
      cwd: sidecarRoot,
      env: { ...process.env, ITSTUDIO_DATA_DIR: dataDir, ITSTUDIO_E2E: '1', ITSTUDIO_LOG_LEVEL: 'info' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    const lines: string[] = [];
    let output = '';
    processChild.stdout.setEncoding('utf8');
    processChild.stdout.on('data', (chunk: string) => {
      output += chunk;
      let newline = output.indexOf('\n');
      while (newline >= 0) {
        lines.push(output.slice(0, newline));
        output = output.slice(newline + 1);
        newline = output.indexOf('\n');
      }
    });
    processChild.stderr.resume();
    try {
      await waitFor(() => lines.some((line) => line.includes('"method":"system.ready"')));
      const call = async (id: number, method: string, params: unknown): Promise<unknown> => {
        processChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        await waitFor(() => lines.some((line) => line.includes(`"id":${String(id)}`)));
        const response: unknown = lines
          .map((line) => JSON.parse(line) as unknown)
          .find((line) => {
            const parsed = z.object({ id: z.number() }).safeParse(line);
            return parsed.success && parsed.data.id === id;
          });
        return z.object({ result: z.unknown() }).parse(response).result;
      };
      const project = projectSchema.parse(
        await call(1, 'project.create', { name: 'EOF connected', workspaceRoot: activeWorkspace }),
      );
      await call(2, 'project.setActive', { projectId: project.id });
      const session = z
        .object({ port: z.number(), token: z.string() })
        .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
      const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
      await new Promise<void>((resolveWelcome, reject) => {
        socket.once('open', () => {
          socket.send(
            JSON.stringify({
              type: 'hello',
              protocolVersion: 1,
              token: session.token,
              workspaceRoot: activeWorkspace,
              extensionVersion: 'test',
            }),
          );
        });
        socket.once('message', () => {
          resolveWelcome();
        });
        socket.once('error', reject);
      });
      const closed = new Promise<{ readonly code: number; readonly reason: string }>((resolveClose) => {
        socket.once('close', (code, reason) => {
          resolveClose({ code, reason: reason.toString() });
        });
      });
      const exit = once(processChild, 'exit');
      processChild.stdin.end();
      const [closedSocket, exitInfo] = await Promise.all([closed, exit]);
      expect(closedSocket.code).toBe(1001);
      expect(closedSocket.reason).toBe('Sidecar stopping');
      expect(exitInfo[0]).toBe(0);
    } finally {
      if (processChild.exitCode === null && processChild.signalCode === null) {
        processChild.kill('SIGKILL');
        await once(processChild, 'exit');
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('TC-M7-030 continues and completes pipeline validation after the VS Code client disconnects', async () => {
    const taskSpec = {
      title: 'Add greeting',
      userStory: 'Write a greeting file',
      acceptanceCriteria: ['The greeting file exists'],
      allowedPaths: ['src/greeting.txt'],
      contracts: '',
      constraints: [],
      testPlan: ['Check the file exists'],
      outOfScope: [],
    };
    const coderOutput = {
      summary: 'Create a greeting file',
      operations: [{ kind: 'create', path: 'src/greeting.txt', content: 'hello from pipeline' }],
      assumptions: [],
    };
    const scripts = {
      'anthropic/claude-opus-5-5': ['ok'],
      'openai/gpt-5.3-codex': ['ok'],
      'anthropic/claude-sonnet-5-5': ['ok'],
    };
    const responseTexts = {
      'claude-opus-5-5': JSON.stringify(taskSpec),
      'gpt-5.3-codex': JSON.stringify(coderOutput),
      'claude-sonnet-5-5': JSON.stringify({ approved: true, findings: [], summary: 'Approved' }),
    };
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: JSON.stringify(responseTexts) }, scripts);
    const activeWorkspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-pipeline-'));
    workspace = activeWorkspace;
    await mkdir(resolve(activeWorkspace, 'src'));
    const project = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Disconnect during validation', workspaceRoot: activeWorkspace }))
        .result,
    );
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const modelKeys = new Set([
      ...settings.pipeline.roleAssignment.pm,
      ...settings.pipeline.roleAssignment.coder,
      ...settings.pipeline.roleAssignment.reviewer,
    ]);
    for (const modelKey of modelKeys) {
      const provider = providerIdSchema.parse(modelKey.split('/')[0]);
      await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-key` });
    }
    await sidecar.call('settings.update', {
      patch: {
        pipeline: {
          validationCommands: [
            { kind: 'build', executable: 'node', args: ['-e', 'setTimeout(() => {}, 800)'], timeoutMs: 5000 },
          ],
        },
      },
    });
    await sidecar.call('project.setActive', { projectId: project.id });
    const session = z
      .object({ port: z.number(), token: z.string() })
      .parse(JSON.parse(await readFile(resolve(activeWorkspace, '.itstudio/session.json'), 'utf8')) as unknown);
    const socket = new WebSocket(`ws://127.0.0.1:${String(session.port)}`);
    await new Promise<void>((resolveWelcome, reject) => {
      socket.once('open', () => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersion: 1,
            token: session.token,
            workspaceRoot: activeWorkspace,
            extensionVersion: 'test',
          }),
        );
      });
      socket.once('message', () => {
        resolveWelcome();
      });
      socket.once('error', reject);
    });
    const started = await sidecar.call('pipeline.start', { projectId: project.id, prompt: 'Create a greeting file' });
    const runId = pipelineRunSchema.parse(started.result).id;
    const waitForStage = async (stage: string): Promise<void> => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const result = await sidecar?.call('pipeline.get', { runId });
        if (pipelineRunSchema.safeParse(result?.result).data?.stage === stage) return;
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
      }
      throw new Error(`Pipeline did not reach ${stage}`);
    };
    await waitForStage('validating');
    const disconnected = new Promise<void>((resolveClose) => socket.once('close', resolveClose));
    socket.close();
    await disconnected;
    await waitForStage('completed');
    expect(sidecar.stdoutLines.some((line) => line.includes('"connected":false'))).toBe(true);
    expect(await readFile(resolve(activeWorkspace, 'src/greeting.txt'), 'utf8')).toBe('hello from pipeline');
  }, 30_000);
});
