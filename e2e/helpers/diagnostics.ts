import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let diagnosticSession: WebdriverIO.Browser | undefined;

export function setDiagnosticSession(session: WebdriverIO.Browser | undefined): void {
  diagnosticSession = session;
}

function redactKeys(source: string): string {
  return source.replace(/sk-TEST-e2e-[A-Za-z0-9_-]+/gu, '[REDACTED E2E KEY]');
}

export async function captureFailureEvidence(testTitle: string): Promise<void> {
  const session = diagnosticSession ?? browser;
  const directory = process.env.ITSTUDIO_E2E_EVIDENCE_DIR ?? join(tmpdir(), 'itstudio-e2e-evidence');
  mkdirSync(directory, { recursive: true });
  const caseId = /TC-M(?:\d+|W)-\d+/u.exec(testTitle)?.[0] ?? 'unknown-case';
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const prefix = join(directory, `${timestamp}-${caseId}`);
  const domPath = `${prefix}.html`;
  const screenshotPath = `${prefix}.png`;
  try {
    const source = await session.getPageSource();
    writeFileSync(domPath, redactKeys(source), 'utf8');
    console.error(`E2E failure DOM: ${domPath}`);
  } catch (error) {
    console.error(`E2E failure DOM capture failed for ${caseId}: ${String(error)}`);
  }
  try {
    await session.saveScreenshot(screenshotPath);
    console.error(`E2E failure screenshot: ${screenshotPath}`);
  } catch (error) {
    console.error(`E2E failure screenshot capture failed for ${caseId}: ${String(error)}`);
  }
}
