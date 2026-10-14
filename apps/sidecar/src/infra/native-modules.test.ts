import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  isSea,
  loadBetterSqlite3,
  loadExternal,
  loadKeyring,
  loadLanceDb,
  resourcePath,
  verifyNativeModules,
} from './native-modules.js';

describe('native module loading', () => {
  it('TC-M9-002 resolves native packages in development and verifies startup dependencies', () => {
    expect(isSea()).toBe(false);
    expect(typeof loadBetterSqlite3()).toBe('function');
    expect(typeof loadKeyring().AsyncEntry).toBe('function');
    expect(typeof loadLanceDb().connect).toBe('function');
    expect(() => {
      verifyNativeModules();
    }).not.toThrow();
  });

  it('TC-M9-002 resolves external runtime packages through the development resolver', () => {
    expect(loadExternal('better-sqlite3')).toBe(loadBetterSqlite3());
    expect(loadExternal('apache-arrow')).toHaveProperty('Schema');
  });

  it('TC-M9-002 reports the missing external package name', () => {
    expect(() => loadExternal('itstudio-missing-native-module')).toThrow(
      /Failed to load external module itstudio-missing-native-module/,
    );
  });

  it('TC-M9-002 resolves development resources from the repository root', () => {
    expect(resourcePath('config', 'models.seed.json')).toBe(join(process.cwd(), 'config', 'models.seed.json'));
  });
});
