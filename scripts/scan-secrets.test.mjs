import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceScanner = fileURLToPath(new URL('./scan-secrets.mjs', import.meta.url));
const packageFile = fileURLToPath(new URL('../package.json', import.meta.url));
const fakeSecret = ['sk', 'FAKEKEY' + 'x'.repeat(24)].join('-');

function git(repository, args, input) {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8', input, timeout: 30_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function temporaryRepository(context) {
  const repository = mkdtempSync(path.join(tmpdir(), 'itstudio-secret-scan-'));
  context.after(() => {
    // Only remove the task's own temporary repository, never a computed parent directory.
    assert.equal(path.dirname(repository), path.resolve(tmpdir()));
    assert.ok(path.basename(repository).startsWith('itstudio-secret-scan-'));
    rmSync(repository, { recursive: true, force: true });
  });
  mkdirSync(path.join(repository, 'scripts'));
  copyFileSync(sourceScanner, path.join(repository, 'scripts', 'scan-secrets.mjs'));
  git(repository, ['init', '-q']);
  git(repository, ['config', 'core.autocrlf', 'false']);
  return repository;
}

function scan(repository, requestedFiles = [], cwd = repository) {
  return spawnSync(process.execPath, [path.join(repository, 'scripts', 'scan-secrets.mjs'), ...requestedFiles], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function assertClean(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
}

test('lint auto-discovers a filename list exceeding the Windows 32,767-character argument limit', (context) => {
  const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
  assert.match(manifest.scripts.lint, /&& node scripts\/scan-secrets\.mjs$/);
  const repository = temporaryRepository(context);
  const directory = path.join(repository, 'candidates');
  mkdirSync(directory);
  let lastFile;
  for (let index = 0; index < 420; index += 1) {
    lastFile = path.join(directory, `candidate-${String(index).padStart(4, '0')}-${'x'.repeat(74)}.txt`);
    writeFileSync(lastFile, 'Ordinary documentation.\n');
  }
  const files = git(repository, ['ls-files', '-z', '-co', '--exclude-standard']).split('\0').filter(Boolean);
  assert.ok(files.reduce((total, file) => total + file.length + 3, 0) > 32_767);
  assertClean(scan(repository));

  // Finding the last candidate proves auto-discovery still scans the large list.
  writeFileSync(lastFile, fakeSecret);
  const result = scan(repository);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /candidate-0419-.*\.txt:1: openai-api-key/);
  assert.equal(result.stdout.includes(fakeSecret), false);
  assert.equal(result.stderr, '');
});

test('auto-discovery skips deleted tracked files, ignored files and lint fixtures', (context) => {
  const repository = temporaryRepository(context);
  mkdirSync(path.join(repository, 'scripts', 'lint-fixtures'));
  writeFileSync(path.join(repository, '.gitignore'), 'ignored-secret.txt\n');
  writeFileSync(path.join(repository, 'ignored-secret.txt'), fakeSecret);
  writeFileSync(path.join(repository, 'scripts', 'lint-fixtures', 'bad-secret.txt'), fakeSecret);
  writeFileSync(path.join(repository, 'deleted.txt'), 'Removed tracked documentation.\n');
  git(repository, ['add', 'deleted.txt']);
  rmSync(path.join(repository, 'deleted.txt'));
  assertClean(scan(repository));

  const filename = 'Tài liệu có khoảng trắng.txt';
  writeFileSync(path.join(repository, filename), fakeSecret);
  const result = scan(repository, [], path.join(repository, 'scripts'));
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, `${filename}:1: openai-api-key\n`);
  assert.equal(result.stdout.includes(fakeSecret), false);
  assert.equal(result.stderr, '');
});

test('auto-discovery deduplicates files represented by multiple Git index stages', (context) => {
  const repository = temporaryRepository(context);
  const filename = 'duplicate.txt';
  writeFileSync(path.join(repository, filename), fakeSecret);
  const objectId = git(repository, ['hash-object', '-w', '--stdin'], 'Ordinary staged content.\n').trim();
  const stages = [1, 2, 3].map((stage) => `100644 ${objectId} ${stage}\t${filename}\n`).join('');
  git(repository, ['update-index', '--index-info'], stages);
  const files = git(repository, ['ls-files', '-z', '-co', '--exclude-standard']).split('\0');
  assert.equal(files.filter((file) => file === filename).length, 3);

  const result = scan(repository);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, `${filename}:1: openai-api-key\n`);
  assert.equal(result.stdout.includes(fakeSecret), false);
  assert.equal(result.stderr, '');
});

test('explicit fixture scanning still rejects and masks keys; explicit missing files still fail', (context) => {
  const repository = temporaryRepository(context);
  const fixture = 'scripts/lint-fixtures/bad-secret.txt';
  mkdirSync(path.join(repository, 'scripts', 'lint-fixtures'));
  writeFileSync(path.join(repository, fixture), fakeSecret);
  assertClean(scan(repository));
  const secretResult = scan(repository, [fixture]);
  assert.equal(secretResult.error, undefined);
  assert.equal(secretResult.status, 1);
  assert.equal(secretResult.stdout, `${fixture}:1: openai-api-key\n`);
  assert.equal(secretResult.stdout.includes(fakeSecret), false);
  assert.equal(secretResult.stderr, '');

  const missingResult = scan(repository, ['missing.txt']);
  assert.equal(missingResult.error, undefined);
  assert.equal(missingResult.status, 1);
  assert.equal(missingResult.stdout, '');
  assert.equal(missingResult.stderr, 'Unable to scan missing.txt: ENOENT\n');
});
