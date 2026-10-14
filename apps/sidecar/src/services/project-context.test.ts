import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../infra/memory-file-system.js';
import { ProjectContextService } from './project-context.js';

const root = 'C:/project-context-test';

describe('ProjectContextService', () => {
  it('limits the tree to depth four and ignores generated or private directories', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    await fs.writeFile(`${root}/root.txt`, 'root');
    await fs.mkdir(`${root}/a/b/c`, true);
    await fs.writeFile(`${root}/a/b/c/depth-four.txt`, 'included');
    await fs.mkdir(`${root}/a/b/c/d`, true);
    await fs.writeFile(`${root}/a/b/c/d/depth-five.txt`, 'excluded');
    for (const ignored of ['.git', 'node_modules', '.itstudio', 'dist', 'build', 'coverage']) {
      await fs.mkdir(`${root}/${ignored}`, true);
      await fs.writeFile(`${root}/${ignored}/secret.txt`, 'ignored');
    }

    const context = await new ProjectContextService(fs).build(root);

    expect(context.tree).toContain('root.txt');
    expect(context.tree).toContain('a/b/c/depth-four.txt');
    expect(context.tree).not.toContain('depth-five.txt');
    for (const ignored of ['.git', 'node_modules', '.itstudio', 'dist', 'build', 'coverage'])
      expect(context.tree).not.toContain(ignored);
  });

  it('returns content and sha256 only for safe allowed paths and skips missing files', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    await fs.writeFile(`${root}/allowed.txt`, 'exact bytes');
    await fs.writeFile('C:/outside-context.txt', 'outside');
    fs.addSymlink(`${root}/escape.txt`, 'C:/outside-context.txt');

    const context = await new ProjectContextService(fs).build(root, [
      'allowed.txt',
      'missing.txt',
      'escape.txt',
      '../outside-context.txt',
    ]);
    expect(context.filesWithHashes).toBe(
      JSON.stringify([
        {
          path: 'allowed.txt',
          sha256: createHash('sha256').update('exact bytes').digest('hex'),
          content: 'exact bytes',
        },
      ]),
    );
    expect(context.currentFiles).toEqual([{ path: 'allowed.txt', content: 'exact bytes' }]);
  });

  it('truncates the conventions summary to 2,000 characters', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    await fs.writeFile(`${root}/CONVENTIONS.md`, 'x'.repeat(2100));

    const context = await new ProjectContextService(fs).build(root);

    expect(context.conventionsSummary).toHaveLength(2000);
  });

  it('uses an empty conventions summary when the file is absent', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);

    const context = await new ProjectContextService(fs).build(root);

    expect(context.conventionsSummary).toBe('');
  });

  it('skips a directory when the filesystem cannot list it', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    await fs.writeFile(`${root}/hidden-from-tree.txt`, 'content');
    fs.readdir = () =>
      Promise.resolve({
        ok: false,
        error: {
          code: 'INTERNAL',
          message: 'Injected listing error.',
          retryable: false,
          remediation: ['Retry.'],
        },
      });

    const context = await new ProjectContextService(fs).build(root);

    expect(context.tree).toBe('');
  });

  it('skips entries whose metadata fails or reports a symbolic link', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    await fs.writeFile(`${root}/metadata-error.txt`, 'hidden');
    await fs.writeFile(`${root}/symbolic-link.txt`, 'hidden');
    const stat = fs.stat.bind(fs);
    fs.stat = async (path) => {
      if (path.endsWith('metadata-error.txt'))
        return {
          ok: false,
          error: {
            code: 'INTERNAL',
            message: 'Injected metadata error.',
            retryable: false,
            remediation: ['Retry.'],
          },
        };
      const result = await stat(path);
      return result.ok && path.endsWith('symbolic-link.txt')
        ? { ok: true, value: { ...result.value, isSymbolicLink: true } }
        : result;
    };

    const context = await new ProjectContextService(fs).build(root);

    expect(context.tree).toBe('');
  });

  it('keeps the hash but omits oversized file content', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    const bytes = new Uint8Array(256 * 1024 + 1).fill(97);
    await fs.writeFile(`${root}/large.txt`, bytes);

    const context = await new ProjectContextService(fs).build(root, ['large.txt']);

    expect(context.filesWithHashes).toBe(
      JSON.stringify([{ path: 'large.txt', sha256: createHash('sha256').update(bytes).digest('hex') }]),
    );
    expect(context.currentFiles).toEqual([]);
  });

  it('builds a tree-only web chat brief at depth two with the shared ignore list', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    await fs.writeFile(`${root}/README.md`, 'private contents');
    await fs.mkdir(`${root}/src/nested/deeper`, true);
    await fs.writeFile(`${root}/src/main.ts`, 'private contents');
    await fs.writeFile(`${root}/src/nested/page.ts`, 'private contents');
    await fs.writeFile(`${root}/src/nested/deeper/secret.ts`, 'private contents');
    await fs.mkdir(`${root}/node_modules`, true);
    await fs.writeFile(`${root}/node_modules/private.js`, 'private contents');
    fs.readFile = () => {
      throw new Error('Web chat tree must not read file contents.');
    };

    const tree = await new ProjectContextService(fs).buildWebChatTree(root);

    expect(tree).toContain('README.md');
    expect(tree).toContain('src/main.ts');
    expect(tree).toContain('src/nested/page.ts');
    expect(tree).not.toContain('src/nested/deeper/secret.ts');
    expect(tree).not.toContain('node_modules');
    expect(tree).not.toContain('private contents');
  });

  it('limits a web chat project tree to 150 entries', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir(root, true);
    for (let index = 0; index < 160; index += 1) await fs.writeFile(`${root}/file-${String(index)}.txt`, 'x');

    const tree = await new ProjectContextService(fs).buildWebChatTree(root);

    expect(tree.split('\n')).toHaveLength(150);
  });
});
