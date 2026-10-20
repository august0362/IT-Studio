#!/usr/bin/env node
// Creates a small, disposable Git project for the owner acceptance checks
// (docs/qa/stabilization/04-OWNER-ACCEPTANCE.md): pipeline, orchestration, RAG and VS Code cases run against it,
// never against a real owner project.
//
//   node scripts/dev/acceptance-fixture.mjs [target-folder]
//
// The target must not exist or must be an empty folder. Default: %USERPROFILE%\itstudio-acceptance-<date>.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILES = {
  'README.md': '# Acceptance sample\n\nDisposable project for IT Studio owner acceptance checks. Safe to delete.\n',
  'package.json': `${JSON.stringify(
    {
      name: 'itstudio-acceptance-sample',
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: { test: 'node --test' },
    },
    null,
    2,
  )}\n`,
  'src/greet.js': 'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
  'src/math/sum.js': 'export function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}\n',
  'test/greet.test.js':
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from '../src/greet.js';\n\ntest('greets by name', () => {\n  assert.equal(greet('Ada'), 'Hello, Ada!');\n});\n",
  'test/sum.test.js':
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/math/sum.js';\n\ntest('adds numbers', () => {\n  assert.equal(sum([1, 2, 3]), 6);\n});\n",
  // Knowledge (RAG) fixtures: each holds one fact that appears nowhere else, so a retrieval hit is unambiguous.
  'docs/warehouse-policy.md':
    '# Warehouse policy\n\nThe night shift at the Da Nang warehouse starts at 22:15 and the loading dock code is ORCHID-7.\n',
  'docs/refund-rules.md':
    '# Refund rules\n\nCustomers may request a refund within 41 days. Refunds above 3 million VND need approval from the finance lead, Ms. Lan.\n',
  'docs/release-notes.md':
    '# Release notes\n\nVersion 2.4 "Lotus" removed the legacy CSV export and added the quarterly audit report.\n',
};

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

export function createAcceptanceRepo(target) {
  const root = resolve(target);
  if (existsSync(root) && readdirSync(root).length > 0)
    throw new Error(`Refusing to use ${root}: the folder is not empty. Choose a new folder.`);
  mkdirSync(root, { recursive: true });
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'add', '-A');
  git(
    root,
    '-c',
    'user.name=IT Studio Acceptance',
    '-c',
    'user.email=acceptance@example.invalid',
    'commit',
    '-q',
    '-m',
    'Acceptance sample',
  );
  return root;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const stamp = new Date().toISOString().slice(0, 10);
  const target = process.argv[2] ?? join(homedir(), `itstudio-acceptance-${stamp}`);
  try {
    const root = createAcceptanceRepo(target);
    console.log(`Acceptance sample created: ${root}`);
    console.log('Add it in IT Studio with the + button (Browse...). Delete the folder when you are done.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
