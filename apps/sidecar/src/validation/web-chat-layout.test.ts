import { describe, expect, it } from 'vitest';
import { webChatLayoutSchema, webChatSettingsSchema } from './settings.js';
import { DEFAULT_WEB_CHAT_SETTINGS } from '../domain/web-chat.js';

describe('web-chat layout validation', () => {
  it('accepts legacy settings and one-to-four persisted panes', () => {
    expect(webChatSettingsSchema.safeParse(DEFAULT_WEB_CHAT_SETTINGS).success).toBe(true);
    for (let count = 1; count <= 4; count += 1) {
      const layout = {
        panes: DEFAULT_WEB_CHAT_SETTINGS.links.slice(0, count).map((link) => link.id),
        sizes: Array.from({ length: count }, () => 1 / count),
      };
      expect(webChatSettingsSchema.safeParse({ ...DEFAULT_WEB_CHAT_SETTINGS, layout }).success).toBe(true);
    }
  });
  it.each([
    { panes: [], sizes: [] },
    { panes: ['chatgpt', 'gemini', 'grok', 'claude', 'perplexity'], sizes: [0.2, 0.2, 0.2, 0.2, 0.2] },
    { panes: ['chatgpt', 'gemini'], sizes: [1] },
    { panes: ['chatgpt', 'gemini'], sizes: [0.05, 0.95] },
    { panes: ['chatgpt', 'gemini'], sizes: [0.3, 0.3] },
    { panes: ['chatgpt'], sizes: [Number.NaN] },
    { panes: ['chatgpt'], sizes: [Number.POSITIVE_INFINITY] },
  ])('rejects invalid pane counts and sizes: %j', (layout) => {
    expect(webChatLayoutSchema.safeParse(layout).success).toBe(false);
  });
  it('rejects pane ids that are not enabled saved links', () => {
    expect(
      webChatSettingsSchema.safeParse({ ...DEFAULT_WEB_CHAT_SETTINGS, layout: { panes: ['missing'], sizes: [1] } })
        .success,
    ).toBe(false);
    expect(
      webChatSettingsSchema.safeParse({
        ...DEFAULT_WEB_CHAT_SETTINGS,
        links: DEFAULT_WEB_CHAT_SETTINGS.links.map((link) => ({ ...link, enabled: false })),
        layout: { panes: ['chatgpt'], sizes: [1] },
      }).success,
    ).toBe(false);
  });
});

it('WC-02 accepts forty saved links and rejects forty-one', () => {
  const links = Array.from({ length: 41 }, (_, index) => ({
    ...DEFAULT_WEB_CHAT_SETTINGS.links[0],
    id: `link-${String(index)}`,
    name: 'Chat',
    url: 'https://example.com/',
    enabled: true,
  }));
  expect(webChatSettingsSchema.safeParse({ ...DEFAULT_WEB_CHAT_SETTINGS, links: links.slice(0, 40) }).success).toBe(
    true,
  );
  expect(webChatSettingsSchema.safeParse({ ...DEFAULT_WEB_CHAT_SETTINGS, links }).success).toBe(false);
});
