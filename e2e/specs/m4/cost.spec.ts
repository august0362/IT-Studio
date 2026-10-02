import { expect } from 'chai';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M4 cost and P&L', () => {
  it('TC-M4-030 adds revenue and shows project revenue and margin', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Cost E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) === 'Cost E2E Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    await browser.$('aria/Amount').setValue('100');
    await browser.$('aria/Description').setValue('Project work');
    await browser.$('button=Add revenue').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('$100.00'));
    expect(await browser.$('body').getText()).to.include('Margin');
  });
});
