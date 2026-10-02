import { describe, expect, it } from 'vitest';
import { parse, resolve } from 'node:path';
import { MemoryFileSystem } from '../infra/memory-file-system.js';
import type { Result } from '@itstudio/schemas';
import type { IFileSystem } from '../ports/file-system.js';
import { isForbidden, isWithinAllowed, normalizeRelative, resolveSafe } from './path-guard.js';

class FaultyMemoryFileSystem extends MemoryFileSystem {
  private readonly failure: 'root' | 'exists' | 'ancestor' | 'missing';

  constructor(failure: 'root' | 'exists' | 'ancestor' | 'missing') {
    super();
    this.failure = failure;
  }

  override async realpath(path: string): Promise<Result<string>> {
    if (this.failure === 'root' || (this.failure === 'ancestor' && path.endsWith('target.ts'))) {
      return {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: 'test filesystem error',
          remediation: ['Retry.'],
          retryable: false,
        },
      };
    }
    return super.realpath(path);
  }

  override async exists(path: string): Promise<Result<boolean>> {
    if (this.failure === 'exists') {
      return {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: 'test filesystem error',
          remediation: ['Retry.'],
          retryable: false,
        },
      };
    }
    if (this.failure === 'missing') return { ok: true, value: false };
    if (this.failure === 'ancestor' && path.endsWith('target.ts')) return { ok: true, value: true };
    return super.exists(path);
  }
}

describe('normalizeRelative', () => {
  const invalidPaths = [
    '../x',
    'a/../../x',
    'a/..\\..\\x',
    '/etc/passwd',
    'C:\\Windows',
    'c:x',
    '\\\\srv\\share',
    '//srv/share',
    'a\0b',
    'CON',
    'con.txt',
    'PRN',
    'aux/x',
    'NUL.log',
    'COM1',
    'com9.bin',
    'LPT1',
    'lpt9.txt',
    'a.',
    'a./b',
    'a ',
    'a/ .',
    '',
    '.',
    './',
    '////',
    'a/..',
    'a\\..\\b',
    'C:/x',
    'z:relative',
    'folder/CON.ext/file',
    'folder/aux.tar.gz',
    'folder/NUL.',
    'folder/name. ',
    'folder/COM2.txt',
    'folder/LPT8.dat',
    'a'.repeat(1025),
    `folder/${'x'.repeat(1025)}`,
    '\0',
    'foo\0bar',
  ];

  it('rejects the traversal and invalid-name corpus (at least 40 cases)', () => {
    expect(invalidPaths.length).toBeGreaterThanOrEqual(40);
    for (const path of invalidPaths) expect(normalizeRelative(path).ok, path).toBe(false);
  });

  it('collapses dot segments and duplicate mixed separators without decoding or Unicode folding', () => {
    expect(normalizeRelative('src\\.//nested///file.ts')).toEqual({ ok: true, value: 'src/nested/file.ts' });
    expect(normalizeRelative('%2e%2e/x')).toMatchObject({ ok: true, value: '%2e%2e/x' });
    expect(normalizeRelative('．．/x')).toMatchObject({ ok: true, value: '．．/x' });
    expect(normalizeRelative('a/b')).toMatchObject({ ok: true, value: 'a/b' });
  });
});

describe('workspace path policy', () => {
  it('matches allowed paths on segment boundaries', () => {
    expect(isWithinAllowed('src/a', ['src/a'])).toBe(true);
    expect(isWithinAllowed('src/a/b.ts', ['src/a'])).toBe(true);
    expect(isWithinAllowed('src/ab.ts', ['src/a'])).toBe(false);
    expect(isWithinAllowed('src/a', [])).toBe(false);
  });

  it('blocks protected directories at any depth', () => {
    for (const path of [
      '.git',
      '.git/config',
      'src/.git/HEAD',
      'node_modules/pkg',
      'src/node_modules/pkg',
      '.itstudio/tx/1',
      'src/.itstudio/private',
    ]) {
      expect(isForbidden(path), path).toBe(true);
    }
    for (const path of ['src/git/config', 'src/node_modules-old/a', 'src/.itstudio-old/a', 'src/file.ts']) {
      expect(isForbidden(path), path).toBe(false);
    }
  });

  it('resolves normal paths, an internal symlink and a symlinked workspace root', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve('memory-workspace');
    const outside = resolve('memory-outside');
    const linkedRoot = resolve('memory-workspace-link');
    await fs.mkdir(root, true);
    await fs.mkdir(resolve(root, 'src', 'real'), true);
    await fs.mkdir(outside, true);
    fs.addSymlink(resolve(root, 'src', 'alias'), resolve(root, 'src', 'real'));
    fs.addSymlink(linkedRoot, root);

    const ordinary = await resolveSafe(root, 'src/new.ts', ['src'], fs);
    expect(ordinary).toEqual({ ok: true, value: resolve(root, 'src', 'new.ts') });
    expect(await resolveSafe(root, 'src/alias/new.ts', ['src'], fs)).toMatchObject({ ok: true });
    expect(await fs.writeFile(resolve(root, 'src', 'alias', 'written.ts'), 'inside')).toMatchObject({ ok: true });
    const symlinkRead = await fs.readFile(resolve(root, 'src', 'real', 'written.ts'));
    expect(symlinkRead.ok && new TextDecoder().decode(symlinkRead.value)).toBe('inside');
    expect(await resolveSafe(linkedRoot, 'src/real/new.ts', ['src'], fs)).toMatchObject({ ok: true });
    fs.addSymlink(resolve(root, 'src', 'escape'), outside);
    const escaped = await resolveSafe(root, 'src/escape/new.ts', ['src'], fs);
    expect(escaped.ok).toBe(false);
    if (!escaped.ok) {
      expect(escaped.error.code).toBe('PATH_OUTSIDE_WORKSPACE');
      expect(escaped.error.remediation?.length).toBeGreaterThan(0);
    }
  });

  it('rejects forbidden and out-of-allow-list paths without exposing raw input', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve('guard-root');
    await fs.mkdir(root, true);
    expect(await resolveSafe(root, 'node_modules/pkg', ['node_modules'], fs)).toMatchObject({
      ok: false,
      error: { code: 'PATH_OUTSIDE_WORKSPACE' },
    });
    expect(await resolveSafe(root, 'other/file', ['src'], fs)).toMatchObject({
      ok: false,
      error: { code: 'PATH_OUTSIDE_WORKSPACE' },
    });
    const invalid = await resolveSafe(root, `../${'secret'.repeat(100)}`, ['src'], fs);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.message).not.toContain('secret');
  });

  it('rejects filesystem errors while resolving the root, ancestor and existence checks', async () => {
    const root = resolve('guard-fault-root');
    for (const mode of ['root', 'exists', 'ancestor', 'missing'] as const) {
      const faultyFs = new FaultyMemoryFileSystem(mode);
      const fs: IFileSystem = faultyFs;
      const workspace = mode === 'missing' ? parse(process.cwd()).root : root;
      await faultyFs.mkdir(workspace, true);
      expect(await resolveSafe(workspace, 'src/target.ts', ['src'], fs)).toMatchObject({
        ok: false,
        error: { code: 'PATH_OUTSIDE_WORKSPACE' },
      });
    }
  });
});
