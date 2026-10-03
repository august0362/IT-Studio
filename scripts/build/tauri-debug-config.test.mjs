import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = resolve(root, 'apps/desktop/src-tauri/tauri.conf.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
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

findForbiddenPaths(config);
