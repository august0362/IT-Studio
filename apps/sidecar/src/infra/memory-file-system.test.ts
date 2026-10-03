import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileSystemContract } from './__contract__/file-system-contract.js';
import { MemoryFileSystem } from './memory-file-system.js';

fileSystemContract('MemoryFileSystem', async () => {
  const fs = new MemoryFileSystem();
  const root = resolve(process.cwd(), 'memory-file-system-contract');
  await fs.mkdir(root, true);
  return { fs, root, cleanup: () => Promise.resolve() };
});

describe('MemoryFileSystem', () => {
  it('does not create missing parents as a side effect of writeFile or rename', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'memory-file-system-strict');
    await fs.mkdir(root, true);
    const write = await fs.writeFile(`${root}/new/deep.txt`, 'contents');
    await fs.writeFile(`${root}/source.txt`, 'contents');
    const rename = await fs.rename(`${root}/source.txt`, `${root}/new/moved.txt`);
    expect(write.ok).toBe(false);
    expect(rename.ok).toBe(false);
    expect(await fs.exists(`${root}/new`)).toEqual({ ok: true, value: false });
  });

  it('does not follow a symlink when removing an empty directory', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'memory-file-system-symlink');
    const target = `${root}/target`;
    const link = `${root}/link`;
    await fs.mkdir(target, true);
    fs.addSymlink(link, target);
    expect(await fs.rmdirIfEmpty(link)).toEqual({ ok: true, value: false });
    expect(await fs.exists(target)).toEqual({ ok: true, value: true });
  });
});
