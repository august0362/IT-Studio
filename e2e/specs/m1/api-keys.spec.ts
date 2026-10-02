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
    await browser.execute(() => {
      window.confirm = () => false;
    });
    await browser.$('form:has(#api-key-openai) button:nth-of-type(3)').click();
    expect(await browser.$('[aria-label="OpenAI key status"]').getText()).to.include('Set');
    await browser.execute(() => {
      window.confirm = () => true;
    });
    await browser.$('form:has(#api-key-openai) button:nth-of-type(3)').click();
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
    await browser.keys(['ESC']);
    expect(await browser.$('[aria-label="OpenAI key status"]').getText()).to.include('Set');
    expect(await browser.$('[role="alertdialog"]').isExisting()).to.equal(false);
    await browser.$('form:has(#api-key-openai) button:nth-of-type(3)').click();
    await browser.keys(['TAB', 'ENTER']);
    await browser.waitUntil(
      async () => (await browser.$('[aria-label="OpenAI key status"]').getText()).includes('Not set'),
      { timeout: 10_000 },
    );
  });
});
