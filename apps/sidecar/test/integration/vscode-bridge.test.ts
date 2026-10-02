import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { projectSchema } from '../../src/validation/projects.js';
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
});
