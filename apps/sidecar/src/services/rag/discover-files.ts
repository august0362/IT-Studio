import { relative, resolve, sep } from 'node:path';
import type { AppError, Result } from '@itstudio/schemas';
import type { IFileSystem } from '../../ports/file-system.js';
import { detectFormat } from './parsers/parse-document.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.itstudio', 'dist', 'build', 'target']);

function failure(message: string): Result<never> {
  const error: AppError = {
    code: 'VALIDATION',
    message,
    retryable: false,
    remediation: ['Choose files or folders inside the project workspace and try again.'],
  };
  return { ok: false, error };
}

/** Recursively discovers supported documents. Results are absolute and sorted. */
export async function discoverFiles(
  root: string,
  requested: readonly string[],
  fileSystem: IFileSystem,
): Promise<Result<readonly string[]>> {
  const absoluteRoot = resolve(root);
  const found = new Set<string>();
  const visitedDirectories = new Set<string>();

  const walk = async (path: string): Promise<Result<void>> => {
    const stat = await fileSystem.stat(path);
    if (!stat.ok) return stat;
    if (stat.value.isSymbolicLink) return { ok: true, value: undefined };
    const real = await fileSystem.realpath(path);
    if (!real.ok || !inside(absoluteRoot, real.value) || real.value !== resolve(path))
      return { ok: true, value: undefined };
    if (stat.value.isDirectory) {
      if (visitedDirectories.has(real.value)) return { ok: true, value: undefined };
      visitedDirectories.add(real.value);
      const names = await fileSystem.readdir(path);
      if (!names.ok) return names;
      for (const name of [...names.value].sort((a, b) => a.localeCompare(b))) {
        if (IGNORED_DIRECTORIES.has(name.toLocaleLowerCase('en-US'))) continue;
        const child = await walk(resolve(path, name));
        if (!child.ok) return child;
      }
      return { ok: true, value: undefined };
    }
    if (stat.value.isFile && stat.value.size <= MAX_FILE_BYTES && detectFormat(path).ok) found.add(resolve(path));
    return { ok: true, value: undefined };
  };

  for (const path of requested) {
    const candidate = resolve(path);
    if (!inside(absoluteRoot, candidate)) return failure('A selected path is outside the project workspace.');
    const walked = await walk(candidate);
    if (!walked.ok) return walked;
  }
  return { ok: true, value: [...found].sort((a, b) => a.localeCompare(b)) };
}

function inside(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}
