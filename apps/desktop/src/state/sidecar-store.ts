import { create } from 'zustand';
import type { ISidecarTransport, SidecarFatal, SidecarStatus } from '../rpc/transport';

interface SidecarState {
  readonly status: SidecarStatus;
  readonly fatal: SidecarFatal | null;
  readonly setStatus: (status: SidecarStatus) => void;
  readonly setFatal: (fatal: SidecarFatal) => void;
}

export const useSidecarStatusStore = create<SidecarState>((set) => ({
  status: { running: false, ready: false, restarts: 0 },
  fatal: null,
  setStatus: (status) => {
    set({ status });
  },
  setFatal: (fatal) => {
    set({ fatal });
  },
}));

export function connectSidecarStatus(transport: ISidecarTransport): () => void {
  const setStatus = useSidecarStatusStore.getState().setStatus;
  const setFatal = useSidecarStatusStore.getState().setFatal;
  let statusEventReceived = false;
  const unlistenStatus = transport.onStatus((status) => {
    statusEventReceived = true;
    setStatus(status);
  });
  const unlistenFatal = transport.onFatal(setFatal);
  void transport.status().then((status) => {
    if (!statusEventReceived) setStatus(status);
  }).catch(() => undefined);
  return () => {
    unlistenStatus();
    unlistenFatal();
  };
}

export function useSidecarStatus(): SidecarState {
  return useSidecarStatusStore();
}
