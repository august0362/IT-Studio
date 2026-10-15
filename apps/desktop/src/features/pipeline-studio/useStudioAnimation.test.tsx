import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enqueueTransition, PACKET_MS, replayPackets, useStudioAnimation } from './useStudioAnimation';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('PSTUDIO-02 animation queue', () => {
  it('A → B enqueues one packet on that edge and ignores unchanged stages', () => {
    expect(enqueueTransition([], 'spec', 'code', 1, false)).toEqual([{ id: 1, from: 'spec', to: 'code' }]);
    expect(enqueueTransition([], 'code', 'code', 2, false)).toEqual([]);
  });
  it('serializes replay in route order, pulses the target, and clears timers', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(useStudioAnimation);
    act(() => {
      result.current.replay(['request', 'spec', 'code', 'review', 'write', 'validate', 'done']);
    });
    expect(result.current.packet).toMatchObject({ from: 'request', to: 'spec' });
    act(() => {
      vi.advanceTimersByTime(PACKET_MS);
    });
    expect(result.current.packet).toMatchObject({ from: 'spec', to: 'code' });
    expect(result.current.pulse?.module).toBe('spec');
    for (let index = 0; index < 5; index++)
      act(() => {
        vi.advanceTimersByTime(PACKET_MS);
      });
    expect(result.current.packet).toBeUndefined();
    expect(result.current.pulse?.module).toBe('done');
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('live transitions are queued once and reduced motion emits no packets', () => {
    vi.useFakeTimers();
    const { result } = renderHook(useStudioAnimation);
    act(() => {
      result.current.transition('spec', 'code');
      result.current.transition('code', 'review');
    });
    expect(result.current.packet?.to).toBe('code');
    act(() => {
      vi.advanceTimersByTime(PACKET_MS);
    });
    expect(result.current.packet?.to).toBe('review');
    expect(replayPackets(['request', 'spec', 'code'], 0, true)).toEqual([]);
    expect(enqueueTransition([], 'spec', 'code', 1, true)).toEqual([]);
  });
  it('respects prefers-reduced-motion in the hook', () => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    vi.spyOn(window, 'matchMedia').mockReturnValue(Object.assign(media, { matches: true }));
    const { result } = renderHook(useStudioAnimation);
    act(() => {
      result.current.transition('spec', 'code');
      result.current.replay(['request', 'spec', 'code']);
    });
    expect(result.current.packet).toBeUndefined();
    expect(result.current.pulse).toBeNull();
  });
});
