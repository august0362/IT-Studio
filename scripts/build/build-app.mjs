import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sidecarOutput = join(root, 'dist-sidecar');
const tauriRoot = join(root, 'apps/desktop/src-tauri');
const binaries = join(tauriRoot, 'binaries');
const stagedResources = join(tauriRoot, 'bundle-resources/resources');
const sidecarName = 'itstudio-sidecar-x86_64-pc-windows-msvc.exe';
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');

await runNpm(['run', 'build:sidecar']);
await stageSidecar();
runIconGenerator();
await runNpm([
  'run',
  'tauri',
  '--workspace',
  '@itstudio/desktop',
  '--',
  'build',
  '--bundles',
  'nsis,msi',
  '--config',
  'tauri.conf.release.json',
]);
await printInstallers();

async function stageSidecar() {
  const sourceExecutable = join(sidecarOutput, sidecarName);
  const sourceResources = join(sidecarOutput, 'resources');
  if (!(await exists(sourceExecutable))) throw new Error(`Missing SEA sidecar: ${sourceExecutable}`);
  if (!(await exists(sourceResources))) throw new Error(`Missing SEA resources: ${sourceResources}`);

  console.log('[build:app] Staging SEA sidecar and resources for Tauri');
  await rm(binaries, { recursive: true, force: true });
  await rm(join(tauriRoot, 'bundle-resources'), { recursive: true, force: true });
  await mkdir(binaries, { recursive: true });
  await mkdir(dirname(stagedResources), { recursive: true });
  await cp(sourceExecutable, join(binaries, sidecarName));
  await cp(sourceResources, stagedResources, { recursive: true });
}

async function printInstallers() {
  const bundleRoot = join(tauriRoot, 'target/release/bundle');
  const installers = [];
  for (const directory of ['nsis', 'msi']) {
    const path = join(bundleRoot, directory);
    if (!(await exists(path))) continue;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const installer = join(path, entry.name);
      const extension = entry.name.toLowerCase().endsWith('.msi')
        ? '.msi'
        : entry.name.toLowerCase().endsWith('.exe')
          ? '.exe'
          : '';
      if (extension) installers.push({ path: installer, size: (await stat(installer)).size });
    }
  }
  installers.sort((left, right) => left.path.localeCompare(right.path));
  if (installers.length === 0) throw new Error(`No NSIS or MSI installers found in ${bundleRoot}`);
  console.log('[build:app] Installers:');
  for (const installer of installers) {
    console.log(`  ${installer.path} (${formatBytes(installer.size)})`);
  }
}

function runNpm(args) {
  const result = spawnSync(process.execPath, [npmCli, '--cache', '.npm-cache', ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} exited with status ${String(result.status)}`);
}

function runIconGenerator() {
  const result = spawnSync(process.execPath, [join(root, 'scripts/build/make-icon.mjs')], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Icon generation exited with status ${String(result.status)}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes} bytes)`;
}
