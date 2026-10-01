import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeTransport } from '../rpc/transport';
import { connectSidecarStatus, useSidecarStatus } from './sidecar-store';

describe('sidecar status store', () => {
  it('tracks status and fatal events and disconnects cleanly', async () => {
    const transport = new FakeTransport();
    const disconnect = connectSidecarStatus(transport);
    const hook = renderHook(() => useSidecarStatus());

    act(() => {
      transport.setStatus({ running: true, ready: true, restarts: 0 });
      transport.fail({ message: 'Sidecar stopped', logDir: 'logs/sidecar' });
    });
    await waitFor(() => {
      expect(hook.result.current.status.ready).toBe(true);
      expect(hook.result.current.fatal?.message).toBe('Sidecar stopped');
    });

    disconnect();
    act(() => {
      transport.setStatus({ running: false, ready: false, restarts: 1 });
    });
    expect(hook.result.current.status.running).toBe(true);
    hook.unmount();
  });
});
