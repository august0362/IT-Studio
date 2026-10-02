export function statusBar() {
  return browser.$('footer[role="status"]');
}

export async function navigateToSettings() {
  await browser.$('nav[aria-label="Main navigation"] a[href="#settings"]').click();
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
    "$p = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*apps\\sidecar\\src\\main.ts*' } | Select-Object -First 1 -ExpandProperty ProcessId; if ($p) { $p }";
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const pid = Number(output);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Could not find the supervised sidecar process');
  return pid;
}

export async function killProcess(pid: number): Promise<void> {
  const { execFileSync } = await import('node:child_process');
  execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
}

export async function desktopProcessExists(): Promise<boolean> {
  const { execFileSync } = await import('node:child_process');
  const output = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "$p = Get-Process -Name 'itstudio-desktop' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($p) { 'running' } else { 'stopped' }",
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
  return output === 'running';
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await desktopProcessExists()) && !(await processExists(pid))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('The desktop or sidecar process remained after graceful window close');
}
