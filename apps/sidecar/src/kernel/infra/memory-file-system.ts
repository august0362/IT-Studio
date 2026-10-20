import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { AppError, Result } from '@itstudio/schemas';
import type { FileStat, IFileSystem } from '../ports/file-system.js';

type Entry =
  | { readonly kind: 'directory' }
  | { readonly kind: 'file'; data: Uint8Array }
  | { readonly kind: 'symlink'; target: string };

function failed(operation: string): Result<never> {
  const error: AppError = {
    code: 'INTERNAL',
    message: `In-memory file system operation failed: ${operation}.`,
    remediation: ['Check the requested path and retry.'],
    retryable: false,
  };
  return { ok: false, error };
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

export class MemoryFileSystem implements IFileSystem {
  private readonly entries = new Map<string, Entry>();
  private failingAfter: number | undefined;
  private failingInvocation: number | undefined;
  private failingInvocations: Set<number> | undefined;
  private invocationCount = 0;

  /** Fail one mutating filesystem operation after the requested number of successful mutations. */
  injectFailureAfter(successfulMutations: number): void {
    this.failingAfter = Math.max(0, successfulMutations);
  }

  /** Fail the Nth IFileSystem call, including reads and metadata operations. */
  injectFailureAtInvocation(invocation: number): void {
    this.invocationCount = 0;
    this.failingInvocations = undefined;
    this.failingInvocation = Math.max(1, invocation);
  }

  /** Fail each selected IFileSystem call, allowing commit and rollback failures in one scenario. */
  injectFailuresAtInvocations(...invocations: readonly number[]): void {
    this.invocationCount = 0;
    this.failingInvocation = undefined;
    this.failingInvocations = new Set(invocations.map((invocation) => Math.max(1, invocation)));
  }

  get callCount(): number {
    return this.invocationCount;
  }

  clearFailureInjection(): void {
    this.failingAfter = undefined;
    this.failingInvocation = undefined;
    this.failingInvocations = undefined;
    this.invocationCount = 0;
  }

  private shouldFailCall(): boolean {
    this.invocationCount += 1;
    if (this.failingInvocations?.delete(this.invocationCount)) return true;
    if (this.failingInvocation === this.invocationCount) {
      this.failingInvocation = undefined;
      return true;
    }
    return false;
  }

  private shouldFail(): boolean {
    if (this.failingAfter === undefined) return false;
    if (this.failingAfter > 0) {
      this.failingAfter -= 1;
      return false;
    }
    this.failingAfter = undefined;
    return true;
  }

  constructor() {
    this.entries.set(resolve(parse(process.cwd()).root), { kind: 'directory' });
  }

  addSymlink(path: string, target: string): void {
    this.entries.set(resolve(path), {
      kind: 'symlink',
      target: isAbsolute(target) ? resolve(target) : resolve(dirname(path), target),
    });
  }

  private resolvePath(path: string, depth = 0, requireExists = true): string | undefined {
    if (depth > 32) return undefined;
    const absolute = resolve(path);
    let current = parse(absolute).root;
    const rest = relative(current, absolute).split(sep).filter(Boolean);
    for (let index = 0; index < rest.length; index += 1) {
      current = join(current, rest[index] ?? '');
      const entry = this.entries.get(resolve(current));
      if (entry?.kind === 'symlink') {
        const suffix = rest.slice(index + 1).join(sep);
        return this.resolvePath(suffix ? join(entry.target, suffix) : entry.target, depth + 1, requireExists);
      }
    }
    return requireExists && !this.entries.has(absolute) ? undefined : absolute;
  }

  private ensureDirectory(path: string): boolean {
    const absolute = resolve(path);
    if (absolute === parse(absolute).root) return true;
    if (this.entries.get(absolute)?.kind === 'directory') return true;
    const parent = dirname(absolute);
    if (parent === absolute || !this.ensureDirectory(parent)) return false;
    this.entries.set(absolute, { kind: 'directory' });
    return true;
  }

  private parentExists(path: string): boolean {
    const parent = this.resolvePath(dirname(path));
    return parent !== undefined && this.entries.get(parent)?.kind === 'directory';
  }

  readFile(path: string): Promise<Result<Uint8Array>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected read'));
    const resolved = this.resolvePath(path);
    const entry = resolved ? this.entries.get(resolved) : undefined;
    return Promise.resolve(entry?.kind === 'file' ? { ok: true, value: entry.data.slice() } : failed('read'));
  }

  writeFile(path: string, data: string | Uint8Array): Promise<Result<void>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected write'));
    if (this.shouldFail()) return Promise.resolve(failed('injected write'));
    const absolute = resolve(path);
    if (!this.parentExists(absolute)) return Promise.resolve(failed('write'));
    const resolved = this.resolvePath(absolute, 0, false) ?? absolute;
    this.entries.set(resolved, {
      kind: 'file',
      data: typeof data === 'string' ? new TextEncoder().encode(data) : data.slice(),
    });
    return Promise.resolve({ ok: true, value: undefined });
  }

  rename(from: string, to: string): Promise<Result<void>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected rename'));
    if (this.shouldFail()) return Promise.resolve(failed('injected rename'));
    const source = this.resolvePath(from);
    const entry = source ? this.entries.get(source) : undefined;
    const destination = resolve(to);
    if (!source || !entry || !this.parentExists(destination)) return Promise.resolve(failed('rename'));
    this.entries.delete(source);
    this.entries.set(destination, entry);
    return Promise.resolve({ ok: true, value: undefined });
  }

  unlink(path: string): Promise<Result<void>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected unlink'));
    if (this.shouldFail()) return Promise.resolve(failed('injected unlink'));
    const resolved = this.resolvePath(path);
    if (!resolved || this.entries.get(resolved)?.kind === 'directory') return Promise.resolve(failed('remove'));
    this.entries.delete(resolved);
    return Promise.resolve({ ok: true, value: undefined });
  }

  mkdir(path: string, recursive: boolean): Promise<Result<void>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected mkdir'));
    if (this.shouldFail()) return Promise.resolve(failed('injected mkdir'));
    const absolute = resolve(path);
    if (
      recursive
        ? this.ensureDirectory(absolute)
        : this.entries.get(dirname(absolute))?.kind === 'directory' && !this.entries.has(absolute)
    ) {
      if (!this.entries.has(absolute)) this.entries.set(absolute, { kind: 'directory' });
      return Promise.resolve({ ok: true, value: undefined });
    }
    return Promise.resolve(failed('create directory'));
  }

  rmdirIfEmpty(path: string): Promise<Result<boolean>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected remove empty directory'));
    if (this.shouldFail()) return Promise.resolve(failed('injected remove empty directory'));
    const resolved = resolve(path);
    const entry = this.entries.get(resolved);
    if (entry?.kind !== 'directory') return Promise.resolve({ ok: true, value: false });
    const hasChildren = [...this.entries.keys()].some(
      (candidate) => candidate !== resolved && dirname(candidate) === resolved,
    );
    if (hasChildren) return Promise.resolve({ ok: true, value: false });
    this.entries.delete(resolved);
    return Promise.resolve({ ok: true, value: true });
  }

  stat(path: string): Promise<Result<FileStat>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected stat'));
    const resolved = this.resolvePath(path);
    const entry = resolved ? this.entries.get(resolved) : undefined;
    if (!entry) return Promise.resolve(failed('stat'));
    return Promise.resolve({
      ok: true,
      value: {
        isFile: entry.kind === 'file',
        isDirectory: entry.kind === 'directory',
        isSymbolicLink: false,
        size: entry.kind === 'file' ? entry.data.byteLength : 0,
      },
    });
  }

  realpath(path: string): Promise<Result<string>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected realpath'));
    const resolved = this.resolvePath(path);
    return Promise.resolve(resolved ? { ok: true, value: resolved } : failed('resolve path'));
  }

  exists(path: string): Promise<Result<boolean>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected exists'));
    return Promise.resolve({ ok: true, value: this.resolvePath(path) !== undefined });
  }

  readdir(path: string): Promise<Result<readonly string[]>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected readdir'));
    const directory = this.resolvePath(path);
    if (!directory || this.entries.get(directory)?.kind !== 'directory')
      return Promise.resolve(failed('list directory'));
    const names = new Set<string>();
    for (const entryPath of this.entries.keys()) {
      if (!isInside(directory, entryPath) || entryPath === directory) continue;
      const child = relative(directory, entryPath).split(sep);
      if (child.length === 1 && child[0]) names.add(child[0]);
    }
    return Promise.resolve({ ok: true, value: [...names] });
  }

  async copyFile(from: string, to: string): Promise<Result<void>> {
    if (this.shouldFailCall()) return failed('injected copy');
    if (this.shouldFail()) return failed('injected copy');
    const source = await this.readFile(from);
    return source.ok ? this.writeFile(to, source.value) : failed('copy');
  }

  fsync(path: string): Promise<Result<void>> {
    if (this.shouldFailCall()) return Promise.resolve(failed('injected fsync'));
    if (this.shouldFail()) return Promise.resolve(failed('injected fsync'));
    return Promise.resolve(this.resolvePath(path) ? { ok: true, value: undefined } : failed('sync'));
  }
}
