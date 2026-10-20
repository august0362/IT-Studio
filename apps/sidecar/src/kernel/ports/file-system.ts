import type { Result } from '@itstudio/schemas';

export interface FileStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly size: number;
}

export interface IFileSystem {
  readFile(path: string): Promise<Result<Uint8Array>>;
  writeFile(path: string, data: string | Uint8Array): Promise<Result<void>>;
  rename(from: string, to: string): Promise<Result<void>>;
  unlink(path: string): Promise<Result<void>>;
  mkdir(path: string, recursive: boolean): Promise<Result<void>>;
  rmdirIfEmpty(path: string): Promise<Result<boolean>>;
  stat(path: string): Promise<Result<FileStat>>;
  realpath(path: string): Promise<Result<string>>;
  exists(path: string): Promise<Result<boolean>>;
  readdir(path: string): Promise<Result<readonly string[]>>;
  copyFile(from: string, to: string): Promise<Result<void>>;
  fsync(path: string): Promise<Result<void>>;
}
