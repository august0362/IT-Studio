import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import type { IProcessRunner, ProcessRunInput, ProcessRunOutput } from '../ports/process-runner.js';

const MAX_TAIL_BYTES = 64 * 1024;
const ENV_KEYS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'] as const;

function failure(code: AppError['code'], message: string): Result<never> {
  return {
    ok: false,
    error: { code, message, remediation: ['Check the command configuration and try again.'], retryable: false },
  };
}

function safeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function resolveExecutable(
  executable: string,
): { readonly file: string; readonly prefixArgs: readonly string[] } | null {
  if (executable === 'node') return { file: process.execPath, prefixArgs: [] };
  if (executable === 'npm')
    return {
      file: process.execPath,
      prefixArgs: [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')],
    };
  return null;
}

function tailAppend(current: Buffer, chunk: Buffer): Buffer {
  if (chunk.length >= MAX_TAIL_BYTES) return chunk.subarray(chunk.length - MAX_TAIL_BYTES);
  const combined = Buffer.concat([current, chunk]);
  return combined.length > MAX_TAIL_BYTES ? combined.subarray(combined.length - MAX_TAIL_BYTES) : combined;
}

function killTree(pid: number, env: NodeJS.ProcessEnv): void {
  const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
    env: safeEnv(env),
  });
  child.on('error', () => undefined);
}

export class NodeProcessRunner implements IProcessRunner {
  async run(input: ProcessRunInput): Promise<Result<ProcessRunOutput>> {
    const resolved = resolveExecutable(input.executable);
    if (!resolved) return failure(ErrorCode.VALIDATION, 'The command executable is not allow-listed.');
    if (input.args.some((argument) => typeof argument !== 'string' || argument.includes('\0')))
      return failure(ErrorCode.VALIDATION, 'Command arguments must be plain strings without NUL bytes.');
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)
      return failure(ErrorCode.VALIDATION, 'The command timeout must be a positive number.');
    if (input.signal?.aborted) return failure(ErrorCode.CANCELLED, 'The command was cancelled.');

    const started = Date.now();
    return await new Promise<Result<ProcessRunOutput>>((resolve) => {
      let stdout: Uint8Array = Buffer.alloc(0);
      let stderr: Uint8Array = Buffer.alloc(0);
      let timedOut = false;
      let settled = false;
      const child = spawn(resolved.file, [...resolved.prefixArgs, ...input.args], {
        shell: false,
        windowsHide: true,
        cwd: input.cwd,
        env: safeEnv(input.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined && process.platform === 'win32') killTree(child.pid, input.env);
        child.kill('SIGKILL');
      }, input.timeoutMs);
      const abort = (): void => {
        if (child.pid !== undefined && process.platform === 'win32') killTree(child.pid, input.env);
        child.kill('SIGKILL');
      };
      input.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk: Buffer) => (stdout = tailAppend(Buffer.from(stdout), chunk)));
      child.stderr.on('data', (chunk: Buffer) => (stderr = tailAppend(Buffer.from(stderr), chunk)));
      child.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', abort);
        resolve(failure('COMMAND_FAILED', 'The validation command could not be started.'));
      });
      child.on('close', (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', abort);
        resolve({
          ok: true,
          value: {
            exitCode,
            timedOut,
            durationMs: Date.now() - started,
            stdoutTail: Buffer.from(stdout).toString('utf8'),
            stderrTail: Buffer.from(stderr).toString('utf8'),
          },
        });
      });
    });
  }
}
