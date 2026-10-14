import { isAbsolute, join } from 'node:path';
import { WebChatBrowser, type WebChatBrowser as Browser, type WebChatSettings } from '@itstudio/schemas';
import type { IFileSystem } from '../ports/file-system.js';

export interface LocatedBrowser {
  readonly browser: Browser;
  readonly installed: boolean;
  readonly path: string | null;
}

export class BrowserLocator {
  private readonly fs: Pick<IFileSystem, 'exists'>;
  private readonly env: NodeJS.ProcessEnv;

  constructor(fs: Pick<IFileSystem, 'exists'>, env: NodeJS.ProcessEnv) {
    this.fs = fs;
    this.env = env;
  }

  async locate(browser: Browser, customPath: string | null = null): Promise<string | null> {
    if (browser === WebChatBrowser.DEFAULT) return null;
    if (browser === WebChatBrowser.CUSTOM) {
      if (customPath === null || !isAbsolute(customPath) || !customPath.toLocaleLowerCase('en-US').endsWith('.exe'))
        return null;
      return (await this.exists(customPath)) ? customPath : null;
    }
    for (const path of this.candidates(browser)) if (await this.exists(path)) return path;
    return null;
  }

  async list(settings?: WebChatSettings): Promise<readonly LocatedBrowser[]> {
    const choices: readonly Browser[] = [
      WebChatBrowser.DEFAULT,
      WebChatBrowser.COCCOC,
      WebChatBrowser.CHROME,
      WebChatBrowser.EDGE,
      WebChatBrowser.FIREFOX,
      WebChatBrowser.CUSTOM,
    ];
    const found = await Promise.all(
      choices.map(async (browser): Promise<LocatedBrowser> => {
        const path =
          browser === WebChatBrowser.DEFAULT ? null : await this.locate(browser, settings?.customBrowserPath ?? null);
        return { browser, installed: browser === WebChatBrowser.DEFAULT || path !== null, path };
      }),
    );
    return found;
  }

  private async exists(path: string): Promise<boolean> {
    const result = await this.fs.exists(path);
    return result.ok && result.value;
  }

  private candidates(browser: Browser): readonly string[] {
    const roots = [this.env.ProgramFiles, this.env['ProgramFiles(x86)'], this.env.LOCALAPPDATA].filter(
      (value): value is string => value !== undefined,
    );
    if (browser === WebChatBrowser.COCCOC)
      return roots.map((root) => join(root, 'CocCoc', 'Browser', 'Application', 'browser.exe'));
    if (browser === WebChatBrowser.CHROME)
      return roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (browser === WebChatBrowser.EDGE)
      return [this.env['ProgramFiles(x86)'], this.env.ProgramFiles]
        .filter((value): value is string => value !== undefined)
        .map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (browser === WebChatBrowser.FIREFOX)
      return [this.env.ProgramFiles, this.env['ProgramFiles(x86)']]
        .filter((value): value is string => value !== undefined)
        .map((root) => join(root, 'Mozilla Firefox', 'firefox.exe'));
    return [];
  }
}
