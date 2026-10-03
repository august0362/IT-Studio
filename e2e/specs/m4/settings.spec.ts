import { expect } from 'chai';
import { Key } from 'webdriverio';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M4 Settings', () => {
  let originalLadder: string[] = [];

  before(async () => {
    await waitForReady();
    await ensureProviderKeys();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    originalLadder = await browser.$$('ol li span').map((entry) => entry.getText());
  });

  afterEach(async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const autoFallback = browser.$('aria/Auto Fallback');
    if (!(await autoFallback.isSelected())) await autoFallback.click();
    await browser.waitUntil(async () => autoFallback.isSelected());

    for (let targetIndex = 0; targetIndex < originalLadder.length; targetIndex += 1) {
      const current = await browser.$$('ol li span').map((entry) => entry.getText());
      const targetName = originalLadder[targetIndex];
      if (targetName === undefined) continue;
      const currentIndex = current.indexOf(targetName);
      if (currentIndex < 0) throw new Error(`Router model ${targetName} is missing during cleanup`);
      if (currentIndex === targetIndex) continue;
      const row = browser.$$('ol li')[currentIndex];
      const dragButton = row?.$('button[aria-label^="Reorder"]');
      if (dragButton === undefined) throw new Error(`Router model ${targetName} cannot be reordered`);
      await dragButton.click();
      await browser.keys(Key.Space);
      await browser.pause(300);
      for (let step = currentIndex; step > targetIndex; step -= 1) {
        await browser.keys(Key.ArrowUp);
        await browser.pause(300);
      }
      await browser.keys(Key.Space);
      await browser.pause(300);
    }

    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-budget"]').click();
    const hardStop = browser.$('aria/Hard Stop');
    if (await hardStop.isSelected()) await hardStop.click();
    await browser.waitUntil(async () => !(await hardStop.isSelected()));

    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-fx"]').click();
    const clearFxOverride = browser.$('button=Clear override');
    if (await clearFxOverride.isEnabled()) await clearFxOverride.click();
    await browser.waitUntil(async () => !(await clearFxOverride.isEnabled()));

    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-pricing"]').click();
    const gpt55Row = browser.$('tr*=GPT-5.5');
    if ((await gpt55Row.isExisting()) && (await gpt55Row.getText()).includes('Overridden')) {
      await gpt55Row.$('button=Clear override').click();
      await browser.$('[role="alertdialog"] button=Clear override').click();
      await browser.waitUntil(async () => !(await gpt55Row.getText()).includes('Overridden'));
    }
  });

  it('TC-M4-040 persists Auto Fallback after reload', async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const toggle = browser.$('aria/Auto Fallback');
    await browser.waitUntil(async () => toggle.isExisting());
    if (await toggle.isSelected()) await toggle.click();
    await browser.waitUntil(async () => !(await toggle.isSelected()));
    await browser.refresh();
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    await browser.waitUntil(async () => !(await browser.$('aria/Auto Fallback').isSelected()));
    expect(await browser.$('aria/Auto Fallback').isSelected()).to.equal(false);
  });

  it('TC-M4-041 reorders the ladder with the keyboard and announces the move', async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const buttons = browser.$$('ol button[aria-label^="Reorder"]');
    const before = browser.$$('ol li span');
    const first = before[0];
    const second = before[1];
    if (first === undefined || second === undefined || buttons[0] === undefined)
      throw new Error('Router ladder is empty');
    const firstName = await first.getText();
    const secondName = await second.getText();
    await buttons[0].click();
    await browser.keys(Key.Space);
    await browser.pause(300);
    await browser.keys(Key.ArrowDown);
    await browser.pause(300);
    await browser.keys(Key.Space);
    await browser.waitUntil(async () => {
      const statuses = await browser.$$('[role="status"]').map((status) => status.getText());
      return statuses.some((text) => text.includes(`Moved ${firstName} before ${secondName}.`));
    });
    const after = browser.$$('ol li span');
    expect(await after[0]?.getText()).to.equal(secondName);
    expect(await after[1]?.getText()).to.equal(firstName);
    await browser.refresh();
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const persisted = browser.$$('ol li span');
    expect(await persisted[0]?.getText()).to.equal(secondName);
    expect(await persisted[1]?.getText()).to.equal(firstName);
  });

  it('TC-M4-042 blocks chat with a BUDGET_HARD_STOP error and remediation', async () => {
    await waitForReady();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Hard Stop Project');
    await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Hard Stop Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    await browser.$('aria/Limit (USD)').setValue('0.000001');
    await browser.$('button=Save budget').click();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-budget"]').click();
    const hardStop = browser.$('aria/Hard Stop');
    if (!(await hardStop.isSelected())) await hardStop.click();
    await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await browser.$('button=New chat').click();
    await browser.$('aria/Message').setValue('over budget');
    await browser.$('button=Send').click();
    await browser.waitUntil(async () => await browser.$('[role="alert"]').isDisplayed());
    const error = await browser.$('[role="alert"]').getText();
    expect(error).to.include('BUDGET_HARD_STOP');
    expect(error.length).to.be.greaterThan(30);
  });

  it('TC-M4-043 saves a price override and rejects an invalid value', async () => {
    await waitForReady();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Pricing Project');
    await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Pricing Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-pricing"]').click();
    const row = browser.$('tr*=GPT-5.5');
    await row.$('button=Override').click();
    const inputs = browser.$$('form[aria-labelledby="override-heading"] input');
    await inputs[0]?.setValue('0.15');
    await inputs[1]?.setValue('0.30');
    await inputs[2]?.setValue('0.05');
    await browser.$('form[aria-labelledby="override-heading"] button=Save').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Overridden'));
    await row.$('button=Override').click();
    const invalidInputs = browser.$$('form[aria-labelledby="override-heading"] input');
    await invalidInputs[0]?.setValue('-1');
    await invalidInputs[1]?.setValue('0.3');
    await invalidInputs[2]?.setValue('0.1');
    await browser.$('form[aria-labelledby="override-heading"] button=Save').click();
    await browser.waitUntil(async () => await browser.$('[role="alert"]').isDisplayed());
    expect(await browser.$('[role="alert"]').getText()).to.include('valid non-negative');
  });

  it('TC-M4-044 disables price updates without an active project and explains D31', async () => {
    await waitForReady();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('No Active Pricing Project');
    await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'No Active Pricing Project',
    );
    await browser.$('[role="tab"][aria-selected="true"]').click();
    await browser.$('button=All projects').click();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-pricing"]').click();
    expect(await browser.$('button=Update prices').isEnabled()).to.equal(false);
    expect(await browser.$('body').getText()).to.include('D31: Select a project before updating prices.');
  });

  it('TC-M4-045 applies and clears an FX override reflected in VND Money lines', async () => {
    await waitForReady();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('FX Project');
    await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'FX Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    await browser.$('aria/Amount').setValue('1');
    await browser.$('aria/Description').setValue('FX test revenue');
    await browser.$('button=Add revenue').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('FX test revenue'));
    const money = browser.$('[aria-label^="USD "]');
    const vndText = async (): Promise<string> => {
      const label = await money.getAttribute('aria-label');
      return label?.split('; VND ')[1] ?? '';
    };
    const beforeVnd = await vndText();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-fx"]').click();
    await browser.$('input[type="number"]').setValue('25000');
    await browser.$('button=Save').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('25,000 VND per USD'));
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    await browser.waitUntil(async () => (await vndText()) !== beforeVnd);
    expect(await vndText()).not.to.equal(beforeVnd);
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-fx"]').click();
    await browser.$('button=Clear override').click();
    await browser.waitUntil(async () => !(await browser.$('body').getText()).includes('Manual override'));
  });

  it('TC-M4-046 clears a manual price override and removes its badge', async () => {
    await waitForReady();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Clear Pricing Override Project');
    await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () =>
        (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Clear Pricing Override Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-pricing"]').click();
    const row = browser.$('tr*=GPT-5.5');
    await row.$('button=Override').click();
    const inputs = browser.$$('form[aria-labelledby="override-heading"] input');
    await inputs[0]?.setValue('0.15');
    await inputs[1]?.setValue('0.30');
    await inputs[2]?.setValue('0.05');
    await browser.$('form[aria-labelledby="override-heading"] button=Save').click();
    await browser.waitUntil(async () => (await row.getText()).includes('Overridden'));

    await row.$('button=Clear override').click();
    const dialog = browser.$('[role="alertdialog"]');
    await browser.waitUntil(async () => dialog.isDisplayed());
    await dialog.$('button=Clear override').click();
    await browser.waitUntil(async () => !(await row.getText()).includes('Overridden'));
    expect(await row.getText()).not.to.include('Overridden');
  });
});
