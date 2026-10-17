import {
  ErrorCode,
  type CoderOutput,
  type CommandRun,
  type OrchRun,
  type OrchTask,
  type Project,
  type ProjectId,
  type Result,
} from '@itstudio/schemas';
import type { IProjectLifecycleRepository } from '../../ports/project-repository.js';
import type { IProcessRunner } from '../../ports/process-runner.js';
import type { IFileSystem } from '../../ports/file-system.js';
import type { CommandRunner } from '../../services/command-runner.js';
import type { WriteTransactionService } from '../../services/write-transaction.js';
import { coderOutputSchema } from '../../validation/pipeline.js';
import { applyWorkerOutput, type Worktree, type WorktreeManager, type WorkerApplyDependencies } from './worktrees.js';

export interface AttemptResult {
  readonly changedFiles: readonly string[];
  readonly baseSha: string;
  readonly headSha: string;
  readonly evidence: readonly CommandRun[];
}
export interface IOrchWorkspace {
  prepareAttempt(run: OrchRun, task: OrchTask, attempt: number): Promise<Result<Worktree>>;
  applyWorker(
    run: OrchRun,
    task: OrchTask,
    attempt: number,
    worktree: Worktree,
    output: CoderOutput,
    signal?: AbortSignal,
  ): Promise<Result<AttemptResult>>;
  diff(worktree: Worktree): Promise<Result<string>>;
}
export interface OrchWorkspaceDependencies {
  readonly projects: Pick<IProjectLifecycleRepository, 'get'>;
  readonly worktrees: WorktreeManager;
  readonly apply: Omit<WorkerApplyDependencies, 'projectId'>;
  readonly runner: IProcessRunner;
}
export class OrchWorkspace implements IOrchWorkspace {
  private readonly deps: OrchWorkspaceDependencies;
  private readonly baseShas = new Map<string, string>();
  constructor(deps: OrchWorkspaceDependencies) {
    this.deps = deps;
  }
  async prepareAttempt(run: OrchRun, task: OrchTask, attempt: number): Promise<Result<Worktree>> {
    const project: Project | null = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    let baseSha = this.baseShas.get(run.id);
    if (baseSha === undefined) {
      const head = await this.deps.runner.run({
        executable: 'git',
        args: ['rev-parse', 'HEAD'],
        cwd: project.workspaceRoot,
        env: process.env,
        timeoutMs: 30_000,
      });
      if (!head.ok) return head;
      if (head.value.exitCode !== 0)
        return {
          ok: false,
          error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the project base SHA.', retryable: false },
        };
      baseSha = head.value.stdoutTail.trim();
      this.baseShas.set(run.id, baseSha);
    }
    return this.deps.worktrees.create(
      project.workspaceRoot,
      { runId: run.id, taskId: task.id, attempt, baseSha },
      task.allowedPaths,
    );
  }
  async applyWorker(
    run: OrchRun,
    task: OrchTask,
    attempt: number,
    worktree: Worktree,
    output: CoderOutput,
    signal?: AbortSignal,
  ): Promise<Result<AttemptResult>> {
    const parsed = coderOutputSchema.safeParse(output);
    if (!parsed.success)
      return {
        ok: false,
        error: { code: ErrorCode.VALIDATION, message: 'Worker output is invalid.', retryable: false },
      };
    return applyWorkerOutput(
      { ...this.deps.apply, projectId: run.projectId },
      worktree,
      run.id,
      task.id,
      attempt,
      task.allowedPaths,
      task.testCommands,
      parsed.data,
      signal,
    );
  }
  async diff(worktree: Worktree): Promise<Result<string>> {
    const result = await this.deps.runner.run({
      executable: 'git',
      args: ['diff', `${worktree.baseSha}..HEAD`],
      cwd: worktree.path,
      env: process.env,
      timeoutMs: 30_000,
    });
    if (!result.ok) return result;
    return result.value.exitCode === 0
      ? { ok: true, value: result.value.stdoutTail }
      : {
          ok: false,
          error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the worktree diff.', retryable: false },
        };
  }
}
