import { expect } from 'chai';
import { Key } from 'webdriverio';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

async function createChatProject(name: string): Promise<void> {
  const folder = createTemporaryProjectFolder();
  await browser.$('button[aria-label="Add project"]').click();
  await browser.$('aria/Project name').setValue(name);
  await browser.$('aria/Folder path').setValue(folder);
  await browser.$('button=Create project').click();
  await browser.waitUntil(async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === name);
  await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
}

describe('M4 chat', () => {
  before(async () => {
    await waitForReady();
    await ensureProviderKeys();
  });

  it('TC-M4-020 creates a conversation and receives the scripted reply with cost', async () => {
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Chat E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) === 'Chat E2E Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await browser.$('button=New chat').click();
    await browser.$('aria/Message').setValue('hello');
    await browser.$('button=Send').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Scripted assistant reply.'));
    const money = browser.$('[aria-label^="USD "]');
    expect(await money.getText()).to.include('$');
  });

  it('TC-M4-025 supports keyboard chat navigation, Enter send and Shift+Enter newline', async () => {
    await createChatProject('Keyboard Chat Project');
    await browser.$('button=New chat').click();
    const composer = browser.$('aria/Message');
    await composer.setValue('first line');
    await browser.keys([Key.Shift, Key.Enter, Key.Shift]);
    await composer.addValue('second line');
    await browser.keys(Key.Enter);
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Scripted assistant reply.'));
    expect(await browser.$('body').getText()).to.include('first line');
    expect(await browser.$('body').getText()).to.include('second line');
  });
});
