import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { z } from 'zod';
import type { RpcMethod, RpcMethodMap } from '@itstudio/schemas';

interface RpcResponse {
  readonly jsonrpc: string;
  readonly id: number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

const rpcResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.number().nullable(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }).optional(),
});

export interface SidecarHarness {
  readonly dataDir: string;
  readonly stdoutLines: string[];
  readonly stderr: string[];
  readonly notifications: EventEmitter;
  call<M extends RpcMethod>(method: M, params?: RpcMethodMap[M]['params']): Promise<RpcResponse>;
  writeLine(line: string): void;
  writeChunk(chunk: string): void;
  kill(): Promise<void>;
  restart(env?: Readonly<Record<string, string>>): Promise<void>;
  close(): Promise<void>;
}

export async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for stdout condition after ${String(timeoutMs)} ms`);
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

const sidecarRoot = resolve(dirnameOf(fileURLToPath(import.meta.url)), '../..');
const mainPath = resolve(sidecarRoot, 'src/main.ts');

function dirnameOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
}

export async function startSidecar(
  extraEnv: Readonly<Record<string, string>> = {},
  scriptedModels?: Readonly<Record<string, readonly string[]>>,
  scriptedEmbeddingModels?: Readonly<Record<string, readonly string[]>>,
): Promise<SidecarHarness> {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'itstudio-m1-'));
  if (scriptedModels !== undefined) {
    const fixturePath = resolve(dataDir, 'llm-script.json');
    await writeFile(fixturePath, JSON.stringify({ models: scriptedModels }), 'utf8');
    extraEnv = { ...extraEnv, ITSTUDIO_E2E_LLM_SCRIPT: fixturePath };
  }
  if (scriptedEmbeddingModels !== undefined) {
    const fixturePath = resolve(dataDir, 'embedding-script.json');
    await writeFile(fixturePath, JSON.stringify(scriptedEmbeddingModels), 'utf8');
    extraEnv = { ...extraEnv, ITSTUDIO_E2E_EMBEDDING_SCRIPT: fixturePath };
  }
  const stdoutLines: string[] = [];
  const stderr: string[] = [];
  const notifications = new EventEmitter();
  const pending = new Map<number, (response: RpcResponse) => void>();
  let child: ChildProcess | undefined;
  let nextId = 1;
  let childEnv = { ...extraEnv };

  const spawnChild = (): Promise<void> =>
    new Promise((resolveReady, reject) => {
      child = spawn(process.execPath, ['--import', 'tsx', mainPath], {
        cwd: sidecarRoot,
        env: {
          ...process.env,
          ITSTUDIO_DATA_DIR: dataDir,
          ITSTUDIO_E2E: '1',
          ITSTUDIO_LOG_LEVEL: 'info',
          ...childEnv,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
      let ready = false;
      let buffer = '';
      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/u, '');
          buffer = buffer.slice(newline + 1);
          stdoutLines.push(line);
          notifications.emit('line', line);
          try {
            const message: unknown = JSON.parse(line);
            const rpcResponse = rpcResponseSchema.safeParse(message);
            if (rpcResponse.success && typeof rpcResponse.data.id === 'number') {
              const resolvePending = pending.get(rpcResponse.data.id);
              if (resolvePending !== undefined) {
                pending.delete(rpcResponse.data.id);
                resolvePending({
                  jsonrpc: rpcResponse.data.jsonrpc,
                  id: rpcResponse.data.id,
                  ...(rpcResponse.data.result === undefined ? {} : { result: rpcResponse.data.result }),
                  ...(rpcResponse.data.error === undefined ? {} : { error: rpcResponse.data.error }),
                });
              }
            } else if (
              typeof message === 'object' &&
              message !== null &&
              'method' in message &&
              typeof message.method === 'string'
            ) {
              notifications.emit('notification', message);
              if (message.method === 'system.ready' && !ready) {
                ready = true;
                resolveReady();
              }
            }
          } catch {
            notifications.emit('invalid-line', line);
          }
          newline = buffer.indexOf('\n');
        }
      });
      child.stderr?.on('data', (chunk: string) => stderr.push(chunk));
      child.once('error', reject);
      child.once('exit', (code) => {
        if (!ready) reject(new Error(`Sidecar exited before system.ready (${String(code)}): ${stderr.join('')}`));
      });
    });

  const kill = async (): Promise<void> => {
    const current = child;
    if (current === undefined) return;
    if (current.exitCode !== null || current.signalCode !== null) return;

    const waitForExit = (timeoutMs: number): Promise<boolean> => {
      if (current.exitCode !== null || current.signalCode !== null) return Promise.resolve(true);
      return new Promise<boolean>((resolveExit) => {
        const onExit = (): void => {
          clearTimeout(timeout);
          resolveExit(true);
        };
        const timeout = setTimeout(() => {
          current.off('exit', onExit);
          resolveExit(false);
        }, timeoutMs);
        current.once('exit', onExit);
      });
    };

    current.kill('SIGTERM');
    if (!(await waitForExit(3_000))) {
      current.kill('SIGKILL');
      await waitForExit(3_000);
    }
    for (const [id, resolvePending] of pending) {
      resolvePending({ jsonrpc: '2.0', id, error: { code: -32000, message: 'sidecar restarted' } });
      pending.delete(id);
    }
  };

  const writeLine = (line: string): void => {
    if (child?.stdin === null || child?.stdin === undefined) throw new Error('Sidecar stdin is unavailable');
    child.stdin.write(`${line}\n`);
  };

  const writeChunk = (chunk: string): void => {
    if (child?.stdin === null || child?.stdin === undefined) throw new Error('Sidecar stdin is unavailable');
    child.stdin.write(chunk);
  };

  try {
    await spawnChild();
  } catch (error) {
    await rm(dataDir, { recursive: true, force: true });
    throw error;
  }
  return {
    dataDir,
    stdoutLines,
    stderr,
    notifications,
    call(method, params) {
      const id = nextId++;
      return new Promise((resolveResponse, rejectResponse) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          rejectResponse(new Error(`Timed out waiting for ${method}`));
        }, 30_000);
        pending.set(id, (response) => {
          clearTimeout(timeout);
          resolveResponse(response);
        });
        writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} }));
      });
    },
    writeLine,
    writeChunk,
    async kill() {
      await kill();
    },
    async restart(env = {}) {
      await kill();
      childEnv = { ...childEnv, ...env };
      await spawnChild();
    },
    async close() {
      await kill();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
