import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';
import { NodeBrowserLauncher } from './node-browser-launcher.js';

describe('NodeBrowserLauncher', () => {
  it('spawns a validated browser without a shell and detaches', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as Pick<
      ChildProcess,
      'on' | 'unref'
    >;
    const spawnChild = vi.fn<SpawnChild>().mockReturnValue(child);
    const launcher = new NodeBrowserLauncher(createLogger({ streams: [] }), () => true, spawnChild);
    expect(launcher.launch('C:\\Browser.exe', 'https://chatgpt.com/')).toEqual({ ok: true, value: undefined });
    expect(spawnChild).toHaveBeenCalledWith('C:\\Browser.exe', ['https://chatgpt.com/'], {
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('rejects invalid executable, URL, and missing paths', () => {
    const spawnChild = vi
      .fn<SpawnChild>()
      .mockReturnValue(
        Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as Pick<ChildProcess, 'on' | 'unref'>,
      );
    const launcher = new NodeBrowserLauncher(createLogger({ streams: [] }), () => false, spawnChild);
    expect(launcher.launch('browser.exe', 'https://chatgpt.com/').ok).toBe(false);
    expect(launcher.launch('C:\\Browser.exe', 'http://chatgpt.com/').ok).toBe(false);
    expect(launcher.launch('C:\\Browser.exe', 'https://chatgpt.com/').ok).toBe(false);
    expect(spawnChild).not.toHaveBeenCalled();
  });

  it('logs asynchronous spawn errors without exposing the target URL', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as Pick<
      ChildProcess,
      'on' | 'unref'
    >;
    const warn = vi.fn();
    const launcher = new NodeBrowserLauncher(
      { warn } as unknown as ReturnType<typeof createLogger>,
      () => true,
      vi.fn<SpawnChild>().mockReturnValue(child),
    );
    expect(launcher.launch('C:\\Browser.exe', 'https://chatgpt.com/?private=query')).toMatchObject({ ok: true });
    (child as unknown as EventEmitter).emit('error', new Error('spawn failed'));
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private=query');
  });
});

type SpawnChild = (
  executable: string,
  args: readonly string[],
  options: { readonly shell: false; readonly detached: true; readonly stdio: 'ignore'; readonly windowsHide: false },
) => Pick<ChildProcess, 'on' | 'unref'>;
