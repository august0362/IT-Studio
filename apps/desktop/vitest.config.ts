import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    alias: {
      '@itstudio/schemas': fileURLToPath(new URL('../../src/types/schemas.ts', import.meta.url)),
    },
  },
  test: {
    name: 'desktop',
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
});
