import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capabilities, Options } from '@wdio/types';
import { captureFailureEvidence } from './helpers/diagnostics.js';

interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName: 'wry';
  'tauri:options': { application: string };
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appPath = resolve(root, 'apps/desktop/src-tauri/target/debug/itstudio-desktop.exe');
const npmCliPath = process.env.npm_execpath;
const driversByWorker = new Map<string, ChildProcess[]>();
let e2eTempRoot: string | undefined;
const tauriCapabilities: TauriCapabilities[] = [
  {
    browserName: 'wry',
    'tauri:options': { application: appPath },
    'wdio:enforceWebDriverClassic': true,
  },
];

function newestSourceMtime(path: string): number {
  const info = statSync(path);
  if (!info.isDirectory()) return info.mtimeMs;
  return readdirSync(path).reduce((newest, entry) => {
    const childPath = join(path, entry);
    return Math.max(newest, newestSourceMtime(childPath));
  }, info.mtimeMs);
}

function appNeedsRebuild(): boolean {
  if (!existsSync(appPath)) return true;
  const appMtime = statSync(appPath).mtimeMs;
  const sourcePaths = [
    'apps/desktop/src',
    'apps/desktop/src-tauri/src',
    'apps/desktop/index.html',
    'src/types/schemas.ts',
  ];
  return sourcePaths.some((path) => newestSourceMtime(join(root, path)) > appMtime);
}

// Each tauri-driver needs its own native (msedgedriver) port; the default 4445 collides with a second driver on 4445.
function startDriver(
  port: number,
  nativePort: number,
  workerRoot: string,
  options: {
    readonly crashOnStart?: boolean;
    readonly verifierOutcome?: 'success' | 'auth' | 'server' | 'timeout';
    readonly llmScript?: string;
    readonly llmText?: string;
    readonly imageScript?: string;
    readonly imagePriceMicroUsd?: number;
    readonly llmScriptText?: string;
    readonly orchestrationMock?: boolean;
  } = {},
): ChildProcess {
  const imageScriptPath =
    options.imageScript === undefined ? undefined : join(workerRoot, `image-script-${String(port)}.json`);
  if (imageScriptPath !== undefined && options.imageScript !== undefined)
    writeFileSync(imageScriptPath, options.imageScript, 'utf8');
  const llmScriptPath =
    options.llmScriptText === undefined ? undefined : join(workerRoot, `llm-script-${String(port)}.json`);
  if (llmScriptPath !== undefined && options.llmScriptText !== undefined)
    writeFileSync(llmScriptPath, options.llmScriptText, 'utf8');
  const driver = spawn(
    'tauri-driver',
    [
      '--port',
      String(port),
      '--native-port',
      String(nativePort),
      '--native-driver',
      process.env.ITSTUDIO_MSEDGEDRIVER ?? 'C:/Users/admin/.itstudio-tools/msedgedriver.exe',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ITSTUDIO_DATA_DIR: join(workerRoot, `data-${String(port)}`),
        WEBVIEW2_USER_DATA_FOLDER: join(workerRoot, `webview-${String(port)}`),
        ITSTUDIO_E2E: '1',
        ...(options.orchestrationMock === true ? { ITSTUDIO_E2E_ORCH_MOCK: '1' } : {}),
        ...(process.env.ITSTUDIO_E2E_VISIBLE === '1' ? {} : { ITSTUDIO_E2E_OFFSCREEN: '1' }),
        ITSTUDIO_E2E_VERIFIER_OUTCOME: options.verifierOutcome ?? 'success',
        ...(llmScriptPath === undefined
          ? options.llmScript === undefined
            ? {}
            : { ITSTUDIO_E2E_LLM_SCRIPT: resolve(root, options.llmScript) }
          : { ITSTUDIO_E2E_LLM_SCRIPT: llmScriptPath }),
        ...(imageScriptPath === undefined ? {} : { ITSTUDIO_E2E_IMAGE_SCRIPT: imageScriptPath }),
        ...(options.imagePriceMicroUsd === undefined
          ? {}
          : { ITSTUDIO_E2E_IMAGE_PRICE_MICRO_USD: String(options.imagePriceMicroUsd) }),
        ...(options.llmText === undefined ? {} : { ITSTUDIO_E2E_LLM_TEXT: options.llmText }),
        ...(options.crashOnStart === true ? { ITSTUDIO_E2E_CRASH_ON_START: '1' } : {}),
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  return driver;
}

async function waitForDriver(port: number, driver: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (driver.exitCode !== null)
      throw new Error(`tauri-driver on port ${String(port)} exited with ${String(driver.exitCode)}`);
    const listening = await new Promise<boolean>((resolveReady) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolveReady(true);
      });
      socket.once('error', () => {
        resolveReady(false);
      });
      socket.setTimeout(500, () => {
        socket.destroy();
        resolveReady(false);
      });
    });
    if (listening) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`tauri-driver on port ${String(port)} did not listen within 20 seconds`);
}

