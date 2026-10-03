import { expect } from 'chai';
import { ensureProviderKeys } from '../../helpers/keys.js';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M4 cost and P&L', () => {
  before(async () => {
    await waitForReady();
    await ensureProviderKeys();
  });

  afterEach(async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-router"]').click();
    const autoFallback = browser.$('aria/Auto Fallback');
    if (!(await autoFallback.isSelected())) await autoFallback.click();
    await browser.waitUntil(async () => autoFallback.isSelected());
  });

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

  it('TC-M4-031 saves a 12.5 USD budget and displays validation for exponential input', async () => {
    await waitForReady();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Budget E2E Project');
    await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Budget E2E Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    const limit = browser.$('aria/Limit (USD)');
    await limit.setValue('12.5');
    await browser.$('button=Save budget').click();
    const budgetUsage = browser.$('[aria-label="0% budget used"]');
    await browser.waitUntil(async () => budgetUsage.isDisplayed());
    expect(await budgetUsage.isDisplayed()).to.equal(true);
    expect(await browser.$('body').getText()).to.include('budget used: 0% · $0.00');
    expect(await browser.$('body').getText()).to.include('$0.00 · 0 ₫');
    await limit.setValue('1e3');
    await browser.$('button=Save budget').click();
    const alert = browser.$('[role="alert"]');
    await browser.waitUntil(async () => alert.isDisplayed());
    expect(await alert.getText()).to.include('valid positive USD limit');
  });

  it('TC-M4-032 shows all project margins worst first and totals portfolio KPIs', async () => {
    await waitForReady();
    const runSuffix = String(Date.now());
    const lowName = `Portfolio Low ${runSuffix}`;
    const highName = `Portfolio High ${runSuffix}`;
    for (const [name, amount] of [
      [lowName, '10'],
      [highName, '100'],
    ] as const) {
      await browser.$('button[aria-label="Add project"]').click();
      await browser.$('aria/Project name').setValue(name);
      await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
      await browser.$('button=Create project').click();
      await browser.waitUntil(async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === name);
      await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
      await browser.$('aria/Amount').setValue(amount);
      await browser.$('aria/Description').setValue(`${name} revenue`);
      await browser.$('button=Add revenue').click();
      await browser.waitUntil(async () => (await browser.$('body').getText()).includes(`$${amount}.00`));
    }
    await browser.$('button=All projects').click();
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes(lowName));
    const rows = await browser.$$('table tbody tr').map((row) => row.getText());
    const lowIndex = rows.findIndex((row) => row.includes(lowName));
    const highIndex = rows.findIndex((row) => row.includes(highName));
    expect(lowIndex).to.be.greaterThan(-1);
    expect(highIndex).to.be.greaterThan(-1);
    expect(lowIndex).to.be.lessThan(highIndex);
    expect(rows[lowIndex]).to.include('$10.00');
    expect(rows[highIndex]).to.include('$100.00');
  });

  it('TC-M4-033 refreshes cost data after a chat ledger notification', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Live Cost Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Live Cost Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await browser.$('button=New chat').click();
    await browser.$('aria/Message').setValue('refresh ledger');
    await browser.$('button=Send').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Scripted assistant reply.'));
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Tokens in'), { timeout: 15_000 });
    expect(await browser.$('body').getText()).to.include('GPT-5.4 mini');
  });
});
