import { createProcessProbe } from './process-test-helper.js';
import type { IProcessTracker } from '../ports/process-tracker.js';
import { join } from 'node:path';
import type { VSCodeSettings, RpcNotificationMap } from '@itstudio/schemas';
import { createFakeClock, type IClock } from '../infra/clock.js';
import { projectIdSchema } from '../validation/brand.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { EventBus } from '../rpc/event-bus.js';
import { ProcessRegistry } from './process-registry.js';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../infra/logger.js';
import type { FileStat, IFileSystem } from '../ports/file-system.js';
import type { CodeCliOutput, ICodeCliRunner } from '../ports/code-cli-runner.js';
import type { ResolvedCodeCli } from '../domain/code-cli.js';
import { VSCodeLauncher, type VscodeLauncherDependencies } from './vscode-launcher.js';

class FakeFileSystem implements IFileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Map<string, readonly string[]>();

  readFile(path: string) {
    const value = this.files.get(path);
    return Promise.resolve(
      value === undefined ? { ok: false as const, error: fileError } : { ok: true as const, value },
    );
  }
  writeFile() {
    return Promise.resolve({ ok: true as const, value: undefined });
  }
  rename() {
    return Promise.resolve({ ok: true as const, value: undefined });
  }
  unlink() {
    return Promise.resolve({ ok: true as const, value: undefined });
  }
  mkdir() {
    return Promise.resolve({ ok: true as const, value: undefined });
  }
  rmdirIfEmpty() {
    return Promise.resolve({ ok: true as const, value: false });
  }
  stat(path: string) {
    const value: FileStat = { isFile: this.files.has(path), isDirectory: false, isSymbolicLink: false, size: 1 };
    return Promise.resolve({ ok: true as const, value });
  }
  realpath(path: string) {
    return Promise.resolve({ ok: true as const, value: path });
  }
  exists(path: string) {
    return Promise.resolve({ ok: true as const, value: this.files.has(path) });
  }
  readdir(path: string) {
    return Promise.resolve({ ok: true as const, value: this.directories.get(path) ?? [] });
  }
  copyFile() {
    return Promise.resolve({ ok: true as const, value: undefined });
  }
  fsync() {
    return Promise.resolve({ ok: true as const, value: undefined });
  }
}

const fileError = {
  code: 'NOT_FOUND' as const,
  message: 'File missing.',
  retryable: false,
  remediation: ['Add the file.'],
};

class FakeRunner implements ICodeCliRunner {
  readonly runs: { cli: ResolvedCodeCli; args: readonly string[] }[] = [];
  readonly launches: { cli: ResolvedCodeCli; args: readonly string[] }[] = [];
  listed = '';
  runResult: CodeCliOutput = { exitCode: 0, timedOut: false, stdout: '', stderr: '' };

  run(cli: ResolvedCodeCli, args: readonly string[]) {
    this.runs.push({ cli, args });
    return Promise.resolve({
      ok: true as const,
      value: { ...this.runResult, stdout: args[0] === '--list-extensions' ? this.listed : '' },
    });
  }
  launch(cli: ResolvedCodeCli, args: readonly string[]) {
    this.launches.push({ cli, args });
    return { ok: true as const, value: undefined };
  }
}

const settings: VSCodeSettings = {
  closeWithStudio: true,
  closeWithProject: true,
  closeManuallyOpened: false,
  autoLaunch: true,
  codeExecutable: null,
  showDiffBeforeValidate: true,
  revealChangedFiles: true,
};

function setup(
  options: {
    readonly processes?: IProcessTracker;
    readonly onLaunched?: VscodeLauncherDependencies['onLaunched'];
    readonly clock?: IClock;
    readonly files?: readonly string[];
    readonly env?: NodeJS.ProcessEnv;
    readonly platform?: NodeJS.Platform;
    readonly e2e?: boolean;
    readonly output?: string;
  } = {},
) {
  const fileSystem = new FakeFileSystem();
  for (const file of options.files ?? []) fileSystem.files.set(file, Buffer.from('fake executable'));
  const runner = new FakeRunner();
  runner.listed = options.output ?? '';
  const statuses: unknown[] = [];
  const launcher = new VSCodeLauncher({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.onLaunched === undefined ? {} : { onLaunched: options.onLaunched }),
    ...(options.processes === undefined ? {} : { processes: options.processes }),
    fileSystem,
    runner,
    logger: createLogger({ level: 'silent' }),
    events: { publishStatus: (status) => statuses.push(status) },
    env: options.env ?? {},
    platform: options.platform ?? 'linux',
    repositoryRoot: process.cwd(),
    ...(options.e2e === undefined ? {} : { e2e: options.e2e }),
    connected: () => true,
  });
  return { fileSystem, runner, statuses, launcher };
}

