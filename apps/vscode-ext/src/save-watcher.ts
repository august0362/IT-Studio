import path from 'node:path';
import { resolveWorkspacePath } from './actions';

export interface SaveWatcherOptions {
  readonly workspaceRoot: string;
  readonly now: () => number;
  readonly hash: (text: string) => string;
  readonly send: (path: string, hash: string) => void;
}

const OWN_WRITE_WINDOW_MS = 2000;

export class SaveWatcher {
  private readonly options: SaveWatcherOptions;
  private readonly ownWrites = new Map<string, number>();

  public constructor(options: SaveWatcherOptions) {
    this.options = options;
  }

  public committed(paths: readonly string[]): void {
    const now = this.options.now();
    for (const candidate of paths) {
      const safe = resolveWorkspacePath(this.options.workspaceRoot, candidate);
      if (safe) this.ownWrites.set(this.key(safe.relativePath), now);
    }
  }

  public saved(absolutePath: string, text: string): void {
    const relativePath = path.relative(path.resolve(this.options.workspaceRoot), path.resolve(absolutePath));
    const safe = resolveWorkspacePath(this.options.workspaceRoot, relativePath);
    if (!safe || isIgnoredPath(safe.relativePath)) return;
    const now = this.options.now();
    const key = this.key(safe.relativePath);
    const committedAt = this.ownWrites.get(key);
    if (committedAt !== undefined && now - committedAt <= OWN_WRITE_WINDOW_MS) return;
    this.ownWrites.delete(key);
    this.options.send(safe.relativePath, this.options.hash(text));
  }

  private key(path: string): string {
    return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path;
  }
}

function isIgnoredPath(path: string): boolean {
  const segments = path.split('/');
  return segments.some((part) => {
    const segment = process.platform === 'win32' ? part.toLocaleLowerCase('en-US') : part;
    return segment === '.itstudio' || segment === 'node_modules' || segment === '.git';
  });
}
