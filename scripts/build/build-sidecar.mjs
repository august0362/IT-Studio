import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { inject } from 'postject';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'dist-sidecar');
const resources = join(output, 'resources');
const nodeModules = join(root, 'node_modules');
// esbuild validates plugin filters with Go's regexp engine, which rejects JS flags.
const CONTAINER_FILTER_SOURCE = 'container\\.ts$';
const SYSTEM_SERVICE_FILTER_SOURCE = 'system-service\\.ts$';
const MODULE_FILTER_SOURCE = '.+';
const nativePackages = [
  'better-sqlite3',
  '@lancedb/lancedb',
  '@lancedb/lancedb-win32-x64-msvc',
  '@napi-rs/keyring',
  '@napi-rs/keyring-win32-x64-msvc',
  'apache-arrow',
];
const nativeModules = join(root, 'apps/sidecar/src/infra/native-modules.ts');

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('The M9-01 SEA bundle must be built with Node.js on Windows x64.');

const executable = join(output, 'itstudio-sidecar-x86_64-pc-windows-msvc.exe');
await runStep('clean output directory', async () => {
  await rm(output, { recursive: true, force: true });
  await mkdir(resources, { recursive: true });
});

await runStep('esbuild sidecar bundle', async () => {
  await build({
    absWorkingDir: root,
    entryPoints: [join(root, 'apps/sidecar/src/main.ts')],
    outfile: join(output, 'sidecar.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    minify: true,
    sourcemap: 'external',
    packages: 'bundle',
    plugins: [
      {
        name: 'sea-resource-module-paths',
        setup(context) {
          context.onLoad({ filter: new RegExp(CONTAINER_FILTER_SOURCE) }, async (args) => ({
            contents: (await readFile(args.path, 'utf8')).replaceAll(
              'import.meta.url',
              "require('node:url').pathToFileURL(require('node:path').join(require('node:path').dirname(process.execPath), 'resources/apps/sidecar/src/container.js')).href",
            ),
            loader: 'ts',
          }));
          context.onLoad({ filter: new RegExp(SYSTEM_SERVICE_FILTER_SOURCE) }, async (args) => ({
            contents: (await readFile(args.path, 'utf8')).replaceAll(
              'import.meta.dirname',
              "require('node:path').join(require('node:path').dirname(process.execPath), 'resources/apps/sidecar/src/services')",
            ),
            loader: 'ts',
          }));
        },
      },
      {
        name: 'sea-external-module-loader',
        setup(context) {
          context.onResolve({ filter: new RegExp(MODULE_FILTER_SOURCE) }, (args) => {
            if (nativePackages.some((name) => args.path === name || args.path.startsWith(`${name}/`)))
              return { path: args.path, namespace: 'sea-external' };
            return undefined;
          });
          context.onLoad({ filter: new RegExp(MODULE_FILTER_SOURCE), namespace: 'sea-external' }, (args) => ({
            contents: `module.exports = require('./native-modules.js').loadExternal(${JSON.stringify(args.path)});`,
            loader: 'js',
            resolveDir: dirname(nativeModules),
          }));
        },
      },
    ],
    logLevel: 'info',
  });
});

await runStep('stage runtime resources', async () => {
  const stagedPackages = new Set();
  await stageRuntimePackage('better-sqlite3', stagedPackages);
  await stageRuntimePackage('@lancedb/lancedb', stagedPackages, true);
  await stageRuntimePackage('apache-arrow', stagedPackages, true);
  await stageRuntimePackage('@lancedb/lancedb-win32-x64-msvc', stagedPackages);
  await stageRuntimePackage('@napi-rs/keyring', stagedPackages);
  await stageRuntimePackage('@napi-rs/keyring-win32-x64-msvc', stagedPackages);

  const betterSqliteRoot = join(nodeModules, 'better-sqlite3');
  const betterSqliteBinaryCandidates = [
    join(betterSqliteRoot, 'build/Release/better_sqlite3.node'),
    join(betterSqliteRoot, 'prebuilds/win32-x64.node'),
  ];
  const betterSqliteBinary = await firstExisting(betterSqliteBinaryCandidates);
  if (!betterSqliteBinary) {
    throw new Error(`Missing better-sqlite3 Windows x64 binary (checked ${betterSqliteBinaryCandidates.join(', ')})`);
  }
  const betterSqliteTarget = join(resources, 'node_modules/better-sqlite3/prebuilds/win32-x64.node');
  await mkdir(dirname(betterSqliteTarget), { recursive: true });
  await cp(betterSqliteBinary, betterSqliteTarget);

  await stageNativeBinary('@lancedb/lancedb-win32-x64-msvc', 'lancedb.win32-x64-msvc.node');
  await stageNativeBinary('@napi-rs/keyring-win32-x64-msvc', 'keyring.win32-x64-msvc.node');
  await cp(join(root, 'apps/sidecar/src/infra/sqlite/migrations'), join(resources, 'migrations'), {
    recursive: true,
  });
  await mkdir(join(resources, 'apps/sidecar/src/infra/sqlite'), { recursive: true });
  await cp(
    join(root, 'apps/sidecar/src/infra/sqlite/migrations'),
    join(resources, 'apps/sidecar/src/infra/sqlite/migrations'),
    { recursive: true },
  );
  await mkdir(join(resources, 'apps/sidecar'), { recursive: true });
  await cp(join(root, 'apps/sidecar/package.json'), join(resources, 'apps/sidecar/package.json'));
  await cp(join(root, 'config'), join(resources, 'config'), {
    recursive: true,
    filter: async (path) => (await stat(path)).isDirectory() || path.endsWith('.json'),
  });
  const vsix = join(root, 'apps/vscode-ext/dist/itstudio-vscode.vsix');
  if (await exists(vsix)) await cp(vsix, join(resources, 'itstudio-vscode.vsix'));
});

await runStep('write resource SHA-256 manifest', async () => {
  const manifest = [];
  await collectFiles(resources, resources, manifest);
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(resources, 'manifest.json'), `${JSON.stringify({ files: manifest }, null, 2)}\n`);
  const resourceBytes = (
    await Promise.all(manifest.map(async (file) => (await stat(join(resources, file.path))).size))
  ).reduce((total, size) => total + size, 0);
  console.log(`Staged resources: ${(resourceBytes / (1024 * 1024)).toFixed(2)} MB (${resourceBytes} bytes)`);
});

