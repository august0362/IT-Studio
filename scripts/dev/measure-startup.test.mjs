import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { it } from 'node:test';
import { measureStartup } from './measure-startup.mjs';

function startupTempEntries() {
  return readdirSync(tmpdir()).filter((entry) => entry.startsWith('itstudio-startup-'));
}

it('QA-E2E-FIX4 keeps stdin open until Ready, then closes the child cleanly', async () => {
  const fakeSidecar = [
    'let ready = false;',
    'process.stdin.resume();',
    "process.stdin.once('end', () => { process.exitCode = ready ? 0 : 3; });",
    "setTimeout(() => { if (process.exitCode === 3) return; ready = true; process.stdout.write(JSON.stringify({ msg: 'sidecar ready' }) + '\\n'); }, 40);",
  ].join('\n');
  const elapsed = await measureStartup(process.cwd(), ['-e', fakeSidecar], 5_000);
  assert.ok(elapsed >= 0);
});

it('QA-E2E-FIX4 detects the Ready line emitted on stderr by the sidecar logger', async () => {
  const fakeSidecar = [
    'let ready = false;',
    'process.stdin.resume();',
    "process.stdin.once('end', () => { process.exitCode = ready ? 0 : 3; });",
    "setTimeout(() => { if (process.exitCode === 3) return; ready = true; process.stderr.write(JSON.stringify({ msg: 'sidecar ready' }) + '\\n'); }, 40);",
  ].join('\n');
  const elapsed = await measureStartup(process.cwd(), ['-e', fakeSidecar], 5_000);
  assert.ok(elapsed >= 0);
});

it('QA-E2E-FIX4 rejects a child that exits before Ready', async () => {
  const fakeSidecar = 'process.stdin.resume(); process.exit(4);';
  await assert.rejects(measureStartup(process.cwd(), ['-e', fakeSidecar], 5_000), /before ready with code 4/u);
});

it('QA-E2E-FIX4 rejects a nonzero shutdown after Ready', async () => {
  const fakeSidecar = [
    'process.stdin.resume();',
    "process.stdin.once('end', () => { process.exit(5); });",
    "process.stdout.write(JSON.stringify({ msg: 'sidecar ready' }) + '\\n');",
  ].join('\n');
  await assert.rejects(measureStartup(process.cwd(), ['-e', fakeSidecar], 5_000), /after ready with code 5/u);
});

it('QA-E2E-FIX4 times out and removes its own temporary data directory', async () => {
  const before = startupTempEntries();
  await assert.rejects(
    measureStartup(process.cwd(), ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'], 200),
    /did not report ready within 200 ms/u,
  );
  assert.deepEqual(startupTempEntries(), before);
});
