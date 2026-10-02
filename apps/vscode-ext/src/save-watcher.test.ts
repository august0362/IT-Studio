import { describe, expect, it } from 'vitest';
import { SaveWatcher } from './save-watcher';

describe('SaveWatcher', () => {
  it('sends saved workspace files with their text hash', () => {
    const sent: { readonly path: string; readonly hash: string }[] = [];
    const watcher = new SaveWatcher({
      workspaceRoot: 'C:/project',
      now: () => 100,
      hash: (text) => `sha256:${text}`,
      send: (path, hash) => sent.push({ path, hash }),
    });
    watcher.saved('C:/project/src/app.ts', 'saved text');
    expect(sent).toEqual([{ path: 'src/app.ts', hash: 'sha256:saved text' }]);
  });

  it('ignores outside files and files in excluded directories', () => {
    const sent: string[] = [];
    const watcher = new SaveWatcher({
      workspaceRoot: 'C:/project',
      now: () => 100,
      hash: (text) => text,
      send: (path) => sent.push(path),
    });
    for (const path of [
      'C:/outside/file.ts',
      'C:/project/.itstudio/session.json',
      'C:/project/node_modules/pkg/index.js',
      'C:/project/.git/config',
    ])
      watcher.saved(path, 'text');
    expect(sent).toEqual([]);
  });

  it('ignores sidecar writes for the same path for two seconds', () => {
    let now = 10;
    const sent: string[] = [];
    const watcher = new SaveWatcher({
      workspaceRoot: 'C:/project',
      now: () => now,
      hash: (text) => text,
      send: (path) => sent.push(path),
    });
    watcher.committed(['src/app.ts']);
    watcher.saved('C:/project/src/app.ts', 'own write');
    now = 2009;
    watcher.saved('C:/project/src/app.ts', 'still in window');
    expect(sent).toEqual([]);
    now = 2010;
    watcher.saved('C:/project/src/app.ts', 'user edit');
    expect(sent).toEqual(['src/app.ts']);
  });
});
