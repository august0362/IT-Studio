import { expect } from 'chai';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTemporaryProjectFolder, waitForReady } from '../../helpers/ui.js';

describe('M4 App shell', () => {
  it('TC-M4-010 creates a project in the dialog and selects its tab', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Shell E2E Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    // Wait for the UI to switch to the new project (reading immediately returns the previous "All projects" tab).
    await browser.waitUntil(
      async () =>
        (await browser.$('[role="tablist"] [role="tab"][aria-selected="true"]').getText()) === 'Shell E2E Project',
      { timeout: 10_000, timeoutMsg: 'new project tab was not selected after creation' },
    );
  });

  it('TC-M4-011 switches to Vietnamese and restores the locale after reload', async () => {
    await waitForReady();
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-theme"]').click();
    await browser.$('select:has(option[value="vi"])').selectByAttribute('value', 'vi');
    await browser.waitUntil(
      async () => (await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').getText()) === 'Trò chuyện',
    );
    await browser.refresh();
    await waitForReady();
    await browser.waitUntil(
      async () => (await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').getText()) === 'Trò chuyện',
    );
    expect(await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').getText()).to.equal('Chi phí & Lãi lỗ');
    await browser.$('nav[aria-label="Main navigation"] a[href="#settings-theme"]').click();
    await browser.$('select:has(option[value="vi"])').selectByAttribute('value', 'en');
    await browser.waitUntil(
      async () => (await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').getText()) === 'Chat',
    );
  });

  it('TC-M4-012 opens three projects, closes the middle tab and keeps its project', async () => {
    await waitForReady();
    for (const name of ['Portfolio Alpha', 'Portfolio Beta', 'Portfolio Gamma']) {
      await browser.$('button[aria-label="Add project"]').click();
      await browser.$('aria/Project name').setValue(name);
      await browser.$('aria/Folder path').setValue(createTemporaryProjectFolder());
      await browser.$('button=Create project').click();
      await browser.waitUntil(async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === name);
    }
    await browser.$('button=Portfolio Beta').click();
    await browser.$('button[aria-label="Close Portfolio Beta"]').click();
    expect(await browser.$('[role="tablist"]').getText()).not.to.include('Portfolio Beta');
    expect(await browser.$('[role="tab"][aria-selected="true"]').getText()).to.equal('All projects');
    await browser.$('nav[aria-label="Main navigation"] a[href="#cost"]').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('Portfolio Beta'));
  });

  it('TC-M4-013 has no untranslated i18n keys on any visible route', async () => {
    await waitForReady();
    const routes = [
      'chat',
      'code',
      'knowledge',
      'cost',
      'settings-api-keys',
      'settings-theme',
      'settings-router',
      'settings-budget',
      'settings-pricing',
      'settings-fx',
      'settings-vscode',
      'settings-pipeline',
    ];
    for (const route of routes) {
      await browser.$(`nav[aria-label="Main navigation"] a[href="#${route}"]`).click();
      await browser.waitUntil(async () => (await browser.$('main').getText()).length > 0);
      const text = await browser.$('main').getText();
      expect(text, `route ${route}`).not.to.match(
        /\b(?:app|nav|projects|chat|code|knowledge|cost|settings|theme|api)\.[a-z][\w.]*/u,
      );
    }
  });

  it('TC-M4-050 loads the code tab lazily and uses bundled Monaco assets', async () => {
    await waitForReady();
    await browser.execute(() => {
      Object.defineProperty(window, '__m4ResourcesBefore', {
        configurable: true,
        value: performance.getEntriesByType('resource').map(({ name }) => name),
      });
    });
    await browser.$('nav[aria-label="Main navigation"] a[href="#code"]').click();
    await browser.waitUntil(async () => await browser.$('#code-heading').isDisplayed());
    const external = await browser.execute(() => {
      const before = (window as Window & { __m4ResourcesBefore?: string[] }).__m4ResourcesBefore ?? [];
      return performance
        .getEntriesByType('resource')
        .map(({ name }) => name)
        .filter(
          (name) => !before.includes(name) && /monaco|vs\/editor/iu.test(name) && !name.startsWith(location.origin),
        );
    });
    expect(external).to.deep.equal([]);
  });

  it('TC-M4-051 keeps ingest progress available after switching tabs mid-ingest', async () => {
    await waitForReady();
    const folder = createTemporaryProjectFolder();
    writeFileSync(join(folder, 'guide.md'), '# Switch test\n\nThis document is indexed while changing tabs.');
    await browser.$('button[aria-label="Add project"]').click();
    await browser.$('aria/Project name').setValue('Tab Switch Project');
    await browser.$('aria/Folder path').setValue(folder);
    await browser.$('button=Create project').click();
    await browser.waitUntil(
      async () => (await browser.$('[role="tab"][aria-selected="true"]').getText()) === 'Tab Switch Project',
    );
    await browser.$('nav[aria-label="Main navigation"] a[href="#knowledge"]').click();
    await browser.$('aria/Workspace-relative file or folder paths (one per line)').setValue('guide.md');
    await browser.$('button=Add sources').click();
    await browser.$('nav[aria-label="Main navigation"] a[href="#chat"]').click();
    await browser.$('nav[aria-label="Main navigation"] a[href="#knowledge"]').click();
    await browser.waitUntil(async () => (await browser.$('body').getText()).includes('guide.md'), { timeout: 20_000 });
    expect(await browser.$('body').getText()).to.match(/Indexed|Ingestion progress/u);
  });
});