await runStep('generate Node SEA blob', async () => {
  const config = join(root, 'scripts/build/sea-config.json');
  const nodeResult = spawnSync(process.execPath, ['--experimental-sea-config', config], {
    cwd: root,
    stdio: 'inherit',
  });
  if (nodeResult.error) throw nodeResult.error;
  if (nodeResult.status !== 0)
    throw new Error(`Node SEA config command exited with status ${String(nodeResult.status)}`);
});

await runStep('copy Node executable', () => cp(process.execPath, executable));
await runStep('inject SEA blob and fuse', async () => {
  await inject(executable, 'NODE_SEA_BLOB', await readFile(join(output, 'sea.blob')), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  });
  await rm(join(output, 'sea.blob'));
  console.log(`Built ${relative(root, executable)} (${(await stat(executable)).size} bytes)`);
});

async function runStep(name, operation) {
  console.log(`[build:sidecar] Starting: ${name}`);
  try {
    await operation();
    console.log(`[build:sidecar] Complete: ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`[build:sidecar] Failed: ${name}: ${detail}`, { cause: error });
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function firstExisting(paths) {
  for (const path of paths) if (await exists(path)) return path;
  return undefined;
}

async function stageNativeBinary(packageName, binaryName) {
  const source = join(nodeModules, packageName, binaryName);
  if (!(await exists(source))) throw new Error(`Missing native binary: ${source}`);
  const target = join(resources, 'node_modules', packageName, binaryName);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}

async function stageRuntimePackage(packageName, stagedPackages, includeDependencies = false) {
  if (stagedPackages.has(packageName)) return;
  stagedPackages.add(packageName);
  const sourceRoot = join(nodeModules, packageName);
  const packageJsonPath = join(sourceRoot, 'package.json');
  if (!(await exists(packageJsonPath))) throw new Error(`Missing runtime package: ${packageJsonPath}`);
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const targetRoot = join(resources, 'node_modules', packageName);
  await mkdir(targetRoot, { recursive: true });
  await cp(packageJsonPath, join(targetRoot, 'package.json'));
  await copyRuntimeJavaScript(sourceRoot, targetRoot);

  if (!includeDependencies) return;
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    await stageRuntimePackage(dependencyName, stagedPackages, true);
  }
}

async function copyRuntimeJavaScript(sourceRoot, targetRoot, current = sourceRoot) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const source = join(current, entry.name);
    const target = join(targetRoot, relative(sourceRoot, source));
    if (entry.isDirectory()) {
      if (isExcludedRuntimeDirectory(entry.name)) continue;
      await copyRuntimeJavaScript(sourceRoot, targetRoot, source);
    } else if (entry.name.endsWith('.js') && !isExcludedRuntimeFile(entry.name)) {
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target);
    }
  }
}

function isExcludedRuntimeDirectory(name) {
  return name === 'test' || name === 'tests' || name === '__tests__' || name === 'docs' || name === 'examples';
}

function isExcludedRuntimeFile(name) {
  return name.endsWith('.test.js') || name.endsWith('.spec.js') || name.endsWith('.d.ts') || name.endsWith('.map');
}

async function collectFiles(base, current, result) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) await collectFiles(base, path, result);
    else {
      const bytes = await readFile(path);
      result.push({
        path: relative(base, path).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
}
