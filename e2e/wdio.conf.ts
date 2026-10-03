import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capabilities, Options } from '@wdio/types';

interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName: 'wry';
  'tauri:options': { application: string };
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appPath = resolve(root, 'apps/desktop/src-tauri/target/debug/itstudio-desktop.exe');
const npmCliPath = process.env.npm_execpath;
const drivers: ChildProcess[] = [];
let e2eTempRoot: string | undefined;
let desktopPidsBeforeE2e: ReadonlySet<number> = new Set();
const tauriCapabilities: TauriCapabilities[] = [{ browserName: 'wry', 'tauri:options': { application: appPath } }];

// Each tauri-driver needs its own native (msedgedriver) port; the default 4445 collides with a second driver on 4445.
function startDriver(
  port: number,
  nativePort: number,
  options: { readonly crashOnStart?: boolean; readonly llmScript?: string; readonly llmText?: string } = {},
): void {
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
        ...(e2eTempRoot === undefined
          ? {}
          : {
              ITSTUDIO_DATA_DIR: join(e2eTempRoot, `data-${String(port)}`),
              WEBVIEW2_USER_DATA_FOLDER: join(e2eTempRoot, `webview-${String(port)}`),
            }),
        ITSTUDIO_E2E: '1',
        ITSTUDIO_E2E_VERIFIER_OUTCOME: 'timeout',
        ...(options.llmText === undefined ? {} : { ITSTUDIO_E2E_LLM_TEXT: options.llmText }),
        ...(options.llmScript === undefined ? {} : { ITSTUDIO_E2E_LLM_SCRIPT: resolve(root, options.llmScript) }),
        ...(options.crashOnStart === true ? { ITSTUDIO_E2E_CRASH_ON_START: '1' } : {}),
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  drivers.push(driver);
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
  async onPrepare() {
    e2eTempRoot = mkdtempSync(join(tmpdir(), 'itstudio-e2e-'));
    const desktopOutput = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-Process -Name 'itstudio-desktop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0",
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    desktopPidsBeforeE2e = new Set(
      desktopOutput
        .split(/\r?\n/u)
        .map((line) => Number(line.trim()))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    );
    if (!existsSync(appPath)) {
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
    startDriver(4444, 4454);
    startDriver(4445, 4455, { crashOnStart: true });
    startDriver(4446, 4456, { llmScript: 'e2e/fixtures/m4-slow-chat.json' });
    startDriver(4447, 4457, { llmScript: 'e2e/fixtures/m4-fallback.json' });
    startDriver(4448, 4458, {
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
    await new Promise((resolveReady) => setTimeout(resolveReady, 1200));
  },
  onComplete() {
    for (const driver of drivers) {
      if (driver.pid === undefined) continue;
      try {
        execFileSync('taskkill.exe', ['/PID', String(driver.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } catch {
        driver.kill();
      }
    }
    const desktopOutput = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-Process -Name 'itstudio-desktop' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id; exit 0",
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    for (const line of desktopOutput.split(/\r?\n/u)) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid) || pid <= 0 || desktopPidsBeforeE2e.has(pid)) continue;
      try {
        execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } catch {
        // The session may already have closed the process.
      }
    }
    if (e2eTempRoot !== undefined) rmSync(e2eTempRoot, { recursive: true, force: true });
  },
};
