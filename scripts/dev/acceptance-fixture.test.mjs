import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FILES, createAcceptanceRepo } from './acceptance-fixture.mjs';

test('STAB acceptance fixture is a committed, clean Git repository whose own tests pass', () => {
  const parent = mkdtempSync(join(tmpdir(), 'itstudio-acceptance-test-'));
  try {
    const root = createAcceptanceRepo(join(parent, 'sample'));
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
    assert.equal(
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      'main',
    );
    assert.deepEqual(
      execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort(),
      Object.keys(FILES).sort(),
    );
    assert.match(readFileSync(join(root, 'docs', 'warehouse-policy.md'), 'utf8'), /ORCHID-7/u);
    execFileSync(process.execPath, ['--test'], { cwd: root, stdio: 'ignore' });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('STAB acceptance fixture refuses a non-empty folder', () => {
  const parent = mkdtempSync(join(tmpdir(), 'itstudio-acceptance-test-'));
  try {
    writeFileSync(join(parent, 'owner-file.txt'), 'keep me');
    assert.throws(() => createAcceptanceRepo(parent), /not empty/u);
    assert.equal(readFileSync(join(parent, 'owner-file.txt'), 'utf8'), 'keep me');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
