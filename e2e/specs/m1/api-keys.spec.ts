import { expect } from 'chai';
import { apiKeyInput, navigateToSettings, waitForReady } from '../../helpers/ui.js';

describe('M1 API Keys UI', () => {
  beforeEach(async () => {
    await waitForReady();
    await navigateToSettings();
  });

  it('TC-M1-030 saves a key as write-only and shows its hint', async () => {
    const input = apiKeyInput();
    const secret = 'sk-TEST-e2e-4321';
    await input.setValue(secret);
    await browser.$('form:has(#api-key-openai) button[type="submit"]').click();
    await browser.waitUntil(async () => (await input.getValue()) === '');
    expect(await browser.$('[aria-label="OpenAI key status"]').getText()).to.include('Set ••••4321');
    expect(await input.getValue()).to.equal('');
  });

  it('TC-M1-035 confirms deletion and cancel preserves the key', async () => {
    const input = apiKeyInput();
    await input.setValue('test-delete-1234');
    await browser.$('form:has(#api-key-openai) button[type="submit"]').click();
    await browser.waitUntil(async () =>
      (await browser.$('[aria-label="OpenAI key status"]').getText()).includes('Set'),
    );
    // In-app ConfirmDialog (BUG-M1-005 / M1-FIX3) replaced window.confirm.
    await browser.$('form:has(#api-key-openai) button:nth-of-type(3)').click();
    await browser.$('[role="alertdialog"]').waitForDisplayed();
    await browser.$('[role="alertdialog"]').$('button=Cancel').click();
    await browser.$('[role="alertdialog"]').waitForDisplayed({ reverse: true });
    expect(await browser.$('[aria-label="OpenAI key status"]').getText()).to.include('Set');
    await browser.$('form:has(#api-key-openai) button:nth-of-type(3)').click();
    await browser.$('[role="alertdialog"]').waitForDisplayed();
    await browser.$('[role="alertdialog"]').$('button=Delete').click();
    await browser.waitUntil(async () =>
      (await browser.$('[aria-label="OpenAI key status"]').getText()).includes('Not set'),
    );
  });

  it('TC-M1-040 completes the API Keys flow with keyboard navigation', async () => {
    await browser.keys(['TAB', 'TAB', 'TAB']);
    const input = apiKeyInput();
    await input.click();
    await input.setValue('keyboard-test-1234');
    await input.addValue('\uE007');
    await browser.waitUntil(
      async () => (await browser.$('[aria-label="OpenAI key status"]').getText()).includes('Set'),
      { timeout: 10_000 },
    );
    expect(await input.getValue()).to.equal('');
    await browser.$('form:has(#api-key-openai) button:nth-of-type(3)').click();
    // Wait like a real user: dialog visible and focus moved to Cancel before pressing keys.
    await browser.$('[role="alertdialog"]').waitForDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.activeElement?.textContent)) === 'Cancel',
    );
    await browser.keys(['Escape']);
    await browser.$('[role="alertdialog"]').waitForDisplayed({ reverse: true });
    expect(await browser.$('[aria-label="OpenAI key status"]').getText()).to.include('Set');
    await browser.$('form:has(#api-key-openai) button:nth-of-type(3)').click();
    await browser.$('[role="alertdialog"]').waitForDisplayed();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.activeElement?.textContent)) === 'Cancel',
    );
    await browser.keys(['Tab', 'Enter']);
    await browser.waitUntil(
      async () => (await browser.$('[aria-label="OpenAI key status"]').getText()).includes('Not set'),
      { timeout: 10_000 },
    );
  });
});
