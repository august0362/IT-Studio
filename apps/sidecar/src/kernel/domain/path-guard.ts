import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { ErrorCode, type AppError, type Result, type WorkspaceRelativePath } from '@itstudio/schemas';
import type { IFileSystem } from '../ports/file-system.js';

const RESERVED_WINDOWS_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function pathError(): Result<never> {
  const error: AppError = {
    code: ErrorCode.PATH_OUTSIDE_WORKSPACE,
    message: 'The requested path is invalid or outside the allowed workspace paths.',
    remediation: ['Choose a relative path inside the project and within the task allowed paths.'],
    retryable: false,
  };
  return { ok: false, error };
}

export function normalizeRelative(input: string): Result<WorkspaceRelativePath> {
  if (input.length === 0 || input.length > 1024 || input.includes('\0')) return pathError();
  const slashed = input.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[a-zA-Z]:/.test(slashed)) return pathError();

  const segments: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment.length === 0) continue;
    if (segment === '.') continue;
    if (segment === '..' || segment.endsWith('.') || segment.endsWith(' ')) return pathError();
    if (RESERVED_WINDOWS_NAME.test(segment)) return pathError();
    segments.push(segment);
  }
  if (segments.length === 0) return pathError();
  const normalized = segments.join('/');
  return { ok: true, value: normalized as WorkspaceRelativePath };
}

export function isWithinAllowed(path: string, allowedPaths: readonly string[]): boolean {
  const candidate = path.toLocaleLowerCase('en-US');
  return allowedPaths.some((allowed) => {
    const prefix = allowed.toLocaleLowerCase('en-US').replace(/\/$/, '');
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  });
}

export function isForbidden(path: string): boolean {
  const segments = path.toLocaleLowerCase('en-US').split('/');
  return segments.some((segment) => segment === '.git' || segment === 'node_modules' || segment === '.itstudio');
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

export async function resolveSafe(
  root: string,
  rel: string,
  allowedPaths: readonly string[],
  fs: IFileSystem,
): Promise<Result<string>> {
  const normalized = normalizeRelative(rel);
  if (!normalized.ok || isForbidden(normalized.value) || !isWithinAllowed(normalized.value, allowedPaths))
    return pathError();

  const absoluteRoot = resolve(root);
  const realRoot = await fs.realpath(absoluteRoot);
  if (!realRoot.ok) return pathError();

  const candidate = resolve(absoluteRoot, ...normalized.value.split('/'));
  let ancestor = candidate;
  while (isInside(absoluteRoot, ancestor)) {
    const exists = await fs.exists(ancestor);
    if (!exists.ok) return pathError();
    if (exists.value) {
      const realAncestor = await fs.realpath(ancestor);
      if (!realAncestor.ok || !isInside(realRoot.value, realAncestor.value)) return pathError();
      return { ok: true, value: candidate };
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return pathError();
}
