import { ProviderId, type AppSettings } from '@itstudio/schemas';

export const OPENAI_COMPATIBLE_BASE_URLS = {
  [ProviderId.OPENAI]: 'https://api.openai.com/v1',
  [ProviderId.XAI]: 'https://api.x.ai/v1',
  [ProviderId.GROQ]: 'https://api.groq.com/openai/v1',
  [ProviderId.TOGETHER]: 'https://api.together.xyz/v1',
  [ProviderId.DEEPSEEK]: 'https://api.deepseek.com',
  [ProviderId.OPENROUTER]: 'https://openrouter.ai/api/v1',
  [ProviderId.QWEN]: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  [ProviderId.MISTRAL]: 'https://api.mistral.ai/v1',
} as const;

export function compatibleBaseUrl(provider: ProviderId, settings?: AppSettings): string | undefined {
  if (provider === ProviderId.QWEN) return settings?.providers?.qwen?.baseUrl ?? OPENAI_COMPATIBLE_BASE_URLS.qwen;
  return Object.entries(OPENAI_COMPATIBLE_BASE_URLS).find(([id]) => id === provider)?.[1];
}

export function compatibleHeaders(provider: ProviderId): Readonly<Record<string, string>> {
  return provider === ProviderId.OPENROUTER
    ? { 'HTTP-Referer': 'https://itstudio.local', 'X-OpenRouter-Title': 'IT Studio', 'X-Title': 'IT Studio' }
    : {};
}