function stopDriver(driver: ChildProcess): void {
  if (driver.pid === undefined || driver.exitCode !== null) return;
  try {
    execFileSync('taskkill.exe', ['/PID', String(driver.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {
    driver.kill();
  }
}

function removeE2eTempRoot(): void {
  if (e2eTempRoot === undefined) return;
  const target = resolve(e2eTempRoot);
  const tempPrefix = `${resolve(tmpdir())}${sep}`.toLowerCase();
  if (!target.toLowerCase().startsWith(tempPrefix) || !basename(target).startsWith('itstudio-e2e-')) {
    throw new Error(`Refusing to remove an unexpected E2E temporary path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}

export const config: Options.Testrunner & { capabilities: Capabilities.RequestedStandaloneCapabilities[] } = {
  runner: 'local',
  specs: [
    './specs/m1/api-keys.spec.ts',
    './specs/m1/fatal.spec.ts',
    './specs/m1/startup.spec.ts',
    './specs/m4/theme.spec.ts',
    './specs/m4/shell.spec.ts',
    './specs/m4/chat.spec.ts',
    './specs/m4/scripted-llm.spec.ts',
    './specs/m4/settings.spec.ts',
    './specs/m5/knowledge.spec.ts',
    './specs/m4/cost.spec.ts',
    './specs/m6/code.spec.ts',
    './specs/m8/images.spec.ts',
    './specs/mw/workflow.spec.ts',
    './specs/orch/orchestration.spec.ts',
    // shutdown must stay last: it closes the app window
    './specs/m1/shutdown.spec.ts',
  ],
  maxInstances: 1,
  capabilities: tauriCapabilities,
  hostname: '127.0.0.1',
  port: 4444,
  path: '/',
  framework: 'mocha',
  reporters: ['spec'],
  connectionRetryTimeout: 90_000,
  mochaOpts: { timeout: 200_000 },
  waitforTimeout: 70_000,
  onPrepare() {
    e2eTempRoot = mkdtempSync(join(tmpdir(), 'itstudio-e2e-'));
    process.env.ITSTUDIO_E2E_EVIDENCE_DIR = mkdtempSync(join(tmpdir(), 'itstudio-e2e-evidence-'));
    console.log(`E2E failure evidence: ${process.env.ITSTUDIO_E2E_EVIDENCE_DIR}`);
    if (appNeedsRebuild()) {
      if (npmCliPath === undefined) throw new Error('npm_execpath is unavailable; run E2E through npm run test:e2e.');
      execFileSync(
        process.execPath,
        [
          npmCliPath,
          '--cache',
          '.npm-cache',
          'run',
          'tauri',
          '-w',
          '@itstudio/desktop',
          '--',
          'build',
          '--debug',
          '--no-bundle',
        ],
        {
          cwd: root,
          stdio: 'inherit',
          windowsHide: true,
        },
      );
    }
  },
  async onWorkerStart(cid, _caps, specs) {
    if (e2eTempRoot === undefined) throw new Error('E2E temporary root is unavailable');
    const workerRoot = mkdtempSync(join(e2eTempRoot, 'spec-'));
    console.log(`E2E worker ${cid}: ${specs.join(', ')}; isolated data root: ${workerRoot}`);
    const workerDrivers: ChildProcess[] = [];
    const launch = (port: number, nativePort: number, options?: Parameters<typeof startDriver>[3]) => {
      const driver = startDriver(port, nativePort, workerRoot, options);
      workerDrivers.push(driver);
      return waitForDriver(port, driver);
    };
    driversByWorker.set(cid, workerDrivers);
    const needs = (file: string) => specs.some((spec) => spec.replaceAll('\\', '/').endsWith(file));
    await launch(4444, 4454, {
      ...(needs('/m5/knowledge.spec.ts') ? { llmText: 'The blue lantern is in the north archive room [1].' } : {}),
      ...(needs('/orch/orchestration.spec.ts') ? { orchestrationMock: true } : {}),
    });
    if (needs('/m1/fatal.spec.ts')) await launch(4445, 4455, { crashOnStart: true });
    if (needs('/m1/startup.spec.ts')) await launch(4452, 4462, { verifierOutcome: 'timeout' });
    if (needs('/m4/scripted-llm.spec.ts')) {
      await launch(4446, 4456, { llmScript: 'e2e/fixtures/m4-slow-chat.json' });
      await launch(4447, 4457, { llmScript: 'e2e/fixtures/m4-fallback.json' });
      await launch(4450, 4460, {
        llmScriptText: JSON.stringify({
          models: {
            'gpt-5.4-mini': Array.from({ length: 9 }, () => 'http:503'),
            'gemini-3.8-flash': ['ok'],
          },
        }),
      });
      await launch(4451, 4461, { llmScript: 'e2e/fixtures/m4-fallback.json' });
    }
    if (needs('/m6/code.spec.ts') || needs('/mw/workflow.spec.ts')) {
      await launch(4448, 4458, {
        llmText: JSON.stringify({
          'claude-opus-5-5': JSON.stringify({
            title: 'Add greeting',
            userStory: 'Write a greeting file',
            acceptanceCriteria: ['The greeting file exists'],
            allowedPaths: ['src/greeting.ts'],
            contracts: '',
            constraints: [],
            testPlan: ['Check the file exists'],
            outOfScope: [],
          }),
          'gpt-5.3-codex': JSON.stringify({
            summary: 'Create a greeting file',
            operations: [{ kind: 'create', path: 'src/greeting.ts', content: 'export const greeting = "hello";' }],
            assumptions: [],
          }),
          'claude-sonnet-5-5': JSON.stringify({ approved: true, findings: [], summary: 'Approved' }),
        }),
      });
    }
    if (needs('/m8/images.spec.ts')) {
      await launch(4449, 4459, {
        llmScriptText: JSON.stringify({
          models: {
            'gpt-5.4-mini': ['tool:{"name":"generate_image","arguments":{"prompt":"A blue bird on a branch"}}', 'ok'],
          },
        }),
        imageScript: JSON.stringify({ openai_dalle3: ['success'] }),
        imagePriceMicroUsd: 1_000_000,
      });
    }
  },
  onWorkerEnd(cid) {
    for (const driver of driversByWorker.get(cid) ?? []) stopDriver(driver);
    driversByWorker.delete(cid);
  },
  async afterTest(test, _context, result) {
    if (result.passed) return;
    await captureFailureEvidence(test.title);
  },
  onComplete() {
    for (const workerDrivers of driversByWorker.values()) for (const driver of workerDrivers) stopDriver(driver);
    driversByWorker.clear();
    removeE2eTempRoot();
  },
};
