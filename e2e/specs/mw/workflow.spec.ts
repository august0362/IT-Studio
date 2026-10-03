import { expect } from 'chai';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('MW workflow map', () => {
  before(async () => {
    await waitForReady();
    await ensureProviderKeys();
  });

  it('TC-MW-010 displays live chat routing activity in the workflow graph', async () => {
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Workflow E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Workflow E2E Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await browser.$('button=New chat').click();
    await browser.$('aria/Message').setValue('workflow smoke request');
    await browser.$('button=Send').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Scripted assistant reply.'));
    await browser.$('nav[aria-label="Main navigation"] a[href="#workflow"]').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Router'));
    const routerNode = browser.$('[data-id="router"].react-flow__node');
    await browser.waitUntil(async () => /Calls \(24 h\)\s*[1-9]\d*/.test(await routerNode.getText()));
    await routerNode.click();
    await browser.$('button=Recent').click();
    const body = await browser.$('body').getText();
    expect(body).to.match(/Router completed on [a-z0-9_-]+\/[a-z0-9._-]+/i);
    expect(body).not.to.include('workflow smoke request');
  });
});
