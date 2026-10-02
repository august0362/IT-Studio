import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M5 knowledge', () => {
  it('TC-M5-020 adds a markdown source and retrieves a matching chunk', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    writeFileSync(join(folder, 'guide.md'), '# Lantern guide\n\nThe blue lantern is stored in the north archive room.');
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Knowledge E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.$('nav[aria-label="Main navigation"] a[href="#knowledge"]').click();
    await browser.$('aria/Workspace-relative file or folder paths (one per line)').setValue('guide.md');
    await browser.$('button=Add sources').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('guide.md'));
    await browser.$('aria/Query').setValue('Where is the blue lantern stored?');
    await browser.$('button=Search knowledge').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('north archive room'));
    expect(await browser.$('body').getText()).to.include('Lantern guide');
  });
});
