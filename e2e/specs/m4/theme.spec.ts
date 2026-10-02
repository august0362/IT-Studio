import { expect } from 'chai';
import { navigateToSettings, waitForReady } from '../../helpers/ui.js';

describe('M4 Themes', () => {
  it('TC-M4-002 applies all 36 theme and mode pairs without browser errors', async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-theme"]').click();
    await browser.execute(() => {
      const errors: string[] = [];
      Object.defineProperty(window, '__m4Errors', { configurable: true, value: errors });
      const original = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
        original(...args);
      };
    });
    const ids = await Promise.resolve(
      browser.execute(() =>
        Array.from(
          document.querySelectorAll('[data-theme-id]'),
          (element) => element.getAttribute('data-theme-id') ?? '',
        ),
      ),
    );
    expect(ids).to.have.length(18);
    for (const id of ids) {
      for (const mode of ['Light', 'Dark']) {
        await browser.$(`[data-theme-id="${id}"]`).click();
        await browser.$(`button=${mode}`).click();
        await browser.waitUntil(
          async () => (await browser.execute(() => document.documentElement.dataset.mode)) === mode.toLowerCase(),
        );
        expect(await browser.execute(() => document.documentElement.dataset.theme)).to.equal(id);
      }
    }
    const errors = await browser.execute(() => (window as Window & { __m4Errors?: string[] }).__m4Errors ?? []);
    expect(errors).to.deep.equal([]);
  });

  it('TC-M4-001 changes Midnight Focus to dark and restores it after app restart', async () => {
    await waitForReady();
    await navigateToSettings();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-theme"]').click();
    await browser.$('[role="radio"][data-theme-id="midnight-focus"]').click();
    await browser.$('button=Dark').click();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.dataset.theme)) === 'midnight-focus',
    );
    expect(await browser.execute(() => document.documentElement.dataset.mode)).to.equal('dark');
    await browser.refresh();
    await waitForReady();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.dataset.theme)) === 'midnight-focus',
    );
    expect(await browser.execute(() => document.documentElement.dataset.mode)).to.equal('dark');
    await browser.$('button=Reset default').click();
    // Reset = mode System + default theme for the OS colour scheme (product rule); the expectation must follow the OS.
    const osDark = await browser.execute(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.documentElement.dataset.theme)) ===
        (osDark ? 'midnight-focus' : 'arctic-focus'),
    );
    expect(await browser.execute(() => document.documentElement.dataset.mode)).to.equal(osDark ? 'dark' : 'light');
  });
});
