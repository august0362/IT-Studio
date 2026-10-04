import { expect } from 'chai';
import { Key, remote } from 'webdriverio';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder } from '../../helpers/ui.js';

interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName: 'wry';
  'tauri:options': { application: string };
}

type Session = Awaited<ReturnType<typeof remote>>;
let session: Session | undefined;
let originalEnabled = true;
let originalOrder: string[] = [];

async function openImageSession(): Promise<Session> {
  const appPath = `${process.cwd()}\\apps\\desktop\\src-tauri\\target\\debug\\itstudio-desktop.exe`;
  const active = await remote({
    hostname: '127.0.0.1',
    port: 4449,
    path: '/',
    capabilities: { browserName: 'wry', 'tauri:options': { application: appPath } } as TauriCapabilities,
  });
  session = active;
  await active.waitUntil(async () => (await active.$('footer[role="status"]').getText()).includes('Ready v0.1.0'), {
    timeout: 30_000,
    timeoutMsg: 'The M8 app did not become ready within 30 seconds',
  });
  await active.$('nav[aria-label="Main navigation"] a[href="#settings-images"]').click();
  const toggle = active.$('aria/Enable image generation');
  await active.waitUntil(async () => toggle.isExisting());
  originalEnabled = await toggle.isSelected();
  originalOrder = await active.$$('ol li > span:first-of-type').map((entry) => entry.getText());
  return active;
}

async function createProject(active: Session, name: string): Promise<void> {
  await active.$('button[aria-label="Add project"]').click();
  await active.$('aria/Project name').setValue(name);
  await active.$('aria/Folder path').setValue(createTemporaryProjectFolder());
  await active.$('button=Create project').click();
  await active.waitUntil(async () => (await active.$('[role="tab"][aria-selected="true"]').getText()) === name);
}

async function enableImages(active: Session): Promise<void> {
  await active.$('nav[aria-label="Main navigation"] a[href="#settings-images"]').click();
  const toggle = active.$('aria/Enable image generation');
  if (!(await toggle.isSelected())) await toggle.click();
  await active.waitUntil(async () => toggle.isSelected());
}

async function sendScriptedImageRequest(active: Session): Promise<void> {
  await active.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
  await active.$('button=New chat').click();
  await active.$('#chat-model').selectByAttribute('value', 'openai/gpt-5.4-mini');
  await active.$('aria/Message').setValue('Generate a blue bird image');
  await active.$('button=Send').click();
}

async function restoreImageSettings(active: Session): Promise<void> {
  await active.$('nav[aria-label="Main navigation"] a[href="#settings-images"]').click();
  const toggle = active.$('aria/Enable image generation');
  if ((await toggle.isSelected()) !== originalEnabled) await toggle.click();
  await active.waitUntil(async () => (await toggle.isSelected()) === originalEnabled);
  for (let targetIndex = 0; targetIndex < originalOrder.length; targetIndex += 1) {
    const current = await active.$$('ol li > span:first-of-type').map((entry) => entry.getText());
    const targetName = originalOrder[targetIndex];
    if (targetName === undefined) continue;
    const currentIndex = current.indexOf(targetName);
    if (currentIndex < 0) throw new Error(`Image provider ${targetName} is missing during cleanup`);
    if (currentIndex === targetIndex) continue;
    const button = active.$$('ol li button[aria-label^="Reorder"]')[currentIndex];
    if (button === undefined) throw new Error(`Image provider ${targetName} cannot be reordered`);
    await button.click();
    await active.keys(Key.Space);
    for (let index = currentIndex; index > targetIndex; index -= 1) await active.keys(Key.ArrowUp);
    await active.keys(Key.Space);
  }
}

