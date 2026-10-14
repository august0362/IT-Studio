import { expect } from 'chai';
import { remote } from 'webdriverio';
import { waitForReady, statusBar, sidecarPid, killProcess } from '../../helpers/ui.js';

interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName: 'wry';
  'tauri:options': { application: string };
}

describe('M1 startup and supervision', () => {
  it('TC-M1-001 app launch reaches Ready', async () => {
    await waitForReady();
    expect(await statusBar().getText()).to.include('Ready v0.1.0');
  });

  it('TC-M1-007 rejects a UI request interrupted by a sidecar crash', async () => {
    const capabilities: TauriCapabilities = {
      browserName: 'wry',
      'tauri:options': {
        application: `${process.cwd()}\\apps\\desktop\\src-tauri\\target\\debug\\itstudio-desktop.exe`,
      },
    };
    const timeoutBrowser = await remote({
      hostname: '127.0.0.1',
      port: 4452,
      path: '/',
      capabilities,
    });
    try {
      const timeoutStatus = timeoutBrowser.$('footer[role="status"]');
      await timeoutBrowser.waitUntil(async () => (await timeoutStatus.getText()).includes('Ready v0.1.0'), {
        timeout: 20_000,
        timeoutMsg: 'The timeout-verifier session did not become ready',
      });
      // The newly opened desktop is the most recent supervised process selected by the helper.
      const timeoutSidecarPid = await sidecarPid();
      await timeoutBrowser.$('nav a[href="#settings-api-keys"]').click();

      const apiKeyForm = timeoutBrowser.$('form:has(#api-key-openai)');
      const input = timeoutBrowser.$('#api-key-openai');
      await input.setValue('in-flight-test-key-1234');
      const verifyButton = apiKeyForm.$('button[type="submit"]');
      await verifyButton.click();
      await timeoutBrowser.waitUntil(
        async () => !(await verifyButton.isEnabled()) && (await verifyButton.getText()).includes('Verifying…'),
        {
          timeout: 2_000,
          timeoutMsg: 'The verification request did not start',
        },
      );
      expect(await input.isEnabled()).to.equal(false);
      expect(await apiKeyForm.$('button=Delete').isEnabled()).to.equal(false);

      await killProcess(timeoutSidecarPid);
      await timeoutBrowser.waitUntil(
        async () =>
          (await timeoutBrowser.$('article:has(#api-key-openai) [role="alert"]').getText()).includes(
            'sidecar restarted',
          ),
        {
          timeout: 5_000,
          timeoutMsg: 'The interrupted request did not report that the sidecar restarted',
        },
      );
      await timeoutBrowser.waitUntil(async () => (await timeoutStatus.getText()).includes('Ready v0.1.0'), {
        timeout: 20_000,
        timeoutMsg: 'The timeout-verifier session did not recover after the crash',
      });
      expect(await verifyButton.isEnabled()).to.equal(true);
      expect(await timeoutBrowser.$('[aria-label="OpenAI key status"]').getText()).to.include('Not set');
    } finally {
      await timeoutBrowser.deleteSession();
    }
  });

  it('TC-M1-004 sidecar crash restarts and UI recovers', async () => {
    await waitForReady();
    await killProcess(await sidecarPid());
    await browser.waitUntil(async () => (await statusBar().getText()).includes('Restarting (1)'), {
      timeout: 5_000,
    });
    await waitForReady();
    expect(await statusBar().getText()).to.include('Ready v0.1.0');
  });
});
