import { describe, expect, it } from 'vitest';
import { WebChatBrowser } from '@itstudio/schemas';
import { BrowserLocator } from './browser-locator.js';

describe('BrowserLocator', () => {
  it('finds each browser and respects candidate order', async () => {
    const paths = new Set(
      [
        'C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      ].map((path) => path.toLowerCase()),
    );
    const locator = new BrowserLocator(
      { exists: (path) => Promise.resolve({ ok: true, value: paths.has(path.toLowerCase()) }) },
      {
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        LOCALAPPDATA: 'C:\\Users\\owner\\AppData\\Local',
      },
    );
    await expect(locator.locate(WebChatBrowser.COCCOC)).resolves.toBe(
      'C:\\Program Files\\CocCoc\\Browser\\Application\\browser.exe',
    );
    await expect(locator.locate(WebChatBrowser.CHROME)).resolves.toBe(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    );
    await expect(locator.locate(WebChatBrowser.EDGE)).resolves.toBe(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
    await expect(locator.locate(WebChatBrowser.FIREFOX)).resolves.toBe(
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    );
  });

  it('uses custom paths only when absolute, exe, and present', async () => {
    const locator = new BrowserLocator({ exists: () => Promise.resolve({ ok: true, value: true }) }, {});
    await expect(locator.locate(WebChatBrowser.CUSTOM, 'C:\\Browser.exe')).resolves.toBe('C:\\Browser.exe');
    await expect(locator.locate(WebChatBrowser.CUSTOM, 'relative.exe')).resolves.toBeNull();
    await expect(locator.locate(WebChatBrowser.CUSTOM, 'C:\\Browser.cmd')).resolves.toBeNull();
    await expect(locator.locate(WebChatBrowser.DEFAULT)).resolves.toBeNull();
  });

  it('uses later install roots and reports browser availability', async () => {
    const available = new Set([
      'C:\\Users\\owner\\AppData\\Local\\CocCoc\\Browser\\Application\\browser.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]);
    const locator = new BrowserLocator(
      { exists: (path) => Promise.resolve({ ok: true, value: available.has(path) }) },
      {
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        LOCALAPPDATA: 'C:\\Users\\owner\\AppData\\Local',
      },
    );
    await expect(locator.locate(WebChatBrowser.COCCOC)).resolves.toBe(
      'C:\\Users\\owner\\AppData\\Local\\CocCoc\\Browser\\Application\\browser.exe',
    );
    const browsers = await locator.list({
      browser: WebChatBrowser.DEFAULT,
      customBrowserPath: 'C:\\Missing.exe',
      links: [],
    });
    expect(browsers).toContainEqual({ browser: WebChatBrowser.DEFAULT, installed: true, path: null });
    const coccoc = browsers.find((browser) => browser.browser === WebChatBrowser.COCCOC);
    expect(coccoc?.installed).toBe(true);
    expect(typeof coccoc?.path).toBe('string');
    expect(browsers).toContainEqual({ browser: WebChatBrowser.CUSTOM, installed: false, path: null });
  });
});
