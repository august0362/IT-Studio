import { expect } from 'chai';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M4 App shell', () => {
  it('TC-M4-010 creates a project in the dialog and selects its tab', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Shell E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    // Wait for the UI to switch to the new project (reading immediately returns the previous "All projects" tab).
    await browser.waitUntil(
      async () =>
        (await browser.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) === 'Shell E2E Project',
      { timeout: 10_000, timeoutMsg: 'new project tab was not selected after creation' },
    );
  });

  it('TC-M4-011 switches to Vietnamese and restores the locale after reload', async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-theme"]').click();
    await browser.$('select:has(option[value="vi"])').selectByAttribute('value', 'vi');
    await browser.waitUntil(
      async () => (await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').getText()) === 'Trò chuyện',
    );
    await browser.refresh();
    await waitForReady();
    await browser.waitUntil(
      async () => (await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').getText()) === 'Trò chuyện',
    );
    expect(await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').getText()).to.equal('Chi phí & Lãi lỗ');
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-theme"]').click();
    await browser.$('select:has(option[value="vi"])').selectByAttribute('value', 'en');
    await browser.waitUntil(
      async () => (await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').getText()) === 'Chat',
    );
  });
});
