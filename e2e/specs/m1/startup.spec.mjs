import { expect } from 'chai';
import { waitForReady, statusBar, sidecarPid, killProcess, desktopProcessExists } from '../../helpers/ui.mjs';

describe('M1 startup and supervision', () => {
  it('TC-M1-001 app launch reaches Ready', async () => {
    await waitForReady();
    expect(await (await statusBar()).getText()).to.include('Ready v0.1.0');
  });

  it('TC-M1-007 rejects a UI request interrupted by a sidecar crash', async () => {
    await waitForReady();
    await browser.$('#api-key-openai').setValue('in-flight-test-key-1234');
    await browser.$('form:has(#api-key-openai) button[type="submit"]').click();
    await killProcess(await sidecarPid());
    await browser.waitUntil(
      async () => (await browser.$('[role="alert"]:not(footer)').getText()).includes('sidecar restarted'),
      {
        timeout: 5_000,
      },
    );
    await waitForReady();
  });

  it('TC-M1-004 sidecar crash restarts and UI recovers', async () => {
    await waitForReady();
    await killProcess(await sidecarPid());
    await browser.waitUntil(async () => (await (await statusBar()).getText()).includes('Restarting (1)'), {
      timeout: 5_000,
    });
    await waitForReady();
    expect(await (await statusBar()).getText()).to.include('Ready v0.1.0');
  });

  it('TC-M1-006 graceful window close shuts down the app', async () => {
    await waitForReady();
    await browser.closeWindow();
    await browser.deleteSession();
    await browser.waitUntil(async () => !(await desktopProcessExists()), {
      timeout: 5_000,
      timeoutMsg: 'The desktop process remained after graceful window close',
    });
  });
});
