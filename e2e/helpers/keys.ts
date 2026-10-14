import { resetLocaleToEnglish } from './ui.js';

type Provider = 'openai' | 'anthropic' | 'google' | 'groq';

const DEFAULT_PROVIDERS: readonly Provider[] = ['openai', 'anthropic', 'google', 'groq'];

export async function ensureProviderKeys(
  providers: readonly Provider[] = DEFAULT_PROVIDERS,
  session = browser,
): Promise<void> {
  await resetLocaleToEnglish(session);
  await session.$('nav a[href="#settings-api-keys"]').click();
  for (const provider of providers) {
    const input = session.$(`#api-key-${provider}`);
    const secret = `sk-TEST-e2e-${provider}-${String(Date.now())}`;
    await input.setValue(secret);
    await session.$(`form:has(#api-key-${provider}) button[type="submit"]`).click();
    const providerName =
      provider === 'openai'
        ? 'OpenAI'
        : provider === 'anthropic'
          ? 'Anthropic'
          : provider === 'google'
            ? 'Google'
            : 'Groq';
    await session.waitUntil(
      async () =>
        (await input.getValue()) === '' &&
        (await session.$(`[aria-label="${providerName} key status"]`).getText()).includes(
          `Verified · …${secret.slice(-4)}`,
        ),
      { timeout: 10_000, timeoutMsg: `The ${providerName} E2E key was not verified and saved` },
    );
  }
}
