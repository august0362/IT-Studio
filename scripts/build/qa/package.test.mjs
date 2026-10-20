import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = join(root, 'dist-sidecar');
const resources = join(output, 'resources');
const executable = join(output, 'itstudio-sidecar-x86_64-pc-windows-msvc.exe');
const requiredResources = [
  'node_modules/better-sqlite3/package.json',
  'node_modules/better-sqlite3/prebuilds/win32-x64.node',
  'node_modules/@lancedb/lancedb/package.json',
  'node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node',
  'node_modules/@napi-rs/keyring/package.json',
  'node_modules/@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node',
  'node_modules/apache-arrow/package.json',
  'config/models.seed.json',
  'config/pricing.seed.json',
  'migrations/meta/_journal.json',
  'apps/sidecar/src/kernel/infra/sqlite/migrations/meta/_journal.json',
];

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function stagedFiles(base, current = base) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await stagedFiles(base, path)));
    else {
      const resource = relative(base, path).replaceAll('\\', '/');
      if (resource !== 'manifest.json') files.push(resource);
    }
  }
  return files;
}

function resourceFile(base, path) {
  assert.equal(typeof path, 'string', 'Manifest resource path must be a string');
  assert.match(path, /^[^\\]+$/, `Manifest path must use forward slashes: ${path}`);
  assert.ok(path.length > 0 && !path.startsWith('/') && !isAbsolute(path) && !win32.isAbsolute(path));
  const segments = path.split('/');
  assert.ok(segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'));
  const absolute = resolve(base, ...segments);
  assert.ok(absolute.startsWith(`${resolve(base)}${sep}`), `Resource escapes root: ${path}`);
  return absolute;
}

async function manifestFiles(base) {
  const parsed = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8'));
  assert.ok(parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.files));
  assert.ok(parsed.files.length > 0, 'Resource manifest is empty');
  const found = new Set();
  for (const entry of parsed.files) {
    assert.ok(entry !== null && typeof entry === 'object');
    const path = entry.path;
    const file = resourceFile(base, path);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(found.has(path), false, `Duplicate resource: ${path}`);
    found.add(path);
    assert.equal((await stat(file)).isFile(), true, `Missing resource file: ${path}`);
    assert.equal(await digest(file), entry.sha256, `Resource hash mismatch: ${path}`);
  }
  assert.deepEqual(
    (await stagedFiles(base)).sort(),
    [...found].sort(),
    'Resource manifest does not match staged files',
  );
  return found;
}

test('TC-M9-001 SEA executable and every staged resource match the manifest', async () => {
  assert.equal((await stat(executable)).isFile(), true);
  assert.ok((await stat(executable)).size > 0);
  const listed = await manifestFiles(resources);
  for (const path of requiredResources) assert.ok(listed.has(path), `Required resource absent: ${path}`);
  assert.ok([...listed].some((path) => path.startsWith('migrations/') && path.endsWith('.sql')));
  assert.ok([...listed].some((path) => path.startsWith('node_modules/@lancedb/lancedb/') && path.endsWith('.js')));
  const sourceVsix = join(root, 'apps/vscode-ext/dist/itstudio-vscode.vsix');
  if (await stat(sourceVsix).catch(() => undefined)) assert.ok(listed.has('itstudio-vscode.vsix'));
});

test('TC-M9-001 missing, changed, and traversal resources are rejected in isolated fixtures', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'itstudio-manifest-test-'));
  try {
    const path = 'config/models.seed.json';
    const target = join(fixture, 'config/models.seed.json');
    await mkdir(dirname(target), { recursive: true });
    await cp(join(resources, path), target);
    const original = await readFile(target);
    const entry = { path, sha256: createHash('sha256').update(original).digest('hex') };
    await writeFile(join(fixture, 'manifest.json'), JSON.stringify({ files: [entry] }));
    assert.deepEqual([...(await manifestFiles(fixture))], [path]);

    const unlisted = join(fixture, 'unlisted.json');
    await writeFile(unlisted, '{}');
    await assert.rejects(() => manifestFiles(fixture), /Resource manifest does not match staged files/);
    await rm(unlisted);

    await writeFile(target, Buffer.concat([original, Buffer.from('tampered')]));
    await assert.rejects(() => manifestFiles(fixture), /Resource hash mismatch/);

    await rm(target);
    await assert.rejects(() => manifestFiles(fixture), /ENOENT/);

    await writeFile(join(fixture, 'manifest.json'), JSON.stringify({ files: [{ ...entry, path: '../escape' }] }));
    await assert.rejects(() => manifestFiles(fixture), { name: 'AssertionError' });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test('TC-M9-002 SEA exits 2 and names the missing native module in an isolated copy', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'itstudio-sea-missing-native-'));
  try {
    const isolatedExe = join(fixture, 'itstudio-sidecar.exe');
    await cp(executable, isolatedExe);
    const result = spawnSync(isolatedExe, [], {
      cwd: fixture,
      env: { ...process.env, ITSTUDIO_DATA_DIR: join(fixture, 'data'), NODE_PATH: '', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Missing native module file: .*better-sqlite3.*win32-x64\.node/);
  } finally {
    await rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
