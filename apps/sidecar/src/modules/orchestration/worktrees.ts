import { appendFile, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  ErrorCode,
  type CoderOutput,
  type CommandRun,
  type CommandSpec,
  type ProjectId,
  type Result,
} from '@itstudio/schemas';
import type { IProcessRunner } from '../../kernel/ports/process-runner.js';
import type { IFileSystem } from '../../kernel/ports/file-system.js';
import type { CommandRunner } from '../pipeline/index.js';
import type { WriteTransactionService } from '../pipeline/index.js';
import { normalizeRelative } from '../../kernel/domain/path-guard.js';

export interface WorktreeIdentity {
  readonly runId: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly baseSha: string;
}
export interface Worktree {
  readonly path: string;
  readonly branch: string;
  readonly baseSha: string;
}
function fail(message: string): Result<never> {
  return { ok: false, error: { code: ErrorCode.CONFLICT, message, retryable: false } };
}
export class WorktreeManager {
  private readonly runner: IProcessRunner;
  private readonly env: NodeJS.ProcessEnv;
  constructor(runner: IProcessRunner, env: NodeJS.ProcessEnv = process.env) {
    this.runner = runner;
    this.env = env;
  }
  private async git(root: string, args: readonly string[]) {
    return this.runner.run({ executable: 'git', args, cwd: root, env: this.env, timeoutMs: 30_000 });
  }
  /** Keeps run worktrees out of the owner's `git status` via the local, uncommitted `info/exclude`. */
  private async excludeRunDirectory(root: string): Promise<void> {
    const located = await this.git(root, ['rev-parse', '--git-path', 'info/exclude']);
    if (!located.ok || located.value.exitCode !== 0) return;
    const excludeFile = resolve(root, located.value.stdoutTail.trim());
    const current = await readFile(excludeFile, 'utf8').catch(() => '');
    if (current.split(/\r?\n/u).some((line) => line.trim() === '.itstudio/')) return;
    const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
    await appendFile(excludeFile, `${separator}.itstudio/\n`).catch(() => undefined);
  }
  async create(
    projectRoot: string,
    identity: WorktreeIdentity,
    ownedPaths: readonly string[],
  ): Promise<Result<Worktree>> {
    const root = resolve(projectRoot);
    const top = await this.git(root, ['rev-parse', '--show-toplevel']);
    if (
      !top.ok ||
      top.value.exitCode !== 0 ||
      resolve(top.value.stdoutTail.trim()).toLocaleLowerCase() !== root.toLocaleLowerCase()
    )
      return fail('The project root must be the Git repository root.');
    const status = await this.git(root, ['status', '--porcelain', '--', ...ownedPaths]);
    if (!status.ok || status.value.exitCode !== 0 || status.value.stdoutTail.trim() !== '')
      return fail('Git has uncommitted changes in paths owned by this run.');
    const branch = `itstudio/orch/${identity.runId}/${identity.taskId}-${String(identity.attempt)}`;
    const path = join(root, '.itstudio', 'orch', identity.runId, `${identity.taskId}-${String(identity.attempt)}`);
    await this.excludeRunDirectory(root);
    const created = await this.git(root, ['worktree', 'add', '-b', branch, path, identity.baseSha]);
    if (!created.ok || created.value.exitCode !== 0) return fail('Git could not create the orchestration worktree.');
    return { ok: true, value: { path, branch, baseSha: identity.baseSha } };
  }
  async createIntegration(projectRoot: string, runId: string, baseSha: string): Promise<Result<Worktree>> {
    const root = resolve(projectRoot);
    const top = await this.git(root, ['rev-parse', '--show-toplevel']);
    if (
      !top.ok ||
      top.value.exitCode !== 0 ||
      resolve(top.value.stdoutTail.trim()).toLocaleLowerCase() !== root.toLocaleLowerCase()
    )
      return fail('The project root must be the Git repository root.');
    const branch = `itstudio/orch/${runId}/integration`;
    const path = join(root, '.itstudio', 'orch', runId, 'integration');
    await this.excludeRunDirectory(root);
    const created = await this.git(root, ['worktree', 'add', '-b', branch, path, baseSha]);
    if (!created.ok || created.value.exitCode !== 0) return fail('Git could not create the integration worktree.');
    return { ok: true, value: { path, branch, baseSha } };
  }
  async cleanup(projectRoot: string, worktree: Worktree): Promise<Result<void>> {
    const root = resolve(projectRoot);
    const expectedPrefix = resolve(join(root, '.itstudio', 'orch')).toLocaleLowerCase();
    const normPath = resolve(worktree.path).toLocaleLowerCase();
    if (
      (!normPath.startsWith(expectedPrefix + '\\') && !normPath.startsWith(expectedPrefix + '/')) ||
      !worktree.branch.startsWith('itstudio/orch/')
    )
      return fail('Refusing to remove a worktree or branch outside the orchestration namespace.');
    const removed = await this.git(root, ['worktree', 'remove', '--force', worktree.path]);
    if (!removed.ok || removed.value.exitCode !== 0) return fail('Git could not remove the orchestration worktree.');
    const branch = await this.git(root, ['branch', '-D', worktree.branch]);
    return branch.ok && branch.value.exitCode === 0
      ? { ok: true, value: undefined }
      : fail('Git could not remove the orchestration branch.');
  }
}

