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
    ['https://localhost.', false],
    ['https://intranet', false],
    ['https://printer.local', false],
    ['https://host.internal', false],
    ['https://host.lan', false],
    ['https://host.home.arpa', false],
    ['https://host.local.', false],
    ['https://[::1]', false],
    ['https://2130706433', false],
    ['https://0x7f000001', false],
    ['https://example.com.', true],
    ['https://example.com/\u0000', false],
    ['https://example..com', false],
    ['https://example.com/\n', false],
    ['https://example.com/'.padEnd(2048, 'a'), true],
    ['https://example.com/'.padEnd(2049, 'a'), false],
  ])('validates %s', (url, expected) => {
    expect(isAllowedWebChatUrl(url)).toBe(expected);
  });

  it('uses UTF-8 bytes for both raw and normalized Unicode URL boundaries', () => {
    const prefix = 'https://example.com/';
    const accepted = `${prefix}${'é'.repeat(338)}`;
    expect(Buffer.byteLength(new URL(accepted).href, 'utf8')).toBe(2048);
    expect(isAllowedWebChatUrl(accepted)).toBe(true);
    expect(isAllowedWebChatUrl(new URL(accepted).href)).toBe(true);
    expect(isAllowedWebChatUrl(`${accepted}a`)).toBe(false);
    const rawTooLong = `${prefix}${'é'.repeat(1025)}`;
    expect(rawTooLong.length).toBeLessThan(2048);
    expect(Buffer.byteLength(rawTooLong, 'utf8')).toBeGreaterThan(2048);
    expect(isAllowedWebChatUrl(rawTooLong)).toBe(false);
  });
  it('ships stable defaults and reports duplicate ids and link limits', () => {
    expect(DEFAULT_WEB_CHAT_LINKS.map((link) => link.id)).toEqual([
      'chatgpt',
      'gemini',
      'grok',
      'claude',
      'google-ai-studio',
      'perplexity',
      'deepseek',
      'qwen',
      'mistral-le-chat',
      'copilot',
      'kimi',
      'meta-ai',
      'poe',
      'huggingchat',
      'zai',
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

describe('WC-02 presets', () => {
  it('ships all nine enabled URLs and accepts every preset', () => {
    expect(DEFAULT_WEB_CHAT_LINKS.slice(6).map(({ id, name, url, enabled }) => [id, name, url, enabled])).toEqual([
      ['deepseek', 'DeepSeek', 'https://chat.deepseek.com/', true],
      ['qwen', 'Qwen Chat', 'https://chat.qwen.ai/', true],
      ['mistral-le-chat', 'Le Chat (Mistral)', 'https://chat.mistral.ai/chat', true],
      ['copilot', 'Microsoft Copilot', 'https://copilot.microsoft.com/', true],
      ['kimi', 'Kimi', 'https://www.kimi.com/', true],
      ['meta-ai', 'Meta AI', 'https://www.meta.ai/', true],
      ['poe', 'Poe', 'https://poe.com/', true],
      ['huggingchat', 'HuggingChat', 'https://huggingface.co/chat/', true],
      ['zai', 'Z.ai (GLM)', 'https://chat.z.ai/', true],
    ]);
    expect(DEFAULT_WEB_CHAT_LINKS.every((link) => isAllowedWebChatUrl(link.url))).toBe(true);
  });
  it('accepts 40 links and rejects 41', () => {
    const links = Array.from({ length: 41 }, (_, index) => ({
      id: String(index),
      name: 'Chat',
      url: 'https://example.com/',
    }));
    expect(validateWebChatSettings({ browser: 'default', customBrowserPath: null, links: links.slice(0, 40) })).toEqual(
      [],
    );
    expect(validateWebChatSettings({ browser: 'default', customBrowserPath: null, links })).toEqual([
      { path: 'webChat.links', message: 'Must contain at most 40 links.' },
    ]);
  });
});
