import { describe, expect, it } from 'vitest';
import type { IFileSystem } from '../../ports/file-system.js';

export interface FileSystemContractFixture {
  readonly fs: IFileSystem;
  readonly root: string;
  readonly cleanup: () => Promise<void>;
}

export function fileSystemContract(name: string, fixture: () => Promise<FileSystemContractFixture>): void {
  describe(`${name} file-system contract`, () => {
    it('requires existing parent directories for writes and rename destinations', async () => {
      const { fs, root, cleanup } = await fixture();
      try {
        const write = await fs.writeFile(`${root}/missing/write.txt`, 'text');
        const source = `${root}/source.txt`;
        await fs.writeFile(source, 'text');
        const move = await fs.rename(source, `${root}/missing/move.txt`);
        expect(write).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
        expect(move).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
      } finally {
        await cleanup();
      }
    });

    it('removes only empty existing directories', async () => {
      const { fs, root, cleanup } = await fixture();
      try {
        const empty = `${root}/empty`;
        const occupied = `${root}/occupied`;
        await fs.mkdir(empty, false);
        await fs.mkdir(occupied, false);
        await fs.writeFile(`${occupied}/file.txt`, 'text');
        expect(await fs.rmdirIfEmpty(`${root}/absent`)).toEqual({ ok: true, value: false });
        expect(await fs.rmdirIfEmpty(occupied)).toEqual({ ok: true, value: false });
        expect(await fs.rmdirIfEmpty(empty)).toEqual({ ok: true, value: true });
        expect(await fs.exists(empty)).toEqual({ ok: true, value: false });
      } finally {
        await cleanup();
      }
    });
  });
}
