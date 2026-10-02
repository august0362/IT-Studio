import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { runTests } from '@vscode/test-electron';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = root;
const extensionTestsPath = join(root, 'test', 'e2e', 'suite.cjs');
const workspace = await mkdtemp(join(tmpdir(), 'itstudio-vscode-e2e-'));
const token = 'e'.repeat(64);
const acknowledgements = new Set();
const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });

try {
  await new Promise((resolveReady, reject) => {
    server.once('listening', resolveReady);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test WebSocket server did not bind a port');
  await mkdir(join(workspace, '.itstudio'), { recursive: true });
  await mkdir(join(workspace, 'src'), { recursive: true });
  await writeFile(join(workspace, 'src', 'target.txt'), 'first line\nsecond line\n', 'utf8');
  await writeFile(
    join(workspace, '.itstudio', 'session.json'),
    JSON.stringify({ port: address.port, token, protocolVersion: 1 }),
    'utf8',
  );

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const value = JSON.parse(raw.toString());
      if (value.type === 'hello') {
        if (value.token !== token) throw new Error('Extension sent an unexpected session token');
        socket.send(JSON.stringify({ type: 'welcome', sessionId: 'e2e-session' }));
        socket.send(JSON.stringify({ type: 'reveal', ref: 1, path: 'src/target.txt', line: 2 }));
        socket.send(
          JSON.stringify({
            type: 'transaction',
            ref: 2,
            transactionId: 'e2e-commit',
            status: 'committed',
            paths: ['src/target.txt'],
          }),
        );
        socket.send(
          JSON.stringify({
            type: 'transaction',
            ref: 3,
            transactionId: 'e2e-rollback',
            status: 'rolled_back',
            paths: [],
          }),
        );
      } else if (value.type === 'ack') {
        acknowledgements.add(value.ref);
      }
    });
  });

  await runTests({
    extensionDevelopmentPath: extensionPath,
    extensionTestsPath,
    launchArgs: [workspace, '--disable-workspace-trust'],
  });
  for (const [ref, caseId] of [
    [1, 'TC-M7-050'],
    [2, 'TC-M7-051'],
    [3, 'TC-M7-051'],
  ]) {
    const deadline = Date.now() + 5000;
    while (!acknowledgements.has(ref) && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if (!acknowledgements.has(ref)) throw new Error(`${caseId}: extension did not acknowledge ref ${String(ref)}`);
  }
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(workspace, { recursive: true, force: true });
}
