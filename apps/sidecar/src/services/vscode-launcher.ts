import { delimiter, dirname, join, resolve } from 'node:path';
import type { VSCodeSettings, VSCodeStatus } from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IFileSystem } from '../ports/file-system.js';
import type { ICodeCliRunner } from '../ports/code-cli-runner.js';
import { makeResolvedCodeCli, parseCodeCmd, type ResolvedCodeCli } from '../domain/code-cli.js';

const EXTENSION_ID = 'itstudio.itstudio-vscode';

export interface VscodeLauncherEvents {
  publishStatus(status: VSCodeStatus): void;
}

export interface VscodeLauncherDependencies {
  readonly fileSystem: IFileSystem;
  readonly runner: ICodeCliRunner;
  readonly logger: Logger;
  readonly events: VscodeLauncherEvents;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly repositoryRoot: string;
  readonly e2e?: boolean;
  readonly connected: () => boolean;
}

export interface VscodeActivation {
  readonly workspaceRoot: string;
  readonly settings: VSCodeSettings;
}

export class VSCodeLauncher {
  private readonly dependencies: VscodeLauncherDependencies;
  private readonly extensionVersion: string;
  private extensionCheck: Promise<boolean> | undefined;
  private readonly launchedProjects = new Set<string>();

  constructor(dependencies: VscodeLauncherDependencies, extensionVersion = '0.1.0') {
    this.dependencies = dependencies;
    this.extensionVersion = extensionVersion;
  }

  async activate({ workspaceRoot, settings }: VscodeActivation): Promise<void> {
    const root = resolve(workspaceRoot);
    const baseStatus = {
      connected: this.dependencies.connected(),
      workspaceRoot: root,
      extensionVersion: this.extensionVersion,
    };
    if (this.dependencies.e2e) {
      this.dependencies.events.publishStatus({ installed: true, extensionInstalled: true, ...baseStatus });
      return;
    }
    const cli = await this.resolveCli(settings.codeExecutable);
    if (cli === null) {
      this.warnOnce('Visual Studio Code was not found. Install VS Code or set its executable path in Settings.');
      this.dependencies.events.publishStatus({ installed: false, extensionInstalled: false, ...baseStatus });
      return;
    }
    this.dependencies.events.publishStatus({ installed: true, extensionInstalled: false, ...baseStatus });
    const extensionInstalled = await this.ensureExtension(cli);
    this.dependencies.events.publishStatus({ installed: true, extensionInstalled, ...baseStatus });
    if (!settings.autoLaunch || this.launchedProjects.has(root)) return;
    const launched = this.dependencies.runner.launch(cli, [root]);
    if (!launched.ok) {
      this.warnOnce('Visual Studio Code could not be launched. Check the installation and try again.');
      return;
    }
    this.launchedProjects.add(root);
  }

  private async ensureExtension(cli: ResolvedCodeCli): Promise<boolean> {
    this.extensionCheck ??= this.installOrCheck(cli);
    return await this.extensionCheck;
  }

  private async installOrCheck(cli: ResolvedCodeCli): Promise<boolean> {
    const listed = await this.dependencies.runner.run(cli, ['--list-extensions', '--show-versions']);
    if (!listed.ok || listed.value.exitCode !== 0) {
      this.warnOnce('The IT Studio VS Code extension could not be checked. VS Code will still open.');
      return false;
    }
    const installed = listed.value.stdout
      .split(/\r?\n/u)
      .some((line) => line.trim() === `${EXTENSION_ID}@${this.extensionVersion}`);
    if (installed) return true;
    const vsixPath =
      this.dependencies.env.ITSTUDIO_VSIX_PATH ??
      join(this.dependencies.repositoryRoot, 'apps', 'vscode-ext', 'dist', 'itstudio-vscode.vsix');
    const exists = await this.dependencies.fileSystem.exists(vsixPath);
    if (!exists.ok || !exists.value) {
      this.warnOnce(
        'The IT Studio VS Code extension package is missing. Build the extension package, then activate the project again.',
      );
      return false;
    }
    const installedResult = await this.dependencies.runner.run(cli, ['--install-extension', vsixPath, '--force']);
    if (!installedResult.ok || installedResult.value.exitCode !== 0) {
      this.warnOnce('The IT Studio VS Code extension could not be installed. VS Code will still open.');
      return false;
    }
    return true;
  }

