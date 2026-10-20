import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  ErrorCode,
  type CoderOutput,
  type CommandRun,
  type CommandSpec,
  type OrchRun,
  type OrchTask,
  type Project,
  type ProjectId,
  type Result,
} from '@itstudio/schemas';
import type { IProjectLifecycleRepository } from '../../kernel/ports/project-repository.js';
import type { IProcessRunner } from '../../kernel/ports/process-runner.js';
import { resolveSafe } from '../../kernel/domain/path-guard.js';
import { coderOutputSchema } from '../../kernel/validation/pipeline.js';
import { fileOperationSchema } from '../../kernel/validation/worker.js';
import { globMatches } from './glob.js';
import {
  applyWorkerOutput,
  canonicalPath,
  type Worktree,
  type WorktreeManager,
  type WorkerApplyDependencies,
} from './worktrees.js';

export function isTargetForbidden(
  projectRoot: string,
  sidecarCwd: string = process.cwd(),
  appExecutableDir?: string,
): boolean {
  const normProject = resolve(projectRoot).toLocaleLowerCase();
  const normCwd = resolve(sidecarCwd).toLocaleLowerCase();
  if (normProject === normCwd || normProject.startsWith(normCwd + '\\') || normProject.startsWith(normCwd + '/')) {
    return true;
  }
  if (appExecutableDir !== undefined && appExecutableDir.length > 0) {
    const normExe = resolve(appExecutableDir).toLocaleLowerCase();
    if (normProject === normExe || normProject.startsWith(normExe + '\\') || normProject.startsWith(normExe + '/')) {
      return true;
    }
  }
  return false;
}

export interface AttemptResult {
  readonly changedFiles: readonly string[];
  readonly baseSha: string;
  readonly headSha: string;
  readonly evidence: readonly CommandRun[];
}
export interface MergeConflict {
  /** Every unmerged file with its current content, conflict markers included. */
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly diff: string;
}
export interface ConflictResolution {
  readonly path: string;
  readonly content: string;
}
/** Returns the resolved content of every conflicted file, or `undefined` when no resolution is available. */
export type ConflictResolver = (conflict: MergeConflict) => Promise<readonly ConflictResolution[] | undefined>;
export interface MergeTaskResult {
  readonly exitCode: number;
  /** Git reported a content conflict for this merge. */
  readonly conflict: boolean;
  /** The conflict was resolved, every file is merged and the merge commit exists. */
  readonly resolved?: boolean;
  readonly conflictedFiles?: readonly string[];
  /** Why a conflict stayed unresolved (the merge was then aborted, the integration HEAD is unchanged). */
  readonly reason?: string;
  readonly diff?: string;
  /** Integration HEAD after a completed merge. */
  readonly headSha?: string;
}
export interface IOrchWorkspace {
  prepareAttempt(run: OrchRun, task: OrchTask, attempt: number): Promise<Result<Worktree>>;
  /** Builds a fresh integration worktree on the current tip of the run's target branch. */
  prepareIntegration(run: OrchRun): Promise<Result<Worktree>>;
  /**
   * Merges a task branch into the integration worktree. On a content conflict `resolve` is asked for the
   * resolved files; they are applied through the write transaction, and the merge is committed only when no
   * unmerged entry is left. Otherwise the merge is aborted and the conflict is reported unresolved.
   */
  mergeTask(
    run: OrchRun,
    integration: Worktree,
    taskWorktree: Worktree,
    resolve?: ConflictResolver,
  ): Promise<Result<MergeTaskResult>>;
  validateIntegration(
    run: OrchRun,
    integration: Worktree,
    commands?: readonly CommandSpec[],
  ): Promise<Result<readonly CommandRun[]>>;
  applyWorker(
    run: OrchRun,
    task: OrchTask,
    attempt: number,
    worktree: Worktree,
    output: CoderOutput,
    signal?: AbortSignal,
  ): Promise<Result<AttemptResult>>;
  diff(worktree: Worktree): Promise<Result<string>>;
  cleanup(run: OrchRun, worktree: Worktree): Promise<Result<void>>;
  /** Tracked files and the current content + sha256 of files inside `allowedPaths` (worker context). */
  workerContext?(worktree: Worktree, allowedPaths: readonly string[]): Promise<Result<WorkerContext>>;
  /** Root, current branch and tracked files of the run's project (supervisor planning context). */
  projectInfo?(projectId: ProjectId): Promise<Result<ProjectInfo>>;
  /** Every worktree Git still has for the run, including ones a crashed engine never recorded. */
  runWorktrees?(run: OrchRun): Promise<readonly Worktree[]>;
}
export interface WorkerContextFile {
  readonly path: string;
  readonly sha256: string;
  /** Omitted when the file is binary or too large; the worker may still read it from its worktree. */
  readonly content?: string;
}
export interface WorkerContext {
  readonly tree: readonly string[];
  readonly files: readonly WorkerContextFile[];
}
export interface ProjectInfo {
  readonly root: string;
  readonly branch: string;
  readonly tree: readonly string[];
}
const MAX_TREE_ENTRIES = 400;
const MAX_CONTEXT_FILE_BYTES = 64 * 1024;
const MAX_CONTEXT_TOTAL_BYTES = 512 * 1024;
const MAX_DIFF_CHARS = 200_000;
const MAX_CONFLICT_FILE_BYTES = 256 * 1024;
/** A line that is still a Git conflict marker (`<<<<<<<`, `|||||||`, `=======`, `>>>>>>>`). */
const CONFLICT_MARKER = /^(?:<{7}|>{7}|\|{7})(?: |\r?$)|^={7}\r?$/mu;

