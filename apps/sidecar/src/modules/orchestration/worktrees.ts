import { join, resolve } from 'node:path';
import { ErrorCode, type Result } from '@itstudio/schemas';
import type { IProcessRunner } from '../../ports/process-runner.js';

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
  constructor(
    private readonly runner: IProcessRunner,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  private async git(root: string, args: readonly string[]) {
    return this.runner.run({ executable: 'git', args, cwd: root, env: this.env, timeoutMs: 30_000 });
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
    const branch = `itstudio/orch/${identity.runId}/${identity.taskId}`;
    const path = join(root, '.itstudio', 'orch', identity.runId, `${identity.taskId}-${identity.attempt}`);
    const created = await this.git(root, ['worktree', 'add', '-b', branch, path, identity.baseSha]);
    if (!created.ok || created.value.exitCode !== 0) return fail('Git could not create the orchestration worktree.');
    return { ok: true, value: { path, branch, baseSha: identity.baseSha } };
  }
  async cleanup(projectRoot: string, worktree: Worktree): Promise<Result<void>> {
    const root = resolve(projectRoot);
    const expectedPrefix = join(root, '.itstudio', 'orch') + '\\';
    if (
      !resolve(worktree.path).toLocaleLowerCase().startsWith(expectedPrefix.toLocaleLowerCase()) ||
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
