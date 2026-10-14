import { expect } from 'chai';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { navigateToSettings, resetLocaleToEnglish, waitForReady } from '../../helpers/ui.js';

const NEW_NEON_THEMES = new Set(['neon-gold', 'neon-cyan', 'neon-violet']);

describe('M4 Themes', () => {
  beforeEach(async () => {
    await waitForReady();
    await resetLocaleToEnglish();
  });

  it('TC-M4-002 applies all 42 theme and mode pairs without browser errors', async () => {
    await waitForReady();
    await browser.$('nav a[href="#settings-theme"]').click();
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
    expect(ids).to.have.length(21);
    expect(ids).to.include.members([...NEW_NEON_THEMES]);
    const screenshotDirectory = resolve(process.cwd(), 'apps/desktop/src-tauri/target/e2e/OWNER-FB1');
    mkdirSync(screenshotDirectory, { recursive: true });
    for (const id of ids) {
      for (const mode of ['Light', 'Dark']) {
        await browser.$(`[data-theme-id="${id}"]`).click();
        await browser.$(`button=${mode}`).click();
        await browser.waitUntil(
          async () => (await browser.execute(() => document.documentElement.dataset.mode)) === mode.toLowerCase(),
        );
        expect(await browser.execute(() => document.documentElement.dataset.theme)).to.equal(id);
        if (mode === 'Dark' && NEW_NEON_THEMES.has(id)) {
          await browser.execute(
            () =>
              new Promise<void>((resolvePaint) => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    resolvePaint();
                  });
                });
              }),
          );
          await browser.saveScreenshot(join(screenshotDirectory, `${id}-dark.png`));
        }
      }
    }
    const errors = await browser.execute(() => (window as Window & { __m4Errors?: string[] }).__m4Errors ?? []);
    expect(errors).to.deep.equal([]);
  });

  it('TC-M4-001 changes Midnight Focus to dark and restores it after app restart', async () => {
    await waitForReady();
    await navigateToSettings();
    await browser.$('nav a[href="#settings-theme"]').click();
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
        (osDark ? 'neon-gold' : 'arctic-focus'),
    );
    expect(await browser.execute(() => document.documentElement.dataset.mode)).to.equal(osDark ? 'dark' : 'light');
  });
});
