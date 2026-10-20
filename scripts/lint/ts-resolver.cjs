'use strict';

// Minimal import resolver (eslint-module-utils interface v2) so eslint-plugin-boundaries can follow the
// sidecar's relative `./file.js` specifiers to their `.ts` sources. Package imports are left to the node resolver.
const { statSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

exports.interfaceVersion = 2;

exports.resolve = (source, file) => {
  if (!source.startsWith('.')) return { found: false };
  const base = resolve(dirname(file), source);
  const stem = base.replace(/\.js$/u, '');
  const found = [base, `${stem}.ts`, `${stem}.tsx`, `${base}.ts`, resolve(base, 'index.ts')].find(isFile);
  return found === undefined ? { found: false } : { found: true, path: found };
};
