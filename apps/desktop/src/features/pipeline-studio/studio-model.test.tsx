import { afterEach, describe, expect, it, vi } from 'vitest';
import { badge, defaultPosition, LAYOUT_KEY, moduleStatuses, readLayout, writeLayout } from './studio-model';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe('OWNER-FB3 shared process states', () => {
  it('TC-OWNER-FB3-007 maps sidecar modules without inferring completion from later stages', () => {
    const states = moduleStatuses([
      { id: 'clarify', label: 'Clarify', state: 'waiting' },
      { id: 'spec', label: 'Spec', state: 'idle' },
      { id: 're_review', label: 'Re-review', state: 'skipped' },
    ]);
    expect(states).toMatchObject({ clarify: 'waiting', spec: 'idle', 're-review': 'skipped', done: 'idle' });
    expect(badge('clarify', states.clarify)).toBe('?');
    expect(badge('spec', states.spec)).toBe('—');
    expect(moduleStatuses().request).toBe('idle');
  });
});

describe('PSTUDIO-02 optional layout storage', () => {
  it('persists positions, ignores malformed entries and restores defaults', () => {
    writeLayout({ code: { x: 12, y: 34 } });
    expect(readLayout()).toEqual({ code: { x: 12, y: 34 } });
    localStorage.setItem(LAYOUT_KEY, '{"code":{"x":"bad","y":0},"request":{"x":1,"y":2}}');
    expect(readLayout()).toEqual({ request: { x: 1, y: 2 } });
    writeLayout({});
    expect(readLayout()).toEqual({});
    expect(defaultPosition('code')).toEqual({ x: 750, y: 0 });
  });
  it('tolerates corrupt JSON and throwing storage reads and writes', () => {
    localStorage.setItem(LAYOUT_KEY, 'not json');
    expect(readLayout()).toEqual({});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    expect(readLayout()).toEqual({});
    expect(() => {
      writeLayout({});
    }).not.toThrow();
  });
});
