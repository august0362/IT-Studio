import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sidecarDirectory = fileURLToPath(new URL('../../apps/sidecar/', import.meta.url));
const measurements = [];

for (let attempt = 0; attempt < 5; attempt += 1) {
  measurements.push(await measureStartup(sidecarDirectory));
}

const sorted = [...measurements].sort((left, right) => left - right);
console.log(`Sidecar time-to-ready (ms): ${measurements.map(Math.round).join(', ')}`);
console.log(`Median: ${Math.round(sorted[2] ?? 0)} ms`);

async function measureStartup(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ITSTUDIO_DATA_DIR: ':memory:', ITSTUDIO_E2E: '1' },
    });
    const startedAt = performance.now();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let readyElapsed;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Sidecar did not report ready within 30 seconds. ${stderr}`));
    }, 30_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/u);
      stdout = lines.pop() ?? '';
      if (readyElapsed === undefined && lines.some(isReadyLine)) {
        readyElapsed = performance.now() - startedAt;
        clearTimeout(timeout);
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (readyElapsed !== undefined) {
        resolve(readyElapsed);
        return;
      }
      reject(new Error(`Sidecar exited before ready with code ${String(code)}. ${stderr}`));
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
