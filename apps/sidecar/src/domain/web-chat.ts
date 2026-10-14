import { isIP } from 'node:net';
import { Buffer } from 'node:buffer';
import { isAbsolute } from 'node:path';
import {
  WebChatBrowser,
  type WebChatLink,
  type WebChatLinkId,
  type WebChatSettings,
  type WebChatLayout,
} from '@itstudio/schemas';

export const DEFAULT_WEB_CHAT_LINKS: readonly WebChatLink[] = [
  { id: 'chatgpt' as WebChatLinkId, name: 'ChatGPT', url: 'https://chatgpt.com/', enabled: true },
  { id: 'gemini' as WebChatLinkId, name: 'Gemini', url: 'https://gemini.google.com/app', enabled: true },
  { id: 'grok' as WebChatLinkId, name: 'Grok', url: 'https://grok.com/', enabled: true },
  { id: 'claude' as WebChatLinkId, name: 'Claude', url: 'https://claude.ai/new', enabled: true },
  {
    id: 'google-ai-studio' as WebChatLinkId,
    name: 'Google AI Studio',
    url: 'https://aistudio.google.com/',
    enabled: true,
  },
  { id: 'perplexity' as WebChatLinkId, name: 'Perplexity', url: 'https://www.perplexity.ai/', enabled: true },
];

export const DEFAULT_WEB_CHAT_SETTINGS: WebChatSettings = {
  browser: WebChatBrowser.DEFAULT,
  customBrowserPath: null,
  links: DEFAULT_WEB_CHAT_LINKS,
};

export interface WebChatIssue {
  readonly path: string;
  readonly message: string;
}

export function validateWebChatSettings(
  value: Pick<WebChatSettings, 'browser' | 'customBrowserPath' | 'layout'> & {
    readonly links: readonly {
      readonly id: string;
      readonly name: string;
      readonly url: string;
      readonly enabled?: boolean;
    }[];
  },
): readonly WebChatIssue[] {
  const issues: WebChatIssue[] = [];
  if (value.links.length > 20) issues.push({ path: 'webChat.links', message: 'Must contain at most 20 links.' });
  const ids = new Set<string>();
  value.links.forEach((link, index) => {
    const prefix = `webChat.links.${String(index)}`;
    if (link.name.trim().length < 1 || link.name.length > 40)
      issues.push({ path: `${prefix}.name`, message: 'Name must be 1 to 40 characters.' });
    if (ids.has(link.id)) issues.push({ path: `${prefix}.id`, message: 'Link ids must be unique.' });
    ids.add(link.id);
    if (!isAllowedWebChatUrl(link.url))
      issues.push({
        path: `${prefix}.url`,
        message:
          'Enter a valid HTTPS URL without credentials or a local/IP host (maximum 2,048 UTF-8 bytes after URL normalization).',
      });
  });
  if (value.layout !== undefined) {
    const enabledIds = new Set(value.links.filter((link) => link.enabled !== false).map((link) => link.id));
    value.layout.panes.forEach((id, index) => {
      if (!enabledIds.has(id))
        issues.push({
          path: `webChat.layout.panes.${String(index)}`,
          message: 'Select an enabled saved web-chat link.',
        });
    });
  }
  if (value.browser === WebChatBrowser.CUSTOM && value.customBrowserPath === null)
    issues.push({ path: 'webChat.customBrowserPath', message: 'Choose a browser executable path.' });
  if (
    value.browser === WebChatBrowser.CUSTOM &&
    value.customBrowserPath !== null &&
    (!isAbsolute(value.customBrowserPath) || !value.customBrowserPath.toLocaleLowerCase('en-US').endsWith('.exe'))
  )
    issues.push({ path: 'webChat.customBrowserPath', message: 'Path must be absolute and end with .exe.' });
  return issues;
}

export function reconcileWebChatLayout(
  layout: WebChatLayout | undefined,
  links: readonly WebChatLink[],
): WebChatLayout | undefined {
  if (layout === undefined) return undefined;
  const enabled = new Set(links.filter((link) => link.enabled).map((link) => link.id));
  const remaining = layout.panes
    .map((id, index) => ({ id, size: layout.sizes[index] ?? 1 }))
    .filter(({ id }) => enabled.has(id));
  if (remaining.length === 0) return undefined;
  const total = remaining.reduce((sum, { size }) => sum + size, 0);
  return { panes: remaining.map(({ id }) => id), sizes: remaining.map(({ size }) => size / total) };
}

export function isAllowedWebChatUrl(value: string): boolean {
  if (value.length === 0 || Buffer.byteLength(value, 'utf8') > 2048) return false;
  try {
    const url = new URL(value);
    if (Buffer.byteLength(url.href, 'utf8') > 2048) return false;
    const hostname = url.hostname
      .replace(/^\[|\]$/gu, '')
      .replace(/\.+$/u, '')
      .toLocaleLowerCase('en-US');
    const validLabels = hostname
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label) && label.length <= 63);
    const localHost =
      !hostname.includes('.') ||
      hostname === 'localhost' ||
      ['.localhost', '.local', '.internal', '.lan', '.home.arpa'].some((suffix) => hostname.endsWith(suffix));
    return (
      url.protocol === 'https:' &&
      !/[\s\p{Cc}]/u.test(value) &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      hostname.length > 0 &&
      hostname.length <= 253 &&
      validLabels &&
      !localHost &&
      isIP(hostname) === 0
    );
  } catch {
    return false;
  }
}
