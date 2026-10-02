import { expect } from 'chai';
import { navigateToSettings, waitForReady } from '../../helpers/ui.js';

describe('M4 Themes', () => {
  it('TC-M4-001 changes Midnight Focus to dark and restores it after app restart', async () => {
    await waitForReady();
    await navigateToSettings();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-theme"]').click();
    await browser.$('[role="radio"][data-theme-id="midnight-focus"]').click();
    await browser.$('button=Dark').click();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.dataset.theme)) === 'midnight-focus',
    );
    expect(await browser.execute(() => document.documentElement.dataset.mode)).to.equal('dark');
    await browser.refresh();
    await waitForReady();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.dataset.theme)) === 'midnight-focus',
    );
    expect(await browser.execute(() => document.documentElement.dataset.mode)).to.equal('dark');
    await browser.$('button=Reset default').click();
    // Reset = mode System + default theme for the OS colour scheme (product rule); the expectation must follow the OS.
    const osDark = await browser.execute(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.documentElement.dataset.theme)) ===
        (osDark ? 'midnight-focus' : 'arctic-focus'),
    );
    expect(await browser.execute(() => document.documentElement.dataset.mode)).to.equal(osDark ? 'dark' : 'light');
  });
});
