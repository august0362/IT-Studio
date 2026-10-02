import { describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import { discoverFiles } from './discover-files.js';

describe('discoverFiles', () => {
  it('TC-M5-033 skips ignored folders and deduplicates selected paths', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'rag-discovery');
    await fs.mkdir(resolve(root, 'src'), true);
    for (const directory of ['.git', 'node_modules', '.itstudio', 'dist', 'build', 'target'])
      await fs.mkdir(resolve(root, directory), true);
    await fs.writeFile(resolve(root, 'b.md'), '# B');
    await fs.writeFile(resolve(root, 'src', 'a.ts'), 'export const a = 1;');
    for (const directory of ['.git', 'node_modules', '.itstudio', 'dist', 'build', 'target'])
      await fs.writeFile(resolve(root, directory, 'ignored.js'), 'ignored');
    const result = await discoverFiles(root, [root, resolve(root, 'b.md')], fs);
    expect(result).toEqual({ ok: true, value: [resolve(root, 'b.md'), resolve(root, 'src', 'a.ts')] });
  });

  it('accepts exactly 20 MB and rejects larger files', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'rag-size');
    await fs.mkdir(root, true);
    await fs.writeFile(resolve(root, 'limit.txt'), new Uint8Array(20 * 1024 * 1024));
    await fs.writeFile(resolve(root, 'large.txt'), new Uint8Array(20 * 1024 * 1024 + 1));
    const result = await discoverFiles(root, [root], fs);
    expect(result).toEqual({ ok: true, value: [resolve(root, 'limit.txt')] });
  });

  it('rejects a path outside the workspace', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'rag-root');
    const outside = resolve(process.cwd(), 'outside.txt');
    await fs.writeFile(outside, 'outside');
    const result = await discoverFiles(root, [outside], fs);
    expect(result.ok).toBe(false);
  });

  it('ignores unsupported files and already visited directories', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'rag-repeat');
    const nested = resolve(root, 'nested');
    await fs.mkdir(nested, true);
    await fs.writeFile(resolve(nested, 'valid.md'), '# valid');
    await fs.writeFile(resolve(root, 'unsupported.bin'), 'binary');
    const result = await discoverFiles(root, [root, nested], fs);
    expect(result).toEqual({ ok: true, value: [resolve(nested, 'valid.md')] });
  });

  it('TC-M5-033 does not follow symlinks and terminates on a symlink loop', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'rag-links');
    await fs.mkdir(root, true);
    const link = resolve(root, 'linked.md');
    fs.addSymlink(link, resolve(root, 'missing.md'));
    fs.addSymlink(resolve(root, 'loop'), root);
    vi.spyOn(fs, 'stat').mockResolvedValueOnce({
      ok: true,
      value: { isFile: false, isDirectory: false, isSymbolicLink: true, size: 0 },
    });
    expect(await discoverFiles(root, [link], fs)).toEqual({ ok: true, value: [] });

    fs.clearFailureInjection();
    fs.injectFailureAtInvocation(3);
    expect((await discoverFiles(root, [root], fs)).ok).toBe(false);
  });

  it('propagates a failure while inspecting the selected path', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'rag-stat-failure');
    await fs.mkdir(root, true);
    fs.injectFailureAtInvocation(1);
    expect((await discoverFiles(root, [root], fs)).ok).toBe(false);
  });
});