describe('VSCodeLauncher', () => {
  it('PROC-01 instruments VS Code launch stages using fake CLI and filesystem', async () => {
    const probe = createProcessProbe();
    const cli = join(process.cwd(), 'process-cli', 'code');
    const h = setup({ files: [cli], processes: probe.tracker });
    await h.launcher.activate({ workspaceRoot: process.cwd(), settings: { ...settings, codeExecutable: cli } });
    expect(probe.start).toHaveBeenCalledWith('vscode_launch', expect.objectContaining({ title: 'Open VS Code' }));
    for (const module of ['locate', 'launch'])
      expect(probe.module).toHaveBeenCalledWith(expect.anything(), module, expect.objectContaining({ state: 'done' }));
    expect(probe.module).toHaveBeenCalledWith(
      expect.anything(),
      'session',
      expect.objectContaining({ state: 'active' }),
    );
    expect(probe.end).not.toHaveBeenCalled();
    expect(h.runner.launches[0]?.args).toEqual(['--new-window', process.cwd()]);
    h.launcher.windowClosed(process.cwd(), 'project_closed');
    expect(probe.end).toHaveBeenCalledWith(expect.anything(), 'closed by IT Studio (project closed)');
    expect(probe.module).toHaveBeenCalledWith(
      expect.anything(),
      'session',
      expect.objectContaining({ output: 'closed by IT Studio (project closed)' }),
    );
    await h.launcher.activate({ workspaceRoot: process.cwd(), settings: { ...settings, codeExecutable: cli } });
    expect(h.runner.launches).toHaveLength(2);
  });
  it('TC-M7-041 resolves a configured executable before PATH and default locations', async () => {
    const configured = join(process.cwd(), 'custom', 'code');
    const pathCandidate = join(process.cwd(), 'path', 'code');
    const { launcher, runner, fileSystem } = setup({
      files: [configured, pathCandidate],
      env: { PATH: join(process.cwd(), 'path'), LOCALAPPDATA: join(process.cwd(), 'local') },
    });
    const vsix = join(process.cwd(), 'apps', 'vscode-ext', 'dist', 'itstudio-vscode.vsix');
    fileSystem.files.set(vsix, Buffer.from('vsix'));
    await launcher.activate({ workspaceRoot: process.cwd(), settings: { ...settings, codeExecutable: configured } });
    expect(runner.runs[0]?.cli.executable).toBe(configured);
    expect(runner.launches[0]?.cli.executable).toBe(configured);
  });

  it('TC-M7-041 searches PATH then default locations and reports not found without throwing', async () => {
    const pathCandidate = join(process.cwd(), 'path', 'code');
    const pathSetup = setup({ files: [pathCandidate], env: { PATH: join(process.cwd(), 'path') } });
    await pathSetup.launcher.activate({ workspaceRoot: process.cwd(), settings });
    expect(pathSetup.runner.launches[0]?.cli.executable).toBe(pathCandidate);

    const defaultCandidate = join(process.cwd(), 'local', 'Programs', 'Microsoft VS Code', 'bin', 'code');
    const defaultSetup = setup({
      files: [defaultCandidate],
      env: { LOCALAPPDATA: join(process.cwd(), 'local') },
      platform: 'win32',
    });
    await defaultSetup.launcher.activate({ workspaceRoot: process.cwd(), settings });
    expect(defaultSetup.runner.launches[0]?.cli.executable).toBe(defaultCandidate);

    const absent = setup();
    await expect(absent.launcher.activate({ workspaceRoot: process.cwd(), settings })).resolves.toBeUndefined();
    expect(absent.statuses[0]).toMatchObject({ installed: false, extensionInstalled: false, connected: true });
  });

  it('TC-M7-042 installs missing or outdated extensions and skips an exact version match', async () => {
    const executable = join(process.cwd(), 'bin', 'code');
    const vsix = join(process.cwd(), 'apps', 'vscode-ext', 'dist', 'itstudio-vscode.vsix');
    const missing = setup({ files: [executable], env: { PATH: join(process.cwd(), 'bin'), ITSTUDIO_VSIX_PATH: vsix } });
    missing.fileSystem.files.set(vsix, Buffer.from('vsix'));
    await missing.launcher.activate({ workspaceRoot: process.cwd(), settings });
    expect(missing.runner.runs.map(({ args }) => args)).toEqual([
      ['--list-extensions', '--show-versions'],
      ['--install-extension', vsix, '--force'],
    ]);

    const outdated = setup({
      files: [executable],
      env: { PATH: join(process.cwd(), 'bin'), ITSTUDIO_VSIX_PATH: vsix },
      output: 'itstudio.itstudio-vscode@0.0.9',
    });
    outdated.fileSystem.files.set(vsix, Buffer.from('vsix'));
    await outdated.launcher.activate({ workspaceRoot: process.cwd(), settings });
    expect(outdated.runner.runs.at(-1)?.args).toEqual(['--install-extension', vsix, '--force']);

    const same = setup({
      files: [executable],
      env: { PATH: join(process.cwd(), 'bin') },
      output: 'itstudio.itstudio-vscode@0.1.0',
    });
    await same.launcher.activate({ workspaceRoot: process.cwd(), settings });
    expect(same.runner.runs).toHaveLength(1);
    expect(same.statuses.at(-1)).toMatchObject({ extensionInstalled: true });
  });

  it('resolves Windows code.cmd to Code.exe and its CLI script', async () => {
    const command = join(process.cwd(), 'VS Code', 'bin', 'code.cmd');
    const installRoot = join(process.cwd(), 'VS Code');
    const executable = join(installRoot, 'Code.exe');
    const cliPath = join(installRoot, '1.99.0-commit.abc123', 'resources', 'app', 'out', 'cli.js');
    const instance = setup({ files: [command, executable, cliPath], platform: 'win32' });
    instance.fileSystem.files.set(
      command,
      Buffer.from('"%~dp0..\\Code.exe" "%~dp0..\\1.99.0-commit.abc123\\resources\\app\\out\\cli.js"'),
    );
    const vsix = join(process.cwd(), 'apps', 'vscode-ext', 'dist', 'itstudio-vscode.vsix');
    instance.fileSystem.files.set(vsix, Buffer.from('vsix'));
    await instance.launcher.activate({
      workspaceRoot: process.cwd(),
      settings: { ...settings, codeExecutable: command },
    });
    expect(instance.runner.runs[0]?.cli).toMatchObject({ executable, prefixArgs: [cliPath], windows: true });
    expect(instance.runner.launches[0]?.cli).toMatchObject({ executable, prefixArgs: [cliPath], windows: true });
  });

  it('uses the newest available Windows CLI script when code.cmd is malformed', async () => {
    const command = join(process.cwd(), 'VS Code', 'bin', 'code.cmd');
    const installRoot = join(process.cwd(), 'VS Code');
    const executable = join(installRoot, 'Code.exe');
    const olderCli = join(installRoot, '1.9.0', 'resources', 'app', 'out', 'cli.js');
    const newestCli = join(installRoot, '1.10.0', 'resources', 'app', 'out', 'cli.js');
    const instance = setup({ files: [command, executable, olderCli, newestCli], platform: 'win32' });
    instance.fileSystem.files.set(command, Buffer.from('malformed command file'));
    instance.fileSystem.directories.set(installRoot, ['1.9.0', '1.10.0']);
    const vsix = join(process.cwd(), 'apps', 'vscode-ext', 'dist', 'itstudio-vscode.vsix');
    instance.fileSystem.files.set(vsix, Buffer.from('vsix'));
    await instance.launcher.activate({
      workspaceRoot: process.cwd(),
      settings: { ...settings, codeExecutable: command },
    });
    expect(instance.runner.launches[0]?.cli).toMatchObject({ executable, prefixArgs: [newestCli], windows: true });
  });

  it('TC-M7-044 honors autoLaunch off and does not install or launch VS Code', async () => {
    const executable = join(process.cwd(), 'bin', 'code');
    const instance = setup({ files: [executable], env: { PATH: join(process.cwd(), 'bin') } });
    await instance.launcher.activate({ workspaceRoot: process.cwd(), settings });
    await instance.launcher.activate({ workspaceRoot: process.cwd(), settings });
    expect(instance.runner.launches).toHaveLength(1);
    expect(instance.statuses[0]).toMatchObject({ installed: true, extensionInstalled: false });

    const off = setup({ files: [executable], env: { PATH: join(process.cwd(), 'bin') } });
    const vsix = join(process.cwd(), 'apps', 'vscode-ext', 'dist', 'itstudio-vscode.vsix');
    off.fileSystem.files.set(vsix, Buffer.from('vsix'));
    await off.launcher.activate({ workspaceRoot: process.cwd(), settings: { ...settings, autoLaunch: false } });
    expect(off.runner.launches).toHaveLength(0);
    expect(off.runner.runs).toHaveLength(0);
  });

  it('does not touch the filesystem or launch a real process in E2E mode', async () => {
    const instance = setup({ e2e: true });
    await instance.launcher.activate({ workspaceRoot: process.cwd(), settings });
    expect(instance.runner.runs).toHaveLength(0);
    expect(instance.runner.launches).toHaveLength(0);
    expect(instance.statuses[0]).toMatchObject({ installed: true, extensionInstalled: true });
  });
});