describe('M8 image generation', () => {
  afterEach(async () => {
    const active = session;
    session = undefined;
    if (active === undefined) return;
    try {
      await active.keys('ESC');
      const dialogs = await Promise.resolve(active.$$('[role="dialog"], [role="alertdialog"]'));
      for (const dialog of dialogs) {
        if (!(await dialog.isDisplayed())) continue;
        const cancel = dialog.$('button=Cancel');
        const close = dialog.$('button=Close');
        if (await cancel.isExisting()) await cancel.click();
        else if (await close.isExisting()) await close.click();
      }
      await active.waitUntil(
        async () => {
          const dialogs = await Promise.resolve(active.$$('[role="dialog"], [role="alertdialog"]'));
          for (const dialog of dialogs) if (await dialog.isDisplayed()) return false;
          return true;
        },
        { timeout: 10_000, timeoutMsg: 'M8 dialogs did not close during cleanup' },
      );
      await restoreImageSettings(active);
    } finally {
      await active.deleteSession();
    }
  });

  it('TC-M8-010 renders the generated image in chat and opens its lightbox', async () => {
    const active = await openImageSession();
    await ensureProviderKeys(['openai'], active);
    await createProject(active, 'M8 Image Chat');
    await enableImages(active);
    await sendScriptedImageRequest(active);
    const image = active.$('img[alt*="blue bird"]');
    try {
      await active.waitUntil(async () => image.isDisplayed(), { timeout: 30_000 });
    } catch (error) {
      const body = await active.$('body').getText();
      throw new Error(`TC-M8-010 did not render the image; chat body: ${body.slice(-1500)}`, { cause: error });
    }
    await image.click();
    await active.waitUntil(async () => active.$('[role="dialog"]').isDisplayed());
    expect(await active.$('[role="dialog"]').getText()).to.contain('Close');
  });

  it('TC-M8-011 lists the image prompt and cost in Gallery and confirms deletion', async () => {
    const active = await openImageSession();
    await ensureProviderKeys(['openai'], active);
    await createProject(active, 'M8 Image Gallery');
    await enableImages(active);
    await sendScriptedImageRequest(active);
    await active.waitUntil(async () => active.$('img[alt*="blue bird"]').isDisplayed(), { timeout: 30_000 });
    await active.$('nav[aria-label="Main navigation"] a[href="#gallery"]').click();
    await active.waitUntil(async () => (await active.$('body').getText()).includes('A blue bird on a branch'));
    const cost = active.$('[aria-label^="USD "]');
    await active.waitUntil(async () => cost.isDisplayed());
    await active.$('button=Delete').click();
    const dialog = active.$('[role="alertdialog"]');
    await active.waitUntil(async () => dialog.isDisplayed());
    expect(await dialog.getText()).to.contain('blue bird');
    await dialog.$('button=Delete').click();
    await active.waitUntil(async () => (await active.$('body').getText()).includes('No generated images yet.'));
  });

  it('TC-M8-012 persists the image toggle and keyboard provider order after reload', async () => {
    const active = await openImageSession();
    await createProject(active, 'M8 Image Settings');
    await active.$('nav[aria-label="Main navigation"] a[href="#settings-images"]').click();
    const toggle = active.$('aria/Enable image generation');
    const initial = await toggle.isSelected();
    await toggle.click();
    await active.waitUntil(async () => (await toggle.isSelected()) !== initial);
    const providers = await active.$$('ol li > span:first-of-type').map((entry) => entry.getText());
    const reorder = active.$$('ol li button[aria-label^="Reorder"]')[0];
    if (providers.length < 2 || reorder === undefined) throw new Error('Image provider order is too short to reorder');
    await reorder.click();
    await active.keys(Key.Space);
    await active.keys(Key.ArrowDown);
    await active.keys(Key.Space);
    await active.refresh();
    await active.$('nav[aria-label="Main navigation"] a[href="#settings-images"]').click();
    await active.waitUntil(async () => (await active.$('aria/Enable image generation').isSelected()) !== initial);
    const reordered = await active.$$('ol li > span:first-of-type').map((entry) => entry.getText());
    expect(reordered[0]).to.equal(providers[1]);
    expect(reordered[1]).to.equal(providers[0]);
  });
});
