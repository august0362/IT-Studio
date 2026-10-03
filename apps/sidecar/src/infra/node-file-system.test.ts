import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileSystemContract } from './__contract__/file-system-contract.js';
import { NodeFileSystem } from './node-file-system.js';

fileSystemContract('NodeFileSystem', async () => {
  const root = await mkdtemp(join(tmpdir(), 'itstudio-fs-contract-'));
  return { fs: new NodeFileSystem(), root, cleanup: async () => rm(root, { recursive: true, force: true }) };
});

describe('NodeFileSystem', () => {
  let directory: string | undefined;
  const fs = new NodeFileSystem();

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('implements file operations through Results', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-fs-'));
    const source = join(directory, 'source.txt');
    const copied = join(directory, 'copy.txt');
    const renamed = join(directory, 'renamed.txt');
    expect((await fs.mkdir(join(directory, 'nested'), false)).ok).toBe(true);
    expect(await fs.writeFile(source, 'hello')).toEqual({ ok: true, value: undefined });
    const read = await fs.readFile(source);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe('hello');
    expect(await fs.copyFile(source, copied)).toMatchObject({ ok: true });
    expect(await fs.rename(copied, renamed)).toMatchObject({ ok: true });
    expect(await fs.stat(renamed)).toMatchObject({ ok: true, value: { isFile: true, isDirectory: false } });
    expect(await fs.exists(renamed)).toEqual({ ok: true, value: true });
    const entries = await fs.readdir(directory);
    expect(entries.ok).toBe(true);
    if (entries.ok) {
      expect(entries.value.includes('source.txt')).toBe(true);
      expect(entries.value.includes('renamed.txt')).toBe(true);
      expect(entries.value.includes('nested')).toBe(true);
    }
    expect(await fs.realpath(directory)).toMatchObject({ ok: true });
    expect(await fs.fsync(renamed)).toMatchObject({ ok: true });
    expect(await fs.unlink(renamed)).toMatchObject({ ok: true });
    expect(await fs.exists(renamed)).toEqual({ ok: true, value: false });
  });

  it('returns safe errors for failed operations', async () => {
    directory = await mkdtemp(join(tmpdir(), 'itstudio-fs-'));
    const missing = join(directory, 'missing.txt');
    const read = await fs.readFile(missing);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.error.code).toBe('INTERNAL');
      expect(read.error.remediation?.length).toBeGreaterThan(0);
    }
    expect(await fs.rename(missing, join(directory, 'target'))).toMatchObject({ ok: false });
    expect(await fs.unlink(missing)).toMatchObject({ ok: false });
    expect(await fs.stat(missing)).toMatchObject({ ok: false });
    expect(await fs.readdir(missing)).toMatchObject({ ok: false });
    expect(await fs.copyFile(missing, join(directory, 'target'))).toMatchObject({ ok: false });
    expect(await fs.fsync(missing)).toMatchObject({ ok: false });
    expect(await fs.exists('\0')).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
  });
});