describe('VSC-01 launch process lifecycle', () => {
  it('persists the final session output in the real process registry when Studio closes the window', async () => {
    const registry = new ProcessRegistry({
      repository: { load: () => [], save: () => undefined },
      events: new EventBus<RpcNotificationMap>(),
      clock: createFakeClock(),
      ids: createFakeIdGenerator(['10000000-0000-4000-8000-000000000001']),
      logger: createLogger({ streams: [] }),
      dispatch: () => Promise.resolve({ ok: true, value: undefined }),
      cancelRecovered: () => Promise.resolve({ ok: true, value: undefined }),
    });
    try {
      const instance = setup({ e2e: true, processes: registry });
      await instance.launcher.activate({ workspaceRoot: process.cwd(), settings });
      expect(registry.list({ limit: 10 })).toMatchObject({
        ok: true,
        value: [{ status: 'running', kind: 'vscode_launch' }],
      });
      instance.launcher.windowClosed(process.cwd(), 'project_closed');
      const result = registry.list({ limit: 10 });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('Expected process records');
      expect(result.value[0]?.status).toBe('ended');
      expect(result.value[0]?.modules.find((module) => module.id === 'session')).toMatchObject({
        state: 'done',
        output: 'closed by IT Studio (project closed)',
      });
    } finally {
      registry.stop();
    }
  });
});

