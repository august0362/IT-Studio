type Provider = 'openai' | 'anthropic' | 'google' | 'groq';

const DEFAULT_PROVIDERS: readonly Provider[] = ['openai', 'anthropic', 'google'];

export async function ensureProviderKeys(
  providers: readonly Provider[] = DEFAULT_PROVIDERS,
  session = browser,
): Promise<void> {
  await session.$('nav[aria-label="Main navigation"] a[href="#settings-api-keys"]').click();
  for (const provider of providers) {
    const input = session.$(`#api-key-${provider}`);
    await input.setValue(`sk-TEST-e2e-${provider}-${String(Date.now())}`);
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
      async () => (await session.$(`[aria-label="${providerName} key status"]`).getText()).includes('Set'),
      { timeout: 10_000, timeoutMsg: `The ${providerName} E2E key was not saved` },
    );
  }
}
