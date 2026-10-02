import { describe, expect, it } from 'vitest';
import { estimateTokens } from './token-estimate.js';

describe('estimateTokens', () => {
  it('uses four Latin characters per token, including Vietnamese diacritics', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('Tiếng Việt')).toBe(3);
  });
  it('counts CJK code points individually', () => {
    expect(estimateTokens('中文日本語한글')).toBe(7);
    expect(estimateTokens('a中文')).toBe(3);
  });
  it('returns zero for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
