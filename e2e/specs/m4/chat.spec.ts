import { expect } from 'chai';
import { apiKeyInput, createTemporaryProjectFolder, navigateToSettings, waitForReady } from '../../helpers/ui.js';

describe('M4 chat', () => {
  it('TC-M4-020 creates a conversation and receives the scripted reply with cost', async () => {
    await waitForReady();
    // The router skips providers without a key (capability_mismatch); E2E uses the in-memory secret store.
    await navigateToSettings();
    await apiKeyInput().setValue('sk-TEST-e2e-chat');
    await browser.$('form:has(#api-key-openai) button[type="submit"]').click();
    await browser.waitUntil(async () =>
      (await browser.$('[aria-label="OpenAI key status"]').getText()).includes('Set'),
    );
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
});
