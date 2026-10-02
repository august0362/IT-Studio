import { describe, expect, it } from 'vitest';
import { chunkDocument } from './chunker.js';
import type { ChunkingConfig, DocumentFormat } from '@itstudio/schemas';

const config: ChunkingConfig = { targetTokens: 20, overlapTokens: 4, respectHeadings: true };
const chunk = (text: string, format: DocumentFormat = 'markdown', settings = config) =>
  chunkDocument({ text, format, config: settings });

describe('chunkDocument', () => {
  it('tracks nested heading paths', () => {
    expect(chunk('# Main\n\n## Sub\n\nbody')[0]?.sectionPath).toEqual(['Main', 'Sub']);
  });
  it('does not split an ordinary fenced block', () => {
    const source = `\`\`\`ts\n${'const x = 1;\n'.repeat(40)}\`\`\``;
    const result = chunk(source, 'markdown', { ...config, targetTokens: 500 });
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('```ts');
    expect(result[0]?.text).toContain('```');
  });
  it('splits code by symbol and retains line boundaries', () => {
    const result = chunk('function alpha() {\n  return 1;\n}\nfunction beta() {\n  return 2;\n}', 'code');
    expect(result.map((item) => item.sectionPath)).toEqual([['alpha'], ['beta']]);
    expect(result.every((item) => !item.text.includes('return'))).toBe(false);
    expect(result.every((item) => item.text.split('\n').every((line) => line.length > 0))).toBe(true);
  });
  it('uses line windows for code without declarations and leaves long lines whole', () => {
    const source = `${'x'.repeat(100)}\nsecond line\nthird line`;
    const result = chunk(source, 'code', { targetTokens: 4, overlapTokens: 0, respectHeadings: false });
    expect(result[0]?.text).toBe('x'.repeat(100));
    expect(result.every((item) => !item.text.includes('\n'))).toBe(true);
  });
  it('hard wraps an oversized prose sentence and honors disabled headings', () => {
    const settings = { targetTokens: 3, overlapTokens: 0, respectHeadings: false };
    const result = chunk('# Heading\n\nabcdefghijklmno.', 'markdown', settings);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((item) => item.sectionPath.length === 0)).toBe(true);
  });
  it('splits an oversized fenced block by lines and handles an unclosed fence', () => {
    const result = chunk(`\`\`\`\n${'line\n'.repeat(30)}\`\`\``, 'markdown', {
      targetTokens: 4,
      overlapTokens: 0,
      respectHeadings: false,
    });
    expect(result.length).toBeGreaterThan(1);
    expect(chunk('```\ninside', 'markdown')).toHaveLength(1);
  });
  it('returns contiguous ordinals and deterministic results for empty and repeated input', () => {
    expect(chunk('  ')).toEqual([]);
    const source = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
    const a = chunk(source, 'text');
    expect(chunk(source, 'text')).toEqual(a);
    expect(a.map((item) => item.ordinal)).toEqual(a.map((_, index) => index));
  });
  it('adds sentence aligned overlap within sections', () => {
    const result = chunk('First sentence. '.repeat(14), 'text');
    expect(result.length).toBeGreaterThan(1);
    expect(result[1]?.text).toMatch(/sentence\./);
    expect(result[1]?.tokenCount).toBeLessThanOrEqual(config.targetTokens + config.overlapTokens + 5);
  });
  it('preserves source content ordering across chunks', () => {
    const source = 'alpha one. beta two. gamma three. delta four. epsilon five.';
    const result = chunk(source, 'text', { ...config, overlapTokens: 0 });
    const reconstructed = result
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ');
    let cursor = 0;
    for (const word of source.split(/\s+/)) {
      cursor = reconstructed.indexOf(word, cursor);
      expect(cursor).toBeGreaterThanOrEqual(0);
      cursor += word.length;
    }
  });
  it('chunks a generated 5 MB markdown document within one second', () => {
    const source = `# Bulk\n\n${'A generated paragraph with enough words to create predictable chunks.\n\n'.repeat(75000)}`;
    const start = performance.now();
    expect(chunk(source).length).toBeGreaterThan(1000);
    expect(performance.now() - start).toBeLessThan(1000);
  }, 5000);
});
