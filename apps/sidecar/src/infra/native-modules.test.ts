import { describe, expect, it } from 'vitest';
import { isSea, loadBetterSqlite3, loadKeyring, loadLanceDb, resourcePath } from './native-modules.js';

describe('native module loading', () => {
  it('uses normal package resolution in development', () => {
    expect(isSea()).toBe(false);
    expect(typeof loadBetterSqlite3()).toBe('function');
    expect(typeof loadKeyring().AsyncEntry).toBe('function');
    expect(typeof loadLanceDb().connect).toBe('function');
  });

  it('resolves development resources from the repository root', () => {
    expect(resourcePath('config', 'models.seed.json')).toContain('config');
  });
});
