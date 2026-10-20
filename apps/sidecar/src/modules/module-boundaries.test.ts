import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const modulesRoot = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(modulesRoot, '..');
const moduleNames = readdirSync(modulesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function relativeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specifiers = [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)'(\.{1,2}\/[^']+)'/gu)];
  return specifiers.map((match) => resolve(dirname(file), (match[1] ?? '').replace(/\.js$/u, '.ts')));
}

/** `modules/<name>/...` → name; anything else → undefined. */
function owningModule(file: string): string | undefined {
  const parts = relative(modulesRoot, file).split(sep);
  return parts.length > 1 && parts[0] !== '..' ? parts[0] : undefined;
}

describe('MOD-01/02 sidecar feature modules', () => {
  it('has the eleven feature modules plus processes and orchestration', () => {
    expect(moduleNames.toSorted()).toEqual([
      'chat',
      'cost',
      'images',
      'knowledge',
      'orchestration',
      'pipeline',
      'processes',
      'projects',
      'router',
      'settings',
      'vscode',
      'web-chat',
      'workflow',
    ]);
  });

  it.each(moduleNames)('module %s has index.ts, rpc.ts and README.md', (name) => {
    for (const file of ['index.ts', 'rpc.ts', 'README.md'])
      expect(existsSync(join(modulesRoot, name, file))).toBe(true);
  });

  it('imports another module only through its index.ts, and kernel never imports modules', () => {
    const violations = sourceFiles(sourceRoot).flatMap((file) => {
      const from = owningModule(file);
      const inKernel = relative(sourceRoot, file).startsWith(`kernel${sep}`);
      return relativeImports(file)
        .filter((target) => {
          const to = owningModule(target);
          if (to === undefined || to === from) return false;
          return inKernel || target !== join(modulesRoot, to, 'index.ts');
        })
        .map((target) => `${relative(sourceRoot, file)} -> ${relative(sourceRoot, target)}`);
    });
    expect(violations).toEqual([]);
  });
});
