import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = resolve(root, 'apps/desktop/src-tauri/tauri.conf.json');
const forbiddenPath = /(?:^|[\\/])(?:bundle-resources|binaries)(?:[\\/]|$)/i;

function findForbiddenPaths(value, path = '$') {
  if (typeof value === 'string') {
    assert.equal(
      forbiddenPath.test(value),
      false,
      `Base Tauri config references staged build output at ${path}: ${value}`,
    );
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenPaths(entry, `${path}[${index}]`));
    return;
  }

  if (typeof value === 'object' && value !== null) {
    Object.entries(value).forEach(([key, entry]) => {
      findForbiddenPaths(key, `${path} key`);
      findForbiddenPaths(entry, `${path}.${key}`);
    });
  }
}

test('TC-M9-004 debug config excludes release-only staged paths', async () => {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  findForbiddenPaths(config);
});

test('TC-M9-004 debug config guard rejects nested staged paths', () => {
  assert.throws(
    () => findForbiddenPaths({ bundle: { resources: ['src-tauri/bundle-resources/resources'] } }),
    /Base Tauri config references staged build output/,
  );
  assert.throws(
    () => findForbiddenPaths({ bundle: { externalBin: ['binaries/itstudio-sidecar'] } }),
    /Base Tauri config references staged build output/,
  );
});
