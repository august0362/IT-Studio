import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';
import { ErrorCode, type AppError, type Result } from '@itstudio/schemas';
import type { IProcessRunner, ProcessRunInput, ProcessRunOutput } from '../ports/process-runner.js';

const MAX_TAIL_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const ENV_KEYS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'] as const;
/** Extra variables the agent CLIs need to find their own login, config and Git Bash. Never API keys. */
const AGENT_CLI_ENV_KEYS = [
  'PATHEXT',
  'COMSPEC',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_GIT_BASH_PATH',
] as const;
const AGENT_CLIS: readonly string[] = ['claude', 'codex'];

function failure(code: AppError['code'], message: string): Result<never> {
  return {
    ok: false,
    error: { code, message, remediation: ['Check the command configuration and try again.'], retryable: false },
  };
}

function safeEnv(source: NodeJS.ProcessEnv, agentCli = false): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of agentCli ? [...ENV_KEYS, ...AGENT_CLI_ENV_KEYS] : ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export interface ResolvedExecutable {
  readonly file: string;
  readonly prefixArgs: readonly string[];
}

export interface ShimFileSystem {
  exists(path: string): boolean;
  read(path: string): string | null;
}

const realShimFs: ShimFileSystem = {
  exists: (path) => existsSync(path),
  read: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
};

const SHIM_TARGET = /"%dp0%\\([^"]+?\.(exe|js|cjs|mjs))"/gi;

/**
 * npm installs global CLIs on Windows as `<name>.cmd` shims, which cannot be spawned without a shell.
 * Resolve `<name>` on PATH to a real `.exe`, or to the binary / script that the npm shim launches.
 */
export function resolveWindowsCli(name: string, pathValue: string, fs: ShimFileSystem): ResolvedExecutable | null {
  const directories = pathValue.split(';').filter((directory) => directory.trim().length > 0);
  const findNode = (shimDirectory: string): string | null => {
    for (const directory of [shimDirectory, ...directories]) {
      const candidate = win32.join(directory, 'node.exe');
      if (fs.exists(candidate)) return candidate;
    }
    return null;
  };
  for (const directory of directories) {
    const exe = win32.join(directory, `${name}.exe`);
    if (fs.exists(exe)) return { file: exe, prefixArgs: [] };
    const shim = win32.join(directory, `${name}.cmd`);
    if (!fs.exists(shim)) continue;
    for (const match of (fs.read(shim) ?? '').matchAll(SHIM_TARGET)) {
      const relativeTarget = match[1];
      const extension = match[2]?.toLowerCase();
      // The shim's optional bundled `node.exe` is the interpreter, not the CLI itself.
      if (relativeTarget === undefined || extension === undefined || /^node\.exe$/i.test(relativeTarget)) continue;
      const target = win32.join(directory, relativeTarget);
      if (!fs.exists(target)) continue;
      if (extension === 'exe') return { file: target, prefixArgs: [] };
      const node = findNode(directory);
      if (node !== null) return { file: node, prefixArgs: [target] };
    }
  }
  return null;
}

const cliCache = new Map<string, ResolvedExecutable>();

function resolveAgentCli(name: string, env: NodeJS.ProcessEnv): ResolvedExecutable {
  if (process.platform !== 'win32') return { file: name, prefixArgs: [] };
  const pathValue = env.PATH ?? process.env.PATH ?? '';
  const key = `${name}|${pathValue}`;
  const cached = cliCache.get(key);
  if (cached !== undefined) return cached;
  const resolved = resolveWindowsCli(name, pathValue, realShimFs);
  if (resolved === null) return { file: name, prefixArgs: [] };
  cliCache.set(key, resolved);
  return resolved;
}

function resolveExecutable(executable: string, env: NodeJS.ProcessEnv): ResolvedExecutable | null {
  if (AGENT_CLIS.includes(executable)) return resolveAgentCli(executable, env);
  if (['git', 'where.exe'].includes(executable)) return { file: executable, prefixArgs: [] };
  if (executable === 'node') return { file: process.execPath, prefixArgs: [] };
  if (executable === 'npm')
    return {
      file: process.execPath,
      prefixArgs: [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')],
    };
  return null;
}

function tailAppend(current: Buffer, chunk: Buffer, limit: number): Buffer {
  if (chunk.length >= limit) return chunk.subarray(chunk.length - limit);
  const combined = Buffer.concat([current, chunk]);
  return combined.length > limit ? combined.subarray(combined.length - limit) : combined;
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
    const resolved = resolveExecutable(input.executable, input.env);
    if (!resolved) return failure(ErrorCode.VALIDATION, 'The command executable is not allow-listed.');
    if (input.args.some((argument) => typeof argument !== 'string' || argument.includes('\0')))
      return failure(ErrorCode.VALIDATION, 'Command arguments must be plain strings without NUL bytes.');
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)
      return failure(ErrorCode.VALIDATION, 'The command timeout must be a positive number.');
    if (input.signal?.aborted) return failure(ErrorCode.CANCELLED, 'The command was cancelled.');
    const maxOutput =
      input.maxOutputBytes !== undefined && Number.isInteger(input.maxOutputBytes) && input.maxOutputBytes > 0
        ? Math.min(input.maxOutputBytes, MAX_OUTPUT_BYTES)
        : MAX_TAIL_BYTES;
    const agentCli = AGENT_CLIS.includes(input.executable);

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
        env: safeEnv(input.env, agentCli),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Without input the child sees an immediately closed stdin (EOF), like an ignored stdin.
      child.stdin.on('error', () => undefined);
      child.stdin.end(input.stdin ?? '', 'utf8');
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
      child.stdout.on('data', (chunk: Buffer) => (stdout = tailAppend(Buffer.from(stdout), chunk, maxOutput)));
      child.stderr.on('data', (chunk: Buffer) => (stderr = tailAppend(Buffer.from(stderr), chunk, maxOutput)));
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
