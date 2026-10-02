import { expect } from 'chai';
import { navigateToSettings, waitForReady } from '../../helpers/ui.js';

describe('M4 Themes', () => {
  it('TC-M4-001 changes Midnight Focus to dark and restores it after app restart', async () => {
    await waitForReady();
    await navigateToSettings();
    await browser.$('button=Theme').click();
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
  });
});
