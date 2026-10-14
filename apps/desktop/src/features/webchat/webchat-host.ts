import type { WebChatLink, WebChatPaneRequest } from '@itstudio/schemas';
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface IWebChatHost {
  readonly available: boolean;
  sync(
    links: readonly WebChatLink[],
    panes: readonly WebChatPaneRequest[],
    activeSlots: readonly number[],
  ): Promise<void>;
  reload(slot: number): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  closeAll(): Promise<void>;
}

export function createWebChatHost(): IWebChatHost {
  const available = isTauri();
  let pending = Promise.resolve();
  let generation = 0;
  function enqueue(action: () => Promise<void>): Promise<void> {
    const next = pending.then(action, action);
    pending = next;
    return next;
  }
  return {
    available,
    sync(links, panes, activeSlots) {
      const requestedGeneration = generation;
      return enqueue(async () => {
        if (!available || requestedGeneration !== generation) return;
        await invoke('webchat_sync', { links, panes, activeSlots });
      });
    },
    reload(slot) {
      return enqueue(async () => {
        if (available) await invoke('webchat_reload', { slot });
      });
    },
    setVisible(visible) {
      return enqueue(async () => {
        if (available) await invoke('webchat_set_visible', { visible });
      });
    },
    closeAll() {
      generation += 1;
      return enqueue(async () => {
        if (available) await invoke('webchat_close_all', {});
      });
    },
  };
}
