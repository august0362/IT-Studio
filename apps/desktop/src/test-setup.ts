import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// findBy*/waitFor give up after 1 s by default; a loaded CI runner can take longer for a first React Flow render
// (STAB CI: WorkflowPage M9-OBS-05 timed out on GitHub Actions). Same assertions, more time to settle.
configure({ asyncUtilTimeout: 5_000 });

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
