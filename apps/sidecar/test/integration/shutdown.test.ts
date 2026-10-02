import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { projectSchema } from '../../src/validation/projects.js';
import { waitFor } from './harness.js';

let child: ChildProcess | undefined;
let dataDir: string | undefined;
let workspace: string | undefined;

afterEach(async () => {
  if (child?.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
  child = undefined;
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true });
  dataDir = undefined;
  workspace = undefined;
});

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolveConnection) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolveConnection(true);
    });
    socket.once('error', () => {
      resolveConnection(false);
    });
  });
}

async function waitForPort(port: number, expected: boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await canConnect(port)) === expected) return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`Bridge port did not become ${expected ? 'available' : 'closed'}`);
}

describe('sidecar stdin shutdown integration', () => {
  it('TC-M1-020 exits cleanly and closes the bridge when stdin reaches EOF', async () => {
    const sidecarRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    const mainPath = resolve(sidecarRoot, 'src/main.ts');
    dataDir = await mkdtemp(join(tmpdir(), 'itstudio-shutdown-data-'));
    workspace = await mkdtemp(join(tmpdir(), 'itstudio-shutdown-workspace-'));
    const processChild = spawn(process.execPath, ['--import', 'tsx', mainPath], {
      cwd: sidecarRoot,
      env: { ...process.env, ITSTUDIO_DATA_DIR: dataDir, ITSTUDIO_E2E: '1', ITSTUDIO_LOG_LEVEL: 'info' },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    child = processChild;

    const stdoutLines: string[] = [];
    const stderr: string[] = [];
    let buffer = '';
    processChild.stdout.setEncoding('utf8');
    processChild.stderr.setEncoding('utf8');
    processChild.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        stdoutLines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    });
    processChild.stderr.on('data', (chunk: string) => stderr.push(chunk));

    await waitFor(
      () =>
        stdoutLines.some((line) => line.includes('"method":"system.ready"')) ||
        processChild.exitCode !== null ||
        processChild.signalCode !== null,
    );
    if (!stdoutLines.some((line) => line.includes('"method":"system.ready"'))) {
      throw new Error(`Sidecar exited before system.ready (${String(processChild.exitCode)}): ${stderr.join('')}`);
    }
    const rpcResult = async (id: number, method: string, params: unknown): Promise<unknown> => {
      processChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      await waitFor(() => stdoutLines.some((line) => line.includes(`"id":${String(id)}`)));
      const response = stdoutLines
        .map((line) => JSON.parse(line) as unknown)
        .find((line) => {
          const parsed = z.object({ id: z.number() }).safeParse(line);
          return parsed.success && parsed.data.id === id;
        });
      return z.object({ result: z.unknown() }).parse(response).result;
    };

    const project = projectSchema.parse(
      await rpcResult(1, 'project.create', { name: 'Shutdown test', workspaceRoot: workspace }),
    );
    await rpcResult(2, 'project.setActive', { projectId: project.id });
    const sessionSchema = z.object({ port: z.number() });
    const session = sessionSchema.parse(
      JSON.parse(await readFile(join(workspace, '.itstudio/session.json'), 'utf8')) as unknown,
    );
    await waitForPort(session.port, true);
    expect(await canConnect(session.port)).toBe(true);

    const exitPromise = once(processChild, 'exit');
    processChild.stdin.end();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const exit = await Promise.race([
      exitPromise,
      new Promise<never>((_resolveTimeout, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Sidecar did not exit within 3 seconds'));
        }, 3000);
      }),
    ]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });
    expect(exit[0]).toBe(0);
    expect(await canConnect(session.port)).toBe(false);
    expect(stderr.join('')).toContain('stdin_closed');
  }, 30_000);
});
