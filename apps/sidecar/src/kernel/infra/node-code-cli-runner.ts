import { spawn } from 'node:child_process';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import { isValidCodeExecutable, type ResolvedCodeCli } from '../domain/code-cli.js';
import type { CodeCliOutput, ICodeCliRunner } from '../ports/code-cli-runner.js';

const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 30_000;
const ENV_KEYS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'] as const;

function failure(message: string): Result<never> {
  const error: AppError = {
    code: ErrorCode.COMMAND_FAILED,
    message,
    remediation: ['Install or repair Visual Studio Code, then activate the project again.'],
    retryable: false,
  };
  return { ok: false, error };
}

function safeEnv(source: NodeJS.ProcessEnv, windows: boolean): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  if (windows) result.ELECTRON_RUN_AS_NODE = '1';
  return result;
}

function appendCapped(current: Uint8Array, chunk: Buffer, otherLength: number): Uint8Array {
  const remaining = MAX_OUTPUT_BYTES - current.length - otherLength;
  return remaining <= 0 ? current : Buffer.concat([current, chunk.subarray(0, remaining)]);
}

function killTree(pid: number, windows: boolean): void {
  if (windows) {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      env: safeEnv(process.env, true),
    });
    child.on('error', () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // The child may have exited while the timeout callback was queued.
  }
}

function validate(cli: ResolvedCodeCli, args: readonly string[]): boolean {
  return (
    isValidCodeExecutable(cli.executable) &&
    args.every((argument) => typeof argument === 'string' && !argument.includes('\0')) &&
    cli.prefixArgs.every((argument) => !argument.includes('\0'))
  );
}

export class NodeCodeCliRunner implements ICodeCliRunner {
  private readonly sourceEnv: NodeJS.ProcessEnv;

  constructor(sourceEnv: NodeJS.ProcessEnv = process.env) {
    this.sourceEnv = sourceEnv;
  }

  async run(cli: ResolvedCodeCli, args: readonly string[]): Promise<Result<CodeCliOutput>> {
    if (!validate(cli, args)) return failure('The VS Code executable or arguments are invalid.');
    return await new Promise<Result<CodeCliOutput>>((resolve) => {
      let stdout: Uint8Array = Buffer.alloc(0);
      let stderr: Uint8Array = Buffer.alloc(0);
      let timedOut = false;
      let settled = false;
      const child = spawn(cli.executable, [...cli.prefixArgs, ...args], {
        shell: false,
        windowsHide: true,
        detached: !cli.windows,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: safeEnv(this.sourceEnv, cli.windows),
      });
      const finish = (result: Result<CodeCliOutput>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) killTree(child.pid, cli.windows);
        child.kill('SIGKILL');
      }, TIMEOUT_MS);
      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk, stderr.length);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk, stdout.length);
      });
      child.once('error', () => {
        finish(failure('VS Code CLI could not be started.'));
      });
      child.once('close', (exitCode) => {
        finish({
          ok: true,
          value: {
            exitCode,
            timedOut,
            stdout: Buffer.from(stdout).toString('utf8'),
            stderr: Buffer.from(stderr).toString('utf8'),
          },
        });
      });
    });
  }

  launch(cli: ResolvedCodeCli, args: readonly string[]): Result<void> {
    if (!validate(cli, args)) return failure('The VS Code executable or arguments are invalid.');
    try {
      const child = spawn(cli.executable, [...cli.prefixArgs, ...args], {
        shell: false,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
        env: safeEnv(this.sourceEnv, cli.windows),
      });
      child.once('error', () => undefined);
      child.unref();
      return { ok: true, value: undefined };
    } catch {
      return failure('VS Code could not be launched.');
    }
  }
}
