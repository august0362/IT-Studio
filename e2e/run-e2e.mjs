import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function available(command) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

const msedgedriver = process.env.ITSTUDIO_MSEDGEDRIVER ?? 'C:/Users/admin/.itstudio-tools/msedgedriver.exe';

if (!available('tauri-driver')) {
  process.stdout.write('Skipping L4 E2E: tauri-driver is not installed or is not on PATH.\n');
} else if (!existsSync(msedgedriver)) {
  process.stdout.write(`Skipping L4 E2E: Microsoft Edge WebDriver was not found at ${msedgedriver}.\n`);
} else {
  const npmCliPath = process.env.npm_execpath;
  if (npmCliPath === undefined) {
    process.stderr.write('Cannot start L4 E2E: npm_execpath is unavailable. Run this command with npm run test:e2e.\n');
    process.exitCode = 1;
  } else {
    const result = spawnSync(
      process.execPath,
      [npmCliPath, '--cache', '.npm-cache', 'exec', 'wdio', '--', 'run', 'e2e/wdio.conf.ts'],
      {
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    if (result.error !== undefined) {
      process.stderr.write(`Cannot start L4 E2E: ${result.error.message}\n`);
    }
    process.exitCode = result.status ?? 1;
  }
}