  private async resolveCli(configuredPath: string | null): Promise<ResolvedCodeCli | null> {
    if (configuredPath !== null) {
      const configured = await this.resolveCandidate(configuredPath);
      if (configured !== null) return configured;
    }
    for (const entry of (this.dependencies.env.PATH ?? '').split(delimiter)) {
      for (const name of this.dependencies.platform === 'win32' ? ['code.cmd', 'code'] : ['code']) {
        const cli = await this.resolveCandidate(join(entry, name));
        if (cli !== null) return cli;
      }
    }
    const defaults = this.defaultDirectories();
    for (const directory of defaults) {
      for (const name of this.dependencies.platform === 'win32' ? ['code.cmd', 'code'] : ['code']) {
        const cli = await this.resolveCandidate(join(directory, name));
        if (cli !== null) return cli;
      }
    }
    return null;
  }

  private defaultDirectories(): string[] {
    if (this.dependencies.platform !== 'win32') return [];
    const paths: string[] = [];
    if (this.dependencies.env.LOCALAPPDATA !== undefined)
      paths.push(join(this.dependencies.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'bin'));
    if (this.dependencies.env.ProgramFiles !== undefined)
      paths.push(join(this.dependencies.env.ProgramFiles, 'Microsoft VS Code', 'bin'));
    return paths;
  }

  private async resolveCandidate(path: string): Promise<ResolvedCodeCli | null> {
    const exists = await this.dependencies.fileSystem.exists(path);
    if (!exists.ok || !exists.value) return null;
    if (this.dependencies.platform !== 'win32' || !path.toLocaleLowerCase('en-US').endsWith('.cmd')) {
      const real = await this.dependencies.fileSystem.realpath(path);
      return real.ok ? makeResolvedCodeCli(real.value, [], this.dependencies.platform === 'win32') : null;
    }
    const content = await this.dependencies.fileSystem.readFile(path);
    if (!content.ok) return null;
    const parsed = parseCodeCmd(Buffer.from(content.value).toString('utf8'));
    const installRoot = resolve(dirname(path), '..');
    const executablePath = resolve(dirname(path), parsed?.executableRelativePath ?? '..\\Code.exe');
    let cliPath: string | undefined;
    if (parsed !== null) cliPath = resolve(dirname(path), parsed.cliRelativePath);
    if (cliPath === undefined || !(await this.fileExists(cliPath))) {
      cliPath = await this.findNewestCli(installRoot);
    }
    if (cliPath === undefined || !(await this.fileExists(executablePath))) return null;
    const executable = await this.dependencies.fileSystem.realpath(executablePath);
    if (!executable.ok) return null;
    return makeResolvedCodeCli(executable.value, [cliPath], true);
  }

  private async fileExists(path: string): Promise<boolean> {
    const result = await this.dependencies.fileSystem.exists(path);
    return result.ok && result.value;
  }

  private async findNewestCli(resourcesParent: string): Promise<string | undefined> {
    const entries = await this.dependencies.fileSystem.readdir(resourcesParent);
    if (!entries.ok) return undefined;
    const candidates: { path: string; version: string }[] = [];
    for (const entry of entries.value) {
      const path = join(resourcesParent, entry, 'resources', 'app', 'out', 'cli.js');
      const exists = await this.fileExists(path);
      if (!exists) continue;
      candidates.push({ path, version: entry });
    }
    return candidates.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0]?.path;
  }

  private warned = false;

  private warnOnce(message: string): void {
    if (this.warned) return;
    this.warned = true;
    this.dependencies.logger.warn({ svc: 'vscode-launcher', message }, message);
  }
}
