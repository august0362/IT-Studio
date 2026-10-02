import { join } from 'node:path';
import type { VSCodeSettings } from '@itstudio/schemas';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../infra/logger.js';
import type { FileStat, IFileSystem } from '../ports/file-system.js';
import type { CodeCliOutput, ICodeCliRunner } from '../ports/code-cli-runner.js';
import type { ResolvedCodeCli } from '../domain/code-cli.js';
import { VSCodeLauncher } from './vscode-launcher.js';

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
  autoLaunch: true,
  codeExecutable: null,
  showDiffBeforeValidate: true,
  revealChangedFiles: true,
};

function setup(
  options: {
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
