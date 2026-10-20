import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrchRun, OrchTask, Project, ProjectId } from '@itstudio/schemas';
import { NodeFileSystem } from '../../kernel/infra/node-file-system.js';
import { NodeProcessRunner } from '../../kernel/infra/node-process-runner.js';
import { OrchWorkspace, type OrchWorkspaceDependencies } from './workspace.js';
import { WorktreeManager } from './worktrees.js';

const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'itstudio-orch-ws-'));
  created.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'ignore' });
}

function workspace(root: string, sidecarCwd?: string): OrchWorkspace {
  const runner = new NodeProcessRunner();
  const deps: OrchWorkspaceDependencies = {
    projects: { get: () => Promise.resolve({ workspaceRoot: root } as Project) },
    worktrees: new WorktreeManager(runner),
    apply: {
      runner,
      fileSystem: new NodeFileSystem(),
      commands: { run: () => Promise.reject(new Error('unused')) },
      writer: { prepare: () => Promise.reject(new Error('unused')) },
    },
    runner,
    ...(sidecarCwd === undefined ? {} : { sidecarCwd }),
  };
  return new OrchWorkspace(deps);
}

const projectId = 'p' as ProjectId;

describe('OrchWorkspace.projectInfo', () => {
  it('explains what is wrong when the project cannot be orchestrated', async () => {
    const missing = join(folder(), 'gone');
    expect(await workspace(missing).projectInfo(projectId)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION', message: expect.stringContaining('does not exist') as string },
    });

    const plain = folder();
    expect(await workspace(plain).projectInfo(projectId)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('needs a Git repository') as string },
    });

    const empty = folder();
    git(empty, 'init', '-q');
    expect(await workspace(empty).projectInfo(projectId)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('has no commits yet') as string },
    });

    writeFileSync(join(empty, 'a.txt'), 'a');
    git(empty, 'add', '-A');
    git(empty, 'commit', '-q', '-m', 'init');
    const nested = join(empty, 'sub');
    mkdirSync(nested);
    expect(await workspace(nested).projectInfo(projectId)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Open the repository root') as string },
    });
  });

  it('returns the root, current branch and tracked files of a valid repository', async () => {
    const repo = folder();
    git(repo, 'init', '-q', '-b', 'trunk');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.js'), 'export const a = 1;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    expect(await workspace(repo).projectInfo(projectId)).toEqual({
      ok: true,
      value: { root: repo, branch: 'trunk', tree: ['src/a.js'] },
    });
  });
});

function committedRepo(): string {
  const repo = folder();
  git(repo, 'init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'a.js'), 'export const a = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return repo;
}

/** The project folder as the owner opened it: a junction to the repository (Git reports the real path). */
function junctionTo(target: string): string {
  const link = join(folder(), 'project-link');
  symlinkSync(target, link, 'junction');
  return link;
}

const run = { id: 'run-path', projectId, targetBranch: 'main' } as OrchRun;
const task = { id: 'T1', allowedPaths: ['src/**'] } as unknown as OrchTask;

describe('OrchWorkspace project paths (STAB CI-01)', () => {
  it('CI-01 accepts a project opened through a junction or 8.3 short path and creates its worktree', async () => {
    const link = junctionTo(committedRepo());
    expect(await workspace(link).projectInfo(projectId)).toMatchObject({ ok: true, value: { branch: 'main' } });
    const prepared = await workspace(link).prepareAttempt(run, task, 1);
    expect(prepared).toMatchObject({ ok: true, value: { branch: 'itstudio/orch/run-path/T1-1' } });
  });

  it('CI-01 refuses a junction that points at IT Studio itself', async () => {
    const itStudio = committedRepo();
    const prepared = await workspace(junctionTo(itStudio), itStudio).prepareAttempt(run, task, 1);
    expect(prepared).toMatchObject({ ok: false, error: { code: 'TARGET_FORBIDDEN' } });
  });
});
