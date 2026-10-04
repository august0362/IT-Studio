import { describe, expect, it } from 'vitest';
import { DEFAULT_WEB_CHAT_LINKS, isAllowedWebChatUrl, validateWebChatSettings } from './web-chat.js';

describe('web chat domain rules', () => {
  it.each([
    ['https://example.com', true],
    ['', false],
    ['http://example.com', false],
    ['javascript:alert(1)', false],
    ['file:///etc/passwd', false],
    ['https://', false],
    ['https://127.0.0.1', false],
    ['https://user@example.com', false],
    ['https://:secret@example.com', false],
    ['https://localhost', false],
    ['https://chat.localhost', false],
    ['https://example..com', false],
    ['https://example.com/\n', false],
    ['https://example.com/'.padEnd(2048, 'a'), true],
    ['https://example.com/'.padEnd(2049, 'a'), false],
  ])('validates %s', (url, expected) => {
    expect(isAllowedWebChatUrl(url)).toBe(expected);
  });
  it('ships stable defaults and reports duplicate ids and link limits', () => {
    expect(DEFAULT_WEB_CHAT_LINKS.map((link) => link.id)).toEqual([
      'chatgpt',
      'gemini',
      'grok',
      'claude',
      'google-ai-studio',
      'perplexity',
    ]);
    const issues = validateWebChatSettings({
      browser: 'default',
      customBrowserPath: null,
      links: [
        ...DEFAULT_WEB_CHAT_LINKS,
        ...DEFAULT_WEB_CHAT_LINKS,
        ...DEFAULT_WEB_CHAT_LINKS,
        ...DEFAULT_WEB_CHAT_LINKS,
      ],
    });
    expect(issues.map((issue) => issue.path)).toContain('webChat.links');
    expect(issues.some((issue) => issue.path.endsWith('.id'))).toBe(true);
  });

  it('validates names and custom browser paths with field-specific issues', () => {
    const link = { id: 'one', name: ' ', url: 'http://example.com' };
    expect(
      validateWebChatSettings({ browser: 'default', customBrowserPath: null, links: [link] }).map(
        (issue) => issue.path,
      ),
    ).toEqual(['webChat.links.0.name', 'webChat.links.0.url']);
    expect(
      validateWebChatSettings({ browser: 'custom', customBrowserPath: null, links: [] }).map((issue) => issue.path),
    ).toEqual(['webChat.customBrowserPath']);
    expect(
      validateWebChatSettings({ browser: 'custom', customBrowserPath: 'relative.exe', links: [] }).map(
        (issue) => issue.path,
      ),
    ).toEqual(['webChat.customBrowserPath']);
    expect(validateWebChatSettings({ browser: 'custom', customBrowserPath: 'C:\\Browser.exe', links: [] })).toEqual([]);
    expect(
      validateWebChatSettings({
        browser: 'default',
        customBrowserPath: null,
        links: [{ id: 'long-name', name: 'x'.repeat(41), url: 'https://example.com' }],
      }).map((issue) => issue.path),
    ).toEqual(['webChat.links.0.name']);
  });
});
