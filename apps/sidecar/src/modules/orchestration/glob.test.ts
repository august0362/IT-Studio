import { describe, expect, it } from 'vitest';
import { pathsOverlap } from './path-locks.js';
import { globMatches } from './glob.js';

describe('allowedPaths glob matching (STAB P0-01)', () => {
  it.each([
    ['src/**', 'src/foo.ts'],
    ['src/**', 'src/ui/Button.tsx'],
    ['src/**', 'src/ui/pages/App.tsx'],
    ['src/**/*.ts', 'src/a.ts'],
    ['src/**/*.ts', 'src/a/b/c.ts'],
    ['**/*.md', 'README.md'],
    ['**/*.md', 'docs/guide/intro.md'],
    ['**', 'a/b/c'],
    ['src/*.ts', 'src/index.ts'],
    ['src/?.ts', 'src/a.ts'],
    ['README.md', 'README.md'],
    ['src/(legacy)/a+b.ts', 'src/(legacy)/a+b.ts'],
    ['src/***', 'src/a.ts'],
  ])('P0-01 %s matches %s', (glob, path) => {
    expect(globMatches(glob, path)).toBe(true);
  });

  it.each([
    ['src/**', 'srcx/a.ts'],
    ['src/**', 'lib/src/a.ts'],
    ['src/**', 'src'],
    ['src/**/*.ts', 'src/a/b.tsx'],
    ['src/*.ts', 'src/a/b.ts'],
    ['src/?.ts', 'src/ab.ts'],
    ['README.md', 'READMExmd'],
    ['src/a.ts', 'SRC/a.ts'],
    ['src/(legacy)/a+b.ts', 'src/legacy/aab.ts'],
  ])('P0-01 %s does not match unrelated %s', (glob, path) => {
    expect(globMatches(glob, path)).toBe(false);
  });

  it.each([
    'src/../outside.ts',
    '../outside.ts',
    'src/./a.ts',
    './src/a.ts',
    '/src/a.ts',
    '//server/share/src/a.ts',
    'C:/repo/src/a.ts',
    'C:src/a.ts',
    'src\\a.ts',
    'src\\..\\..\\outside.ts',
    'src//a.ts',
    'src/a.ts/',
    'src/a\0.ts',
    '',
  ])('P0-01 never matches the unsafe path %j, not even with **', (path) => {
    expect(globMatches('src/**', path)).toBe(false);
    expect(globMatches('**', path)).toBe(false);
  });

  it.each(['/src/**', 'C:/src/**', '../**', 'src/../**', 'src\\**', 'src//**', './src/**', ''])(
    'P0-01 the unsafe pattern %j matches nothing',
    (glob) => {
      expect(globMatches(glob, 'src/a.ts')).toBe(false);
      expect(globMatches(glob, 'a.ts')).toBe(false);
    },
  );

  it('P0-01 path locks use the same matcher: nested directories overlap, siblings do not', () => {
    expect(pathsOverlap('src/**', 'src/ui/pages/App.tsx')).toBe(true);
    expect(pathsOverlap('src/**', 'src/ui/**')).toBe(true);
    expect(pathsOverlap('src/ui/**', 'src/api/**')).toBe(false);
    expect(pathsOverlap('src/**', 'srcx/**')).toBe(false);
  });

  it('P0-01 path locks treat differently cased paths as overlapping (one folder on Windows)', () => {
    expect(pathsOverlap('src/**', 'SRC/**')).toBe(true);
    expect(pathsOverlap('docs/README.md', 'docs/readme.md')).toBe(true);
  });
});
