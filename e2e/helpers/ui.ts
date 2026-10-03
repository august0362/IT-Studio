import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const desktopPidBySidecarPid = new Map<number, number>();

export function statusBar() {
  return browser.$('footer[role="status"]');
}

export async function navigateToSettings() {
  await browser.$('nav[aria-label="Main navigation"] a[href="#settings-api-keys"]').click();
}

export function createTemporaryProjectFolder(): string {
  return mkdtempSync(join(tmpdir(), 'itstudio-e2e-project-'));
}

export function apiKeyInput(provider = 'openai') {
  return browser.$(`#api-key-${provider}`);
}

export async function waitForReady() {
  await browser.waitUntil(async () => (await statusBar().getText()).includes('Ready v0.1.0'), {
    timeout: 20_000,
    timeoutMsg: 'The status bar did not reach Ready v0.1.0',
  });
}

export async function sidecarPid(): Promise<number> {
  const command =
    "$desktops = Get-Process -Name 'itstudio-desktop' -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending; $sidecar = $null; $desktop = $null; foreach ($candidate in $desktops) { $sidecar = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*apps\\sidecar\\src\\main.ts*' -and $_.ParentProcessId -eq $candidate.Id } | Sort-Object CreationDate -Descending | Select-Object -First 1; if ($sidecar) { $desktop = $candidate; break } }; if ($sidecar) { \"$($desktop.Id),$($sidecar.ProcessId)\" } else { throw 'No supervised sidecar belongs to a running itstudio-desktop.exe process' }";
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const [desktopPidText, sidecarPidText] = output.split(',');
  const desktopPid = Number(desktopPidText);
  const sidecarPid = Number(sidecarPidText);
  if (!Number.isInteger(desktopPid) || desktopPid <= 0 || !Number.isInteger(sidecarPid) || sidecarPid <= 0)
    throw new Error('Could not find the supervised desktop and sidecar processes');
  desktopPidBySidecarPid.set(sidecarPid, desktopPid);
  return sidecarPid;
}

export async function killProcess(pid: number): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
}

export async function processExists(pid: number): Promise<boolean> {
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `if (Get-Process -Id ${String(pid)} -ErrorAction SilentlyContinue) { 'running' } else { 'stopped' }`,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  return output === 'running';
}

export async function waitForShutdown(pid: number, timeoutMs: number): Promise<void> {
  const desktopPid = desktopPidBySidecarPid.get(pid);
  if (desktopPid === undefined) throw new Error('The desktop process tree was not captured before shutdown');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await processExists(desktopPid)) && !(await processExists(pid))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('The session desktop or sidecar process remained after graceful window close');
}
