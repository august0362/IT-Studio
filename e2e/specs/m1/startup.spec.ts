import { expect } from 'chai';
import { waitForReady, statusBar, sidecarPid, killProcess } from '../../helpers/ui.js';

describe('M1 startup and supervision', () => {
  it('TC-M1-001 app launch reaches Ready', async () => {
    await waitForReady();
    expect(await statusBar().getText()).to.include('Ready v0.1.0');
  });

  it('TC-M1-007 rejects a UI request interrupted by a sidecar crash', async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-api-keys"]').click();

    const apiKeyForm = browser.$('form:has(#api-key-openai)');
    await browser.$('#api-key-openai').setValue('in-flight-test-key-1234');
    await apiKeyForm.$('button[type="submit"]').click();
    await browser.waitUntil(
      async () => (await browser.$('article:has(#api-key-openai) [role="status"]').getText()).includes('Set'),
      {
        timeout: 5_000,
        timeoutMsg: 'The OpenAI test key was not saved',
      },
    );

    const verifyButton = apiKeyForm.$('button[type="button"]');
    await verifyButton.click();
    await browser.waitUntil(async () => !(await verifyButton.isEnabled()), {
      timeout: 2_000,
      timeoutMsg: 'The verification request did not start',
    });

    await killProcess(await sidecarPid());
    await browser.waitUntil(async () => (await browser.$('[role="alert"]').getText()).includes('sidecar restarted'), {
      timeout: 5_000,
      timeoutMsg: 'The interrupted request did not report that the sidecar restarted',
    });
    await waitForReady();
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
