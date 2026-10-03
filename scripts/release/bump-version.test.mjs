import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  bumpVersion,
  changelogForRelease,
  parseCargoVersion,
  parseJsonManifest,
  parseVersion,
  replaceCargoVersion,
} from './bump-version.mjs';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

test('semver bump table', () => {
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

test('rejects prerelease and malformed semantic versions', () => {
  for (const version of ['1.2.3-alpha.1', 'v1.2.3', '01.2.3', '1.2']) {
    assert.throws(() => parseVersion(version), /Invalid stable semantic version/);
  }
  assert.throws(() => bumpVersion('1.2.3-beta', 'patch'), /Invalid stable semantic version/);
});

test('parses valid JSON and Cargo fixtures and reports malformed manifests', async () => {
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

test('moves a non-empty Unreleased section and starts fresh standard subsections', () => {
  const source =
    '# Changelog\n\n## [Unreleased]\n\n### Added\n- A feature\n\n## [0.1.0] — 2026-01-01\n\n### Added\n- First release\n';
  const result = changelogForRelease(source, '0.2.0', '2026-10-04');
  assert.match(result, /^## \[Unreleased\]\n\n### Added\n\n### Changed/m);
  assert.match(result, /## \[0\.2\.0\] — 2026-10-04\n\n### Added\n- A feature/);
  assert.match(result, /## \[0\.1\.0\] — 2026-01-01/);
});

test('refuses an empty Unreleased section', () => {
  for (const source of [
    '# Changelog\n\n## [Unreleased]\n\n## [0.1.0]\n',
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n## [0.1.0]\n',
  ]) {
    assert.throws(() => changelogForRelease(source, '1.0.0', '2026-10-04'), /Unreleased section is empty/);
  }
});
