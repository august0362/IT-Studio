import { describe, expect, it } from 'vitest';
import { ProviderId } from '@itstudio/schemas';
import type {} from '../vitest.config';
import type {} from '../../../vitest.config';
import { describeSidecar } from './main';

describe('describeSidecar', () => {
  it('includes the number of supported providers', () => {
    const providerCount = Object.keys(ProviderId).length;

    expect(describeSidecar()).toContain(`providers=${String(providerCount)}`);
  });
});