function truncateDiff(diff: string): string {
  return diff.length > MAX_DIFF_CHARS
    ? `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated: ${String(diff.length - MAX_DIFF_CHARS)} more characters]`
    : diff;
}

interface ConflictedFile {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
}
export interface OrchWorkspaceDependencies {
  readonly projects: Pick<IProjectLifecycleRepository, 'get'>;
  readonly worktrees: WorktreeManager;
  readonly apply: Omit<WorkerApplyDependencies, 'projectId'>;
  readonly runner: IProcessRunner;
  readonly sidecarCwd?: string;
  readonly appExecutableDir?: string;
}
export class OrchWorkspace implements IOrchWorkspace {
  private readonly deps: OrchWorkspaceDependencies;
  private readonly baseShas = new Map<string, string>();
  constructor(deps: OrchWorkspaceDependencies) {
    this.deps = deps;
  }
  private git(cwd: string, args: readonly string[], maxOutputBytes?: number) {
    return this.deps.runner.run({
      executable: 'git',
      args,
      cwd,
      env: process.env,
      timeoutMs: 30_000,
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
    });
  }
  /** Current tip of the run's target branch; HEAD when the branch cannot be resolved (detached checkout). */
  private async targetTip(workspaceRoot: string, run: OrchRun): Promise<Result<string>> {
    for (const revision of [`refs/heads/${run.targetBranch}^{commit}`, 'HEAD']) {
      const tip = await this.git(workspaceRoot, ['rev-parse', '--verify', '--quiet', revision]);
      if (!tip.ok) return tip;
      if (tip.value.exitCode === 0) return { ok: true, value: tip.value.stdoutTail.trim() };
    }
    return {
      ok: false,
      error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the project base SHA.', retryable: false },
    };
  }
  /** Task attempts all start from the run's base: persisted on the run, so a restart keeps using it. */
  private async getBaseSha(workspaceRoot: string, run: OrchRun): Promise<Result<string>> {
    const known = run.baseSha ?? this.baseShas.get(run.id);
    if (known !== undefined) return { ok: true, value: known };
    const tip = await this.targetTip(workspaceRoot, run);
    if (tip.ok) this.baseShas.set(run.id, tip.value);
    return tip;
  }
  /** Checked on the path as given and on its real path, so a junction or short name cannot hide IT Studio. */
  private async targetForbidden(root: string): Promise<boolean> {
    if (isTargetForbidden(root, this.deps.sidecarCwd, this.deps.appExecutableDir)) return true;
    return isTargetForbidden(
      await canonicalPath(root),
      await canonicalPath(this.deps.sidecarCwd ?? process.cwd()),
      this.deps.appExecutableDir === undefined ? undefined : await canonicalPath(this.deps.appExecutableDir),
    );
  }
  async prepareAttempt(run: OrchRun, task: OrchTask, attempt: number): Promise<Result<Worktree>> {
    const project: Project | null = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    if (await this.targetForbidden(project.workspaceRoot))
      return {
        ok: false,
        error: {
          code: ErrorCode.TARGET_FORBIDDEN,
          message: 'Refusing to run orchestration targeting IT Studio repository or install directory.',
          retryable: false,
        },
      };
    const baseSha = await this.getBaseSha(project.workspaceRoot, run);
    if (!baseSha.ok) return baseSha;
    return this.deps.worktrees.create(
      project.workspaceRoot,
      { runId: run.id, taskId: task.id, attempt, baseSha: baseSha.value },
      task.allowedPaths,
    );
  }
  async prepareIntegration(run: OrchRun): Promise<Result<Worktree>> {
    const project: Project | null = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    if (await this.targetForbidden(project.workspaceRoot))
      return {
        ok: false,
        error: {
          code: ErrorCode.TARGET_FORBIDDEN,
          message: 'Refusing to run orchestration targeting IT Studio repository or install directory.',
          retryable: false,
        },
      };
    // Integration always starts from the target branch as it is now: that is what the owner merges into.
    const tip = await this.targetTip(project.workspaceRoot, run);
    if (!tip.ok) return tip;
    return this.deps.worktrees.createIntegration(project.workspaceRoot, run.id, tip.value);
  }
  async mergeTask(
    run: OrchRun,
    integration: Worktree,
    taskWorktree: Worktree,
    resolve?: ConflictResolver,
  ): Promise<Result<MergeTaskResult>> {
    const merged = await this.git(integration.path, [
      'merge',
      '--no-ff',
      '-m',
      `Merge ${taskWorktree.branch}`,
      taskWorktree.branch,
    ]);
    if (!merged.ok) return merged;
    const exitCode = merged.value.exitCode ?? 1;
    if (exitCode === 0) return this.withHead(integration, { exitCode, conflict: false });
    const unmerged = await this.unmergedPaths(integration.path);
    if (!unmerged.ok || unmerged.value.length === 0) {
      // Not a content conflict (missing branch, hook, local changes): nothing to resolve.
      await this.abortMerge(integration.path);
      return {
        ok: false,
        error: {
          code: ErrorCode.COMMAND_FAILED,
          message: `Git could not merge ${taskWorktree.branch}: ${merged.value.stderrTail.trim().slice(-300)}`,
          retryable: false,
        },
      };
    }
    const conflictedFiles = unmerged.value;
    const diffResult = await this.git(integration.path, ['diff'], 4 * 1024 * 1024);
    const diff = diffResult.ok ? truncateDiff(diffResult.value.stdoutTail) : '';
    const unresolved = async (reason: string): Promise<Result<MergeTaskResult>> => {
      const aborted = await this.abortMerge(integration.path);
      if (!aborted.ok) return aborted;
      return { ok: true, value: { exitCode, conflict: true, resolved: false, conflictedFiles, reason, diff } };
    };
    const files = await this.conflictedContents(integration.path, conflictedFiles);
    if (files === undefined) return unresolved('CONFLICT_UNSUPPORTED');
    const resolutions =
      resolve === undefined
        ? undefined
        : await resolve({ files: files.map(({ path, content }) => ({ path, content })), diff });
    if (resolutions === undefined) return unresolved('CONFLICT_UNRESOLVED');
    const failure = await this.applyResolutions(run, integration, files, resolutions);
    if (failure !== undefined) return unresolved(failure);
    return this.withHead(integration, { exitCode, conflict: true, resolved: true, conflictedFiles, diff });
  }
  private async withHead(integration: Worktree, value: MergeTaskResult): Promise<Result<MergeTaskResult>> {
    const head = await this.git(integration.path, ['rev-parse', 'HEAD']);
    if (!head.ok) return head;
    if (head.value.exitCode !== 0)
      return {
        ok: false,
        error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the integration HEAD.', retryable: false },
      };
    return { ok: true, value: { ...value, headSha: head.value.stdoutTail.trim() } };
  }
  private async unmergedPaths(root: string): Promise<Result<readonly string[]>> {
    const listed = await this.git(root, ['diff', '--name-only', '--diff-filter=U', '-z'], 4 * 1024 * 1024);
    if (!listed.ok) return listed;
    if (listed.value.exitCode !== 0)
      return {
        ok: false,
        error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not list unmerged files.', retryable: false },
      };
    return { ok: true, value: listed.value.stdoutTail.split('\0').filter((path) => path.length > 0) };
  }
  private async abortMerge(root: string): Promise<Result<void>> {
    const merging = await this.git(root, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    if (merging.ok && merging.value.exitCode !== 0) return { ok: true, value: undefined };
    const aborted = await this.git(root, ['merge', '--abort']);
    return aborted.ok && aborted.value.exitCode === 0
      ? { ok: true, value: undefined }
      : {
          ok: false,
          error: { code: ErrorCode.COMMAND_FAILED, message: 'Git could not abort the failed merge.', retryable: false },
        };
  }
  /** Text content of every conflicted file; `undefined` when one is missing, binary or too large to resolve. */
  private async conflictedContents(
    root: string,
    paths: readonly string[],
  ): Promise<readonly ConflictedFile[] | undefined> {
    const files: ConflictedFile[] = [];
    for (const path of paths) {
      const safe = await resolveSafe(root, path, [path], this.deps.apply.fileSystem);
      if (!safe.ok) return undefined;
      const read = await this.deps.apply.fileSystem.readFile(safe.value);
      if (!read.ok || read.value.includes(0) || read.value.byteLength > MAX_CONFLICT_FILE_BYTES) return undefined;
      files.push({
        path,
        content: new TextDecoder('utf-8').decode(read.value),
        sha256: createHash('sha256').update(read.value).digest('hex'),
      });
    }
    return files;
  }
  /**
   * The only write path for a conflict resolution: exactly the conflicted files, no markers left, written by
   * the journaled write transaction, staged, and committed only when Git has no unmerged entry left.
   * Returns why the resolution was refused, or `undefined` when the merge commit exists.
   */
  private async applyResolutions(
    run: OrchRun,
    integration: Worktree,
    files: readonly ConflictedFile[],
    resolutions: readonly ConflictResolution[],
  ): Promise<string | undefined> {
    const expected = files.map((file) => file.path).sort();
    const given = resolutions.map((resolution) => resolution.path).sort();
    if (given.length !== expected.length || given.some((path, index) => path !== expected[index]))
      return 'CONFLICT_RESOLUTION_SCOPE';
    if (resolutions.some((resolution) => CONFLICT_MARKER.test(resolution.content))) return 'CONFLICT_MARKERS_LEFT';
    const operations = z.array(fileOperationSchema).safeParse(
      resolutions.map((resolution) => ({
        kind: 'replace',
        path: resolution.path,
        content: resolution.content,
        baseHash: files.find((file) => file.path === resolution.path)?.sha256,
      })),
    );
    if (!operations.success) return 'CONFLICT_RESOLUTION_SCOPE';
    const prepared = await this.deps.apply.writer.prepare(integration.path, run.projectId, operations.data, expected);
    if (!prepared.ok) return 'CONFLICT_RESOLUTION_WRITE_FAILED';
    const written = await prepared.value.commit();
    if (!written.ok) return 'CONFLICT_RESOLUTION_WRITE_FAILED';
    const validated = await prepared.value.markValidated();
    if (!validated.ok) return 'CONFLICT_RESOLUTION_WRITE_FAILED';
    const added = await this.git(integration.path, ['add', '--', ...expected]);
    if (!added.ok || added.value.exitCode !== 0) return 'CONFLICT_RESOLUTION_WRITE_FAILED';
    const left = await this.unmergedPaths(integration.path);
    if (!left.ok || left.value.length > 0) return 'CONFLICT_STILL_UNMERGED';
    const committed = await this.git(integration.path, ['commit', '--no-edit']);
    if (!committed.ok || committed.value.exitCode !== 0) return 'CONFLICT_COMMIT_FAILED';
    const merging = await this.git(integration.path, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    if (!merging.ok || merging.value.exitCode === 0) return 'CONFLICT_COMMIT_FAILED';
    return undefined;
  }
  async validateIntegration(
    _run: OrchRun,
    integration: Worktree,
    commands: readonly CommandSpec[] = [],
  ): Promise<Result<readonly CommandRun[]>> {
    const runs: CommandRun[] = [];
    for (const cmd of commands) {
      const res = await this.deps.apply.commands.run(integration.path, cmd);
      if (!res.ok) return res;
      runs.push(res.value);
    }
    return { ok: true, value: runs };
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
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (!result.ok) return result;
    if (result.value.exitCode !== 0)
      return {
        ok: false,
        error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not read the worktree diff.', retryable: false },
      };
    return { ok: true, value: truncateDiff(result.value.stdoutTail) };
  }
  private async trackedFiles(root: string): Promise<Result<readonly string[]>> {
    const listed = await this.deps.runner.run({
      executable: 'git',
      args: ['ls-files'],
      cwd: root,
      env: process.env,
      timeoutMs: 30_000,
      maxOutputBytes: 4 * 1024 * 1024,
    });
    if (!listed.ok) return listed;
    if (listed.value.exitCode !== 0)
      return {
        ok: false,
        error: { code: ErrorCode.COMMAND_FAILED, message: 'Could not list the project files.', retryable: false },
      };
    return {
      ok: true,
      value: listed.value.stdoutTail
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
  }
  async workerContext(worktree: Worktree, allowedPaths: readonly string[]): Promise<Result<WorkerContext>> {
    const tracked = await this.trackedFiles(worktree.path);
    if (!tracked.ok) return tracked;
    const files: WorkerContextFile[] = [];
    let total = 0;
    for (const path of tracked.value) {
      if (!allowedPaths.some((pattern) => globMatches(pattern, path))) continue;
      const read = await this.deps.apply.fileSystem.readFile(join(worktree.path, path));
      if (!read.ok) continue;
      const sha256 = createHash('sha256').update(read.value).digest('hex');
      const text = read.value.includes(0) ? undefined : new TextDecoder('utf-8').decode(read.value);
      const fits =
        text !== undefined &&
        read.value.byteLength <= MAX_CONTEXT_FILE_BYTES &&
        total + read.value.byteLength <= MAX_CONTEXT_TOTAL_BYTES;
      if (fits) total += read.value.byteLength;
      files.push(fits ? { path, sha256, content: text } : { path, sha256 });
    }
    return { ok: true, value: { tree: tracked.value.slice(0, MAX_TREE_ENTRIES), files } };
  }
  /** Orchestration works in Git worktrees: the project must be the root of a Git repository with a commit. */
  private async checkRepository(root: string): Promise<Result<void>> {
    const invalid = (message: string, remediation: string): Result<never> => ({
      ok: false,
      error: { code: ErrorCode.VALIDATION, message, remediation: [remediation], retryable: false },
    });
    const folder = await this.deps.apply.fileSystem.stat(root);
    if (!folder.ok || !folder.value.isDirectory)
      return invalid(
        `The project folder ${root} does not exist.`,
        'Open a project whose folder exists, or restore the folder.',
      );
    const git = (args: readonly string[]) =>
      this.deps.runner.run({ executable: 'git', args, cwd: root, env: process.env, timeoutMs: 30_000 });
    const top = await git(['rev-parse', '--show-toplevel']);
    if (!top.ok)
      return invalid('Git was not found on this computer.', 'Install Git for Windows, then restart IT Studio.');
    if (top.value.exitCode !== 0)
      return invalid(
        `Orchestration needs a Git repository, but ${root} is not one. Run "git init" in that folder and commit your files, or open a project that is a Git repository.`,
        'Run "git init", "git add -A" and "git commit" in the project folder.',
      );
    const repositoryRoot = top.value.stdoutTail.trim();
    // Git prints the real path; the project may be stored as a short (8.3) name or through a junction.
    if ((await canonicalPath(repositoryRoot)).toLocaleLowerCase() !== (await canonicalPath(root)).toLocaleLowerCase())
      return invalid(
        `${root} is inside the Git repository ${resolve(repositoryRoot)}. Open the repository root as the project.`,
        'Create the project from the repository root folder.',
      );
    const head = await git(['rev-parse', '--verify', 'HEAD']);
    if (!head.ok || head.value.exitCode !== 0)
      return invalid(
        `The Git repository ${root} has no commits yet. Commit your files once, then plan again.`,
        'Run "git add -A" and "git commit" in the project folder.',
      );
    return { ok: true, value: undefined };
  }
  async projectInfo(projectId: ProjectId): Promise<Result<ProjectInfo>> {
    const project = await this.deps.projects.get(projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    const ready = await this.checkRepository(project.workspaceRoot);
    if (!ready.ok) return ready;
    const tracked = await this.trackedFiles(project.workspaceRoot);
    if (!tracked.ok) return tracked;
    const branch = await this.deps.runner.run({
      executable: 'git',
      args: ['rev-parse', '--abbrev-ref', 'HEAD'],
      cwd: project.workspaceRoot,
      env: process.env,
      timeoutMs: 30_000,
    });
    const name = branch.ok && branch.value.exitCode === 0 ? branch.value.stdoutTail.trim() : '';
    return {
      ok: true,
      value: {
        root: project.workspaceRoot,
        branch: name.length > 0 && name !== 'HEAD' ? name : 'main',
        tree: tracked.value.slice(0, MAX_TREE_ENTRIES),
      },
    };
  }
  async cleanup(run: OrchRun, worktree: Worktree): Promise<Result<void>> {
    const project = await this.deps.projects.get(run.projectId);
    if (project === null)
      return { ok: false, error: { code: ErrorCode.NOT_FOUND, message: 'Project was not found.', retryable: false } };
    return this.deps.worktrees.cleanup(project.workspaceRoot, worktree);
  }
  async runWorktrees(run: OrchRun): Promise<readonly Worktree[]> {
    const project = await this.deps.projects.get(run.projectId);
    return project === null ? [] : this.deps.worktrees.listRun(project.workspaceRoot, run.id);
  }
}
