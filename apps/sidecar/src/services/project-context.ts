import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import type { IFileSystem } from '../ports/file-system.js';
import { resolveSafe } from '../domain/path-guard.js';

const IGNORED = new Set(['.git', 'node_modules', '.itstudio', 'dist', 'build', 'coverage']);
const MAX_FILES = 2000;
const MAX_CONTENT_BYTES = 256 * 1024;

export interface ProjectFileContext {
  readonly tree: string;
  readonly conventionsSummary: string;
  readonly filesWithHashes: string;
  readonly currentFiles: readonly { readonly path: string; readonly content: string }[];
}

export class ProjectContextService {
  private readonly fs: IFileSystem;
  constructor(fileSystem: IFileSystem) {
    this.fs = fileSystem;
  }

  async build(root: string, allowedPaths: readonly string[] = []): Promise<ProjectFileContext> {
    const files: string[] = [];
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth >= 4 || files.length >= MAX_FILES) return;
      const entries = await this.fs.readdir(directory);
      if (!entries.ok) return;
      for (const name of [...entries.value].sort()) {
        if (IGNORED.has(name) || files.length >= MAX_FILES) continue;
        const absolute = join(directory, name);
        const stat = await this.fs.stat(absolute);
        if (!stat.ok || stat.value.isSymbolicLink) continue;
        const path = relative(root, absolute).split(sep).join('/');
        if (stat.value.isDirectory) {
          files.push(`${path}/`);
          await visit(absolute, depth + 1);
        } else if (stat.value.isFile) files.push(path);
      }
    };
    await visit(root, 0);
    const tree = files.join('\n');
    const conventionsPath = join(root, 'CONVENTIONS.md');
    const conventions = await this.fs.readFile(conventionsPath);
    const conventionsSummary = conventions.ok ? new TextDecoder().decode(conventions.value).slice(0, 2000) : '';
    const contents: { path: string; sha256: string; content?: string }[] = [];
    for (const path of allowedPaths) {
      const safe = await resolveSafe(root, path, allowedPaths, this.fs);
      if (!safe.ok) continue;
      const file = await this.fs.readFile(safe.value);
      if (!file.ok) continue;
      contents.push({
        path,
        sha256: createHash('sha256').update(file.value).digest('hex'),
        ...(file.value.byteLength <= MAX_CONTENT_BYTES
          ? { content: new TextDecoder('utf-8', { fatal: false }).decode(file.value) }
          : {}),
      });
    }
    const currentFiles = contents.flatMap((file) =>
      file.content === undefined ? [] : [{ path: file.path, content: file.content }],
    );
    return { tree, conventionsSummary, filesWithHashes: JSON.stringify(contents), currentFiles };
  }
}
