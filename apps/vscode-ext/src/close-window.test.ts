import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWindow } from './close-window';

afterEach(() => {
  vi.useRealTimers();
});

describe('VSC-01 VS Code close command', () => {
  it.each([true, false])('runs closeWindow and reports %s', async (outcome) => {
    const execute = vi.fn(() => Promise.resolve(outcome));
    expect(await closeWindow(execute)).toBe(outcome);
    expect(execute).toHaveBeenCalledExactlyOnceWith('workbench.action.closeWindow');
  });

  it('allows normal asynchronous shutdown before acknowledging a surviving window as not closed', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(() => Promise.resolve(undefined));
    let finished = false;
    const closing = closeWindow(execute).then((closed) => {
      finished = true;
      return closed;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await closing).toBe(false);
    expect(execute).toHaveBeenCalledExactlyOnceWith('workbench.action.closeWindow');
  });
});
