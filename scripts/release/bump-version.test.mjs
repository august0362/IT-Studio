import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  bumpVersion,
  changelogForRelease,
  parseCargoVersion,
  parseJsonManifest,
  parseVersion,
  replaceCargoVersion,
  run,
} from './bump-version.mjs';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

test('TC-M9-011 semver bump table covers major minor patch and explicit versions', () => {
  const cases = [
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'patch', '1.2.4'],
    ['1.2.3', '4.5.6', '4.5.6'],
    ['0.0.0', 'patch', '0.0.1'],
  ];
  for (const [current, requested, expected] of cases) {
    assert.equal(bumpVersion(current, requested), expected);
  }
});

test('TC-M9-011 rejects prerelease and malformed semantic versions', () => {
  for (const version of ['1.2.3-alpha.1', 'v1.2.3', '01.2.3', '1.2']) {
    assert.throws(() => parseVersion(version), /Invalid stable semantic version/);
  }
  assert.throws(() => bumpVersion('1.2.3-beta', 'patch'), /Invalid stable semantic version/);
});

test('TC-M9-011 parses JSON and Cargo fixtures and reports malformed manifests', async () => {
  const validJson = await readFile(resolve(FIXTURES, 'valid-package.json'), 'utf8');
  const malformedJson = await readFile(resolve(FIXTURES, 'malformed-package.json'), 'utf8');
  const cargo = await readFile(resolve(FIXTURES, 'valid-cargo.txt'), 'utf8');
  assert.equal(parseJsonManifest(validJson).version, '1.2.3');
  assert.throws(
    () => parseJsonManifest(malformedJson, 'malformed-package.json'),
    /expected an object with a string version/,
  );
  assert.equal(parseCargoVersion(cargo), '1.2.3');
  assert.match(replaceCargoVersion(cargo, '2.0.0'), /version = "2\.0\.0"/);
  assert.throws(() => parseCargoVersion('[dependencies]\nserde = "1"'), /missing \[package\] version/);
  assert.throws(() => parseJsonManifest('{"version":"1.0.0-rc.1"}'), /Invalid stable semantic version/);
});

test('TC-M9-011 moves a non-empty Unreleased section and starts fresh subsections', () => {
  const source =
    '# Changelog\n\n## [Unreleased]\n\n### Added\n- A feature\n\n## [0.1.0] — 2026-01-01\n\n### Added\n- First release\n';
  const result = changelogForRelease(source, '0.2.0', '2026-10-04');
  assert.match(result, /^## \[Unreleased\]\n\n### Added\n\n### Changed/m);
  assert.match(result, /## \[0\.2\.0\] — 2026-10-04\n\n### Added\n- A feature/);
  assert.match(result, /## \[0\.1\.0\] — 2026-01-01/);
});

test('TC-M9-011 refuses an empty Unreleased section', () => {
  for (const source of [
    '# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n',
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n## [0.1.0]\n',
  ]) {
    assert.throws(() => changelogForRelease(source, '1.0.0', '2026-10-04'), /Unreleased section is empty/);
  }
});

const versionFiles = [
  'package.json',
  'apps/desktop/package.json',
  'apps/sidecar/package.json',
  'apps/vscode-ext/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
  'apps/desktop/src-tauri/Cargo.toml',
];
const releaseFiles = [...versionFiles, 'CHANGELOG.md'];

async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'itstudio-release-test-'));
  for (const path of versionFiles) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    const content = path.endsWith('.toml')
      ? '[package]\nname = "itstudio"\nversion = "1.2.3"\n'
      : `${JSON.stringify({ name: path, version: '1.2.3' })}\n`;
    await writeFile(join(root, path), content);
  }
  await writeFile(
    join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- A fix\n\n## [1.2.3] — 2026-01-01\n',
  );
  return root;
}

async function snapshots(root) {
  return Promise.all(releaseFiles.map((path) => readFile(join(root, path), 'utf8')));
}

test('TC-M9-011 dry-run changes none of six manifests or changelog', async () => {
  const root = await releaseFixture();
  try {
    const before = await snapshots(root);
    await run(['patch', '--dry-run'], root, new Date('2026-10-04T00:00:00.000Z'));
    assert.deepEqual(await snapshots(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('TC-M9-011 mismatch and empty Unreleased fail before writing files', async () => {
  const root = await releaseFixture();
  try {
    const mismatched = join(root, 'apps/sidecar/package.json');
    await writeFile(mismatched, '{"version":"1.2.4"}\n');
    const beforeMismatch = await snapshots(root);
    await assert.rejects(() => run(['patch', '--dry-run'], root), /Version mismatch/);
    assert.deepEqual(await snapshots(root), beforeMismatch);

    await writeFile(mismatched, '{"version":"1.2.3"}\n');
    await writeFile(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n\n');
    const beforeEmpty = await snapshots(root);
    await assert.rejects(() => run(['patch', '--dry-run'], root), /Unreleased section is empty/);
    assert.deepEqual(await snapshots(root), beforeEmpty);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
