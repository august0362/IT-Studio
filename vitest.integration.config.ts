import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// L3 integration suite (TESTING.md §1): spawns the real sidecar process; run with `npm run test:integration`.
export default defineConfig({
  resolve: {
    alias: { '@itstudio/schemas': fileURLToPath(new URL('./src/types/schemas.ts', import.meta.url)) },
  },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['apps/sidecar/test/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 20_000,
  },
});
