import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sidecarDirectory = fileURLToPath(new URL('../../apps/sidecar/', import.meta.url));

export async function measureStartup(cwd, args = ['--import', 'tsx', 'src/main.ts'], timeoutMs = 30_000) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'itstudio-startup-'));
  const tempPrefix = `${resolve(tmpdir())}${sep}`.toLowerCase();
  if (!resolve(dataRoot).toLowerCase().startsWith(tempPrefix) || !basename(dataRoot).startsWith('itstudio-startup-'))
    throw new Error(`Refusing to use an unexpected startup temporary path: ${dataRoot}`);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rmSync(dataRoot, { recursive: true, force: true });
  };
  return new Promise((resolveMeasurement, rejectMeasurement) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ITSTUDIO_DATA_DIR: dataRoot, ITSTUDIO_E2E: '1' },
      windowsHide: true,
    });
    const startedAt = performance.now();
    let stdoutLine = '';
    let stderrLine = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let readyElapsed;

    const timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdin.on('error', (error) => {
      stderr = `${stderr}${error.message}`.slice(-4_000);
    });
    const inspectLines = (buffer, chunk) => {
      const lines = `${buffer}${chunk}`.split(/\r?\n/u);
      const remaining = lines.pop() ?? '';
      if (readyElapsed === undefined && lines.some(isReadyLine)) {
        readyElapsed = performance.now() - startedAt;
        child.stdin.end();
      }
      return remaining;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutLine = inspectLines(stdoutLine, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
      stderrLine = inspectLines(stderrLine, chunk);
    });
    child.once('error', (error) => {
      cleanup();
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectMeasurement(error);
    });
    child.once('close', (code) => {
      cleanup();
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) {
        rejectMeasurement(
          new Error(
            `Sidecar ${readyElapsed === undefined ? 'did not report ready' : 'did not exit'} within ${String(timeoutMs)} ms. ${stderr}`,
          ),
        );
        return;
      }
      if (readyElapsed !== undefined && code === 0) {
        resolveMeasurement(readyElapsed);
        return;
      }
      rejectMeasurement(
        new Error(
          `Sidecar exited ${readyElapsed === undefined ? 'before ready' : 'after ready'} with code ${String(code)}. ${stderr}`,
        ),
      );
    });
  });
}

function isReadyLine(line) {
  try {
    const record = JSON.parse(line);
    return typeof record === 'object' && record !== null && record.msg === 'sidecar ready';
  } catch {
    return false;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const measurements = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    measurements.push(await measureStartup(sidecarDirectory));
  }
  const sorted = [...measurements].sort((left, right) => left - right);
  console.log(`Sidecar time-to-ready (ms): ${measurements.map(Math.round).join(', ')}`);
  console.log(`Median: ${Math.round(sorted[2] ?? 0)} ms`);
}
