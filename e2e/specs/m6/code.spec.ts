import { expect } from 'chai';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M6 Code pipeline', () => {
  it('TC-M6-010 creates a project and observes the scripted pipeline complete', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Code E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) === 'Code E2E Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#code"]').click();
    await browser.$('#pipeline-prompt').setValue('Create a sample file');
    await browser.$('button=Run pipeline').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Completed'), { timeout: 70_000 });
    expect(await browser.$('[aria-label="Pipeline stages"]').getText()).to.include('Completed');
  });
});
