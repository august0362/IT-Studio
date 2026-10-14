import { invoke, isTauri } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebChatHost } from './webchat-host';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(isTauri).mockReturnValue(true);
});

describe('native web chat host lifecycle', () => {
  it('discards queued sync work when the page closes so stale work cannot recreate a pane', async () => {
    const host = createWebChatHost();
    const sync = host.sync([], [], [0]);
    const close = host.closeAll();
    await Promise.all([sync, close]);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('webchat_close_all', {});
  });

  it('continues processing visibility and cleanup commands after a native command fails', async () => {
    const host = createWebChatHost();
    vi.mocked(invoke).mockRejectedValueOnce(new Error('Reload failed'));
    await expect(host.reload(0)).rejects.toThrow('Reload failed');
    await host.setVisible(false);
    await host.closeAll();
    expect(invoke).toHaveBeenNthCalledWith(2, 'webchat_set_visible', { visible: false });
    expect(invoke).toHaveBeenNthCalledWith(3, 'webchat_close_all', {});
  });
});
