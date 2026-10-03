import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import type * as Keyring from '@napi-rs/keyring';
import type * as LanceDb from '@lancedb/lancedb';

const bundledResources = join(dirname(process.execPath), 'resources');

export const isSea = (): boolean => {
  try {
    const sea: unknown = createRequire(process.execPath)('node:sea');
    return isSeaApi(sea) && sea.isSea();
  } catch {
    return false;
  }
};

export function resourcePath(...parts: readonly string[]): string {
  if (isSea()) return join(bundledResources, ...parts);
  return join(resolve(process.cwd()), ...parts);
}

function packageRequire(packageName: string, nativeFile: string): unknown {
  if (!isSea()) return createRequire(join(process.cwd(), 'package.json'))(packageName) as unknown;
  const packageRoot = join(bundledResources, 'node_modules');
  const requireFromResources = createRequire(join(bundledResources, 'loader.cjs'));
  const nativePath = join(packageRoot, nativeFile);
  if (!existsSync(nativePath)) throw new Error(`Missing native module file: ${nativePath}`);
  process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath;
  try {
    return requireFromResources(packageName) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown native loader error';
    throw new Error(`Failed to load native module file ${nativePath}: ${detail}`, { cause: error });
  }
}

export function loadBetterSqlite3(): typeof Database {
  return packageRequire('better-sqlite3', 'better-sqlite3/prebuilds/win32-x64.node') as typeof Database;
}

export function loadKeyring(): typeof Keyring {
  return packageRequire(
    '@napi-rs/keyring',
    '@napi-rs/keyring-win32-x64-msvc/keyring.win32-x64-msvc.node',
  ) as typeof Keyring;
}

export function loadLanceDb(): typeof LanceDb {
  return packageRequire(
    '@lancedb/lancedb',
    '@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node',
  ) as typeof LanceDb;
}

export function verifyNativeModules(): void {
  loadBetterSqlite3();
  loadKeyring();
  loadLanceDb();
}

function isSeaApi(value: unknown): value is { isSea: () => boolean } {
  return typeof value === 'object' && value !== null && 'isSea' in value && typeof value.isSea === 'function';
}