/**
 * Every worktree a run created (task attempts + integration), with the branch Git named for it:
 * worktree `.itstudio/orch/<run>/<name>` always has branch `itstudio/orch/<run>/<name>`.
 */
export function runWorktrees(
  projectRoot: string,
  runId: string,
  attemptWorktrees: readonly (string | undefined)[],
  integrationBranch?: string,
): readonly Worktree[] {
  const paths = new Set(attemptWorktrees.filter((path): path is string => path !== undefined));
  if (integrationBranch !== undefined) paths.add(join(resolve(projectRoot), '.itstudio', 'orch', runId, 'integration'));
  return [...paths].map((path) => ({ path, branch: `itstudio/orch/${runId}/${basename(path)}`, baseSha: '' }));
}

export function globMatches(glob: string, path: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '.*')
    .replace(/\*/gu, '[^/]*')
    .replace(/\?/gu, '[^/]');
  return new RegExp(`^${escaped}$`, 'u').test(path);
}

export interface WorkerApplyDependencies {
  readonly runner: IProcessRunner;
  readonly fileSystem: IFileSystem;
  readonly commands: Pick<CommandRunner, 'run'>;
  readonly writer: Pick<WriteTransactionService, 'prepare'>;
  readonly env?: NodeJS.ProcessEnv;
  readonly projectId: ProjectId;
}

export async function applyWorkerOutput(
  dependencies: WorkerApplyDependencies,
  worktree: Worktree,
  runId: string,
  taskId: string,
  attempt: number,
  allowedPaths: readonly string[],
  testCommands: readonly CommandSpec[],
  output: CoderOutput,
  signal?: AbortSignal,
): Promise<
  Result<{
    readonly changedFiles: readonly string[];
    readonly baseSha: string;
    readonly headSha: string;
    readonly evidence: readonly CommandRun[];
  }>
> {
  const env = dependencies.env ?? process.env;
  const failPath = (): Result<never> => ({
    ok: false,
    error: {
      code: ErrorCode.PATH_DENIED,
      message: 'Worker output contains a path outside the task allowance.',
      remediation: ['Restrict the worker output to the assigned paths and retry.'],
      retryable: false,
    },
  });
  const paths: string[] = [];
  for (const operation of output.operations) {
    const entries = operation.kind === 'rename' ? [operation.from, operation.to] : [operation.path];
    for (const entry of entries) {
      const normalized = normalizeRelative(entry);
      if (!normalized.ok || !allowedPaths.some((pattern) => globMatches(pattern, normalized.value))) return failPath();
      paths.push(normalized.value);
    }
  }
  const prepared = await dependencies.writer.prepare(worktree.path, dependencies.projectId, output.operations, [
    ...new Set(paths),
  ]);
  if (!prepared.ok) return prepared;
  const committedWrite = await prepared.value.commit();
  if (!committedWrite.ok) return committedWrite;
  const validatedWrite = await prepared.value.markValidated();
  if (!validatedWrite.ok) return validatedWrite;
  const git = async (args: readonly string[]) =>
    dependencies.runner.run({
      executable: 'git',
      args,
      cwd: worktree.path,
      env,
      timeoutMs: 30_000,
      ...(signal === undefined ? {} : { signal }),
    });
  // Stage only the worker's own paths: the write journal under `.itstudio/tx` must never be committed.
  // A worker with no operations gets an empty commit so the attempt still has its own head.
  const added =
    paths.length === 0
      ? ({ ok: true, value: { exitCode: 0 } } as const)
      : await git(['add', '-A', '--', ...new Set(paths)]);
  if (!added.ok || added.value.exitCode !== 0)
    return {
      ok: false,
      error: added.ok
        ? { code: ErrorCode.COMMAND_FAILED, message: 'Git could not stage worker changes.', retryable: false }
        : added.error,
    };
  const committed = await git(['commit', '--allow-empty', '-m', `orch(${runId}/${taskId}#${String(attempt)})`]);
  if (!committed.ok || committed.value.exitCode !== 0)
    return {
      ok: false,
      error: committed.ok
        ? { code: ErrorCode.COMMAND_FAILED, message: 'Git could not commit worker changes.', retryable: false }
        : committed.error,
    };
  const head = await git(['rev-parse', 'HEAD']);
  const changed = await git(['diff', '--name-only', `${worktree.baseSha}..HEAD`]);
  if (!head.ok || head.value.exitCode !== 0 || !changed.ok || changed.value.exitCode !== 0)
    return {
      ok: false,
      error: { code: ErrorCode.COMMAND_FAILED, message: 'Git could not collect worker evidence.', retryable: false },
    };
  const evidence: CommandRun[] = [];
  for (const spec of testCommands) {
    const result = await dependencies.commands.run(worktree.path, spec, signal);
    if (!result.ok) return result;
    evidence.push(result.value);
    if (result.value.exitCode !== 0 || result.value.timedOut)
      return {
        ok: false,
        error: {
          code: ErrorCode.COMMAND_FAILED,
          message: 'Worker validation command failed.',
          remediation: ['Review the command evidence, fix the worktree, and retry.'],
          retryable: false,
        },
      };
  }
  return {
    ok: true,
    value: {
      changedFiles: changed.value.stdoutTail.trim().split(/\r?\n/u).filter(Boolean),
      baseSha: worktree.baseSha,
      headSha: head.value.stdoutTail.trim(),
      evidence,
    },
  };
}
