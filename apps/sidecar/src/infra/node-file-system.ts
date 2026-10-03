import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import type { AppError, Result } from '@itstudio/schemas';
import type { FileStat, IFileSystem } from '../ports/file-system.js';

function failure(operation: string): Result<never> {
  const error: AppError = {
    code: 'INTERNAL',
    message: `File system operation failed: ${operation}.`,
    remediation: ['Check that the workspace path exists and is accessible, then retry.'],
    retryable: false,
  };
  return { ok: false, error };
}

function statValue(info: Stats): FileStat {
  return {
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
    isSymbolicLink: info.isSymbolicLink(),
    size: info.size,
  };
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

export class NodeFileSystem implements IFileSystem {
  async readFile(path: string): Promise<Result<Uint8Array>> {
    try {
      return { ok: true, value: await readFile(path) };
    } catch {
      return failure('read');
    }
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<Result<void>> {
    try {
      await writeFile(path, data);
      return { ok: true, value: undefined };
    } catch {
      return failure('write');
    }
  }

  async rename(from: string, to: string): Promise<Result<void>> {
    try {
      await rename(from, to);
      return { ok: true, value: undefined };
    } catch {
      return failure('rename');
    }
  }

  async unlink(path: string): Promise<Result<void>> {
    try {
      await unlink(path);
      return { ok: true, value: undefined };
    } catch {
      return failure('remove');
    }
  }

  async mkdir(path: string, recursive: boolean): Promise<Result<void>> {
    try {
      await mkdir(path, { recursive });
      return { ok: true, value: undefined };
    } catch {
      return failure('create directory');
    }
  }

  async rmdirIfEmpty(path: string): Promise<Result<boolean>> {
    try {
      await rmdir(path);
      return { ok: true, value: true };
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY'))
        return { ok: true, value: false };
      return failure('remove empty directory');
    }
  }

  async stat(path: string): Promise<Result<FileStat>> {
    try {
      return { ok: true, value: statValue(await stat(path)) };
    } catch {
      return failure('stat');
    }
  }

  async realpath(path: string): Promise<Result<string>> {
    try {
      return { ok: true, value: await realpath(path) };
    } catch {
      return failure('resolve path');
    }
  }

  async exists(path: string): Promise<Result<boolean>> {
    try {
      await access(path, constants.F_OK);
      return { ok: true, value: true };
    } catch (error: unknown) {
      return isMissingPath(error) ? { ok: true, value: false } : failure('check existence');
    }
  }

  async readdir(path: string): Promise<Result<readonly string[]>> {
    try {
      return { ok: true, value: await readdir(path) };
    } catch {
      return failure('list directory');
    }
  }

  async copyFile(from: string, to: string): Promise<Result<void>> {
    try {
      await copyFile(from, to);
      return { ok: true, value: undefined };
    } catch {
      return failure('copy');
    }
  }

  async fsync(path: string): Promise<Result<void>> {
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(path, 'r+');
      await handle.sync();
      return { ok: true, value: undefined };
    } catch {
      return failure('sync');
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}
