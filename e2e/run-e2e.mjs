import { spawnSync } from 'node:child_process';

function available(command) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

if (!available('tauri-driver')) {
  process.stdout.write('Skipping L4 E2E: tauri-driver is not installed or is not on PATH.\n');
  process.exit(0);
}
if (!available('msedgedriver')) {
  process.stdout.write('Skipping L4 E2E: Microsoft Edge WebDriver (msedgedriver) is not on PATH.\n');
  process.exit(0);
}

const result = spawnSync('npm.cmd', ['--cache', '.npm-cache', 'exec', 'wdio', '--', 'run', 'e2e/wdio.conf.ts'], {
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(result.status ?? 1);
