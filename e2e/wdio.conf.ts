import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Capabilities, Options } from '@wdio/types';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appPath = resolve(root, 'apps/desktop/src-tauri/target/debug/itstudio-desktop.exe');
const drivers: ChildProcess[] = [];

function startDriver(port: number, crashOnStart = false): void {
  const driver = spawn(
    'tauri-driver',
    [
      '--port',
      String(port),
      '--native-driver',
      process.env.ITSTUDIO_MSEDGEDRIVER ?? 'C:/Users/admin/.itstudio-tools/msedgedriver.exe',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        ITSTUDIO_E2E: '1',
        ...(crashOnStart ? { ITSTUDIO_E2E_CRASH_ON_START: '1' } : {}),
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  drivers.push(driver);
}

export const config: Options.Testrunner & { capabilities: Capabilities.TestrunnerCapabilities } = {
  runner: 'local',
  specs: ['./e2e/specs/**/*.spec.mjs'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'wry',
      'tauri:options': { application: appPath },
    },
  ],
  hostname: '127.0.0.1',
  port: 4444,
  path: '/',
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { timeout: 90_000 },
  waitforTimeout: 15_000,
  async onPrepare() {
    execFileSync(
      'npm.cmd',
      ['--cache', '.npm-cache', 'run', 'tauri', '-w', '@itstudio/desktop', '--', 'build', '--debug', '--no-bundle'],
      {
        cwd: root,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    startDriver(4444);
    startDriver(4445, true);
    await new Promise((resolveReady) => setTimeout(resolveReady, 1200));
  },
  onComplete() {
    for (const driver of drivers) driver.kill();
  },
};
