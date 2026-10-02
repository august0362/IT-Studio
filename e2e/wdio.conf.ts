import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
const tauriCapabilities: TauriCapabilities[] = [{ browserName: 'wry', 'tauri:options': { application: appPath } }];

// Each tauri-driver needs its own native (msedgedriver) port; the default 4445 collides with a second driver on 4445.
function startDriver(port: number, nativePort: number, crashOnStart = false): void {
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
        ITSTUDIO_E2E: '1',
        ITSTUDIO_E2E_VERIFIER_OUTCOME: 'timeout',
        ...(crashOnStart ? { ITSTUDIO_E2E_CRASH_ON_START: '1' } : {}),
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  drivers.push(driver);
}

export const config: Options.Testrunner & { capabilities: Capabilities.RequestedStandaloneCapabilities[] } = {
  runner: 'local',
  specs: ['./specs/**/*.spec.ts'],
  maxInstances: 1,
  capabilities: tauriCapabilities,
  hostname: '127.0.0.1',
  port: 4444,
  path: '/',
  framework: 'mocha',
  reporters: ['spec'],
  connectionRetryTimeout: 90_000,
  mochaOpts: { timeout: 120_000 },
  waitforTimeout: 70_000,
  async onPrepare() {
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
    startDriver(4445, 4455, true);
    await new Promise((resolveReady) => setTimeout(resolveReady, 1200));
  },
  onComplete() {
    for (const driver of drivers) driver.kill();
  },
};
