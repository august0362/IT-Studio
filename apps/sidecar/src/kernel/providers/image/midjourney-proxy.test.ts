import { describe, expect, it } from 'vitest';
import { ErrorCode } from '@itstudio/schemas';
import { MidjourneyProxyProvider } from './midjourney-proxy.js';

describe('MidjourneyProxyProvider', () => {
  it('is disabled with a validation error that requires an ADR and user consent', async () => {
    const result = await new MidjourneyProxyProvider().generate();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected the adapter to be disabled.');
    expect(result.error).toMatchObject({ code: ErrorCode.VALIDATION });
    expect(result.error.message).toContain('ADR and user consent');
  });
});
