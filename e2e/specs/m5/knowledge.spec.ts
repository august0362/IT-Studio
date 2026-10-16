import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'chai';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M5 knowledge', () => {
  before(async () => {
    await waitForReady();
    await ensureProviderKeys();
  });

  beforeEach(async () => {
    await browser.refresh();
    await waitForReady();
  });

  it('TC-M5-020 adds a markdown source and retrieves a matching chunk', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    writeFileSync(join(folder, 'guide.md'), '# Lantern guide\n\nThe blue lantern is stored in the north archive room.');
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Knowledge E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.$('nav a[href="#knowledge"]').click();
    await browser.$('aria/Workspace-relative file or folder paths (one per line)').setValue('guide.md');
    await browser.$('button=Add sources').click();
    const progress = browser.$('section[aria-label="Ingestion progress"] article');
    await browser.waitUntil(
      async () => (await progress.isExisting()) && (await progress.getText()).includes('Indexed'),
    );
    const row = browser.$('table tbody tr');
    await browser.waitUntil(async () => (await row.isExisting()) && (await row.getText()).includes('Lantern guide'));
    await browser.$('aria/Query').setValue('Where is the blue lantern stored?');
    await browser.$('aria/Minimum score').setValue('0');
    await browser.$('button=Search knowledge').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('north archive room'));
    expect(await browser.$('body').getText()).to.include('Lantern guide');
  });

  it('TC-M5-021 shows a validation error and remediation for an outside path', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    await openProject(folder, 'Knowledge validation project');
    await browser.$('nav a[href="#knowledge"]').click();
    await browser.$('aria/Workspace-relative file or folder paths (one per line)').setValue('../outside.md');
    await browser.$('button=Add sources').click();
    const alert = browser.$('[role="alert"]');
    await alert.waitForDisplayed();
    expect(await alert.getText()).to.include('inside');
    expect(await alert.getText()).to.include('try');
  });

  it('TC-M5-022 keeps a document on cancel and removes it after confirmation', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    writeFileSync(join(folder, 'delete-me.md'), '# Delete me\n\nTemporary content.');
    await openProject(folder, 'Knowledge deletion project');
    await browser.$('nav a[href="#knowledge"]').click();
    await browser.$('aria/Workspace-relative file or folder paths (one per line)').setValue('delete-me.md');
    await browser.$('button=Add sources').click();
    const row = browser.$('table tbody tr');
    await browser.waitUntil(async () => (await row.isExisting()) && (await row.getText()).includes('Delete me'));
    await row.$('button=Delete').click();
    await browser.$('[role="alertdialog"]').$('button=Cancel').click();
    expect(await row.getText()).to.include('Delete me');
    await row.$('button=Delete').click();
    await browser.$('[role="alertdialog"]').$('button=Delete').click();
    await browser.waitUntil(async () => !(await row.isExisting()));
  });

  it('TC-M5-023 toggles knowledge on and opens a plain-text citation popover', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    writeFileSync(join(folder, 'lantern.md'), '# Lantern\n\nThe blue lantern is in the north archive room.');
    await openProject(folder, 'Knowledge chat project');
    await browser.$('nav a[href="#knowledge"]').click();
    await browser.$('aria/Workspace-relative file or folder paths (one per line)').setValue('lantern.md');
    await browser.$('button=Add sources').click();
    const progress = browser.$('section[aria-label="Ingestion progress"] article');
    await browser.waitUntil(
      async () => (await progress.isExisting()) && (await progress.getText()).includes('Indexed'),
    );
    const row = browser.$('table tbody tr');
    await browser.waitUntil(async () => (await row.isExisting()) && (await row.getText()).includes('Lantern'));
    await browser.$('nav a[href="#chat"]').click();
    await browser.$('button=New chat').click();
    await browser.$('aria/Use knowledge').click();
    await browser.$('aria/Message').setValue('The blue lantern is in the north archive room.');
    await browser.$('button=Send').click();
    await browser.waitUntil(async () => browser.$('aria/Citation 1').isDisplayed());
    await browser.$('aria/Citation 1').click();
    const body = await browser.$('body').getText();
    expect(body).to.include('north archive room');
    expect(body).not.to.include('<context>');
    await browser.$('aria/Citation 1').click();
    await browser.keys('ESC');
    await browser.waitUntil(async () => !(await browser.$('[role="dialog"]').isDisplayed()));
  });
});

async function openProject(folder: string, name: string): Promise<void> {
  await browser.$('button[aria-label="Add project"]').click();
  await browser.$('aria/Project name').setValue(name);
  await browser.$('aria/Folder path').setValue(folder);
  await browser.$('button=Create project').click();
  await browser.waitUntil(
    async () => (await browser.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) === name,
  );
}
