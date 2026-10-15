import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const executable = join(root, 'dist-sidecar/itstudio-sidecar-x86_64-pc-windows-msvc.exe');

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await measureStarts();
}

export async function measureStarts(start = smokeStart, log = console.log) {
  const cold = await start();
  log(`Sidecar warm-up (cold): ${cold.toFixed(0)} ms`);
  const measured = [];
  for (let index = 0; index < 3; index += 1) {
    const timing = await start();
    measured.push(timing);
    log(`Sidecar measured start ${index + 1}: ${timing.toFixed(0)} ms`);
  }
  const median = [...measured].sort((left, right) => left - right)[1];
  log(`Sidecar measured median: ${median.toFixed(0)} ms`);
  if (median >= 1_500) throw new Error(`Sidecar readiness target missed: ${median.toFixed(0)} ms (target < 1500 ms)`);
  log('Sidecar smoke passed');
  return median;
}

async function smokeStart() {
  const dataDir = await mkdtemp(join(tmpdir(), 'itstudio-sidecar-smoke-'));
  const startedAt = performance.now();
  const child = spawn(executable, [], {
    cwd: root,
    env: {
      ...process.env,
      ITSTUDIO_DATA_DIR: dataDir,
      ITSTUDIO_E2E: '1',
      ITSTUDIO_E2E_VERIFIER_FIXTURE: join(root, 'apps/sidecar/test/integration/fixtures/verifier.json'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  const pending = new Map();
  let nextId = 1;
  const ready = deferred();
  const exited = deferred();
  lines.on('line', (line) => {
    try {
      const message = JSON.parse(line);
      if (message.method === 'system.ready') ready.resolve();
      if (typeof message.id === 'number') pending.get(message.id)?.(message);
    } catch {
      // Ignore non-protocol stdout; valid sidecar output remains line-delimited JSON.
    }
  });
  child.once('error', exited.reject);
  child.once('exit', (code) => exited.resolve(code));

  try {
    await withTimeout(
      Promise.race([
        ready.promise,
        exited.promise.then((code) =>
          Promise.reject(new Error(`Sidecar exited before ready (${String(code)}): ${stderr}`)),
        ),
      ]),
      20_000,
      'Sidecar did not become ready',
    );
    const timeToReady = performance.now() - startedAt;
    const ping = await request('system.ping');
    if (ping.error || typeof ping.result?.version !== 'string')
      throw new Error(`system.ping failed: ${JSON.stringify(ping)}`);
    const shutdown = await request('system.shutdown');
    if (shutdown.error || shutdown.result?.accepted !== true)
      throw new Error(`system.shutdown failed: ${JSON.stringify(shutdown)}`);
    const code = await withTimeout(exited.promise, 5_000, 'Sidecar did not exit after shutdown');
    if (code !== 0) throw new Error(`Sidecar exited with ${String(code)}: ${stderr}`);
    return timeToReady;
  } finally {
    child.stdin.end();
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await withTimeout(exited.promise, 5_000, 'Sidecar did not exit after termination');
    }
    lines.close();
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  function request(method) {
    const id = nextId++;
    return withTimeout(
      new Promise((resolveMessage) => {
        pending.set(id, (message) => {
          pending.delete(id);
          resolveMessage(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: {} })}\n`);
      }),
      5_000,
      `${method} timed out`,
    );
  }
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), milliseconds);
      timer.unref();
    }),
  ]);
}
