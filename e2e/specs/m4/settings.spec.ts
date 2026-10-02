import { expect } from 'chai';
import { waitForReady } from '../../helpers/ui.js';

describe('M4 Settings', () => {
  it('TC-M4-040 persists Auto Fallback after reload', async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const toggle = browser.$('label*=Auto Fallback input');
    await browser.waitUntil(async () => toggle.isExisting());
    if (await toggle.isSelected()) await toggle.click();
    await browser.waitUntil(async () => !(await toggle.isSelected()));
    await browser.refresh();
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    await browser.waitUntil(async () => !(await browser.$('label*=Auto Fallback input').isSelected()));
    expect(await browser.$('label*=Auto Fallback input').isSelected()).to.equal(false);
  });
});