describe('VSC-01 launcher ownership metadata', () => {
  it('records only successful launches with project, workspace, and injected launch time', async () => {
    const cli = join(process.cwd(), 'ownership-cli', 'code');
    const clock = createFakeClock();
    clock.advance(123);
    const onLaunched = vi.fn<NonNullable<VscodeLauncherDependencies['onLaunched']>>();
    const instance = setup({ files: [cli], onLaunched, clock });
    const projectId = projectIdSchema.parse('20000000-0000-4000-8000-000000000001');
    const activation = { projectId, workspaceRoot: process.cwd(), settings: { ...settings, codeExecutable: cli } };
    await instance.launcher.activate(activation);
    await instance.launcher.activate(activation);
    expect(onLaunched).toHaveBeenCalledExactlyOnceWith(projectId, process.cwd(), 123);
    instance.launcher.windowDisconnected(process.cwd());
    clock.advance(10);
    await instance.launcher.activate(activation);
    expect(onLaunched).toHaveBeenLastCalledWith(projectId, process.cwd(), 133);
    const missing = setup({ onLaunched });
    await missing.launcher.activate({ ...activation, settings: { ...settings, codeExecutable: null } });
    await instance.launcher.activate({ ...activation, settings: { ...activation.settings, autoLaunch: false } });
    expect(onLaunched).toHaveBeenCalledTimes(2);
  });
});
