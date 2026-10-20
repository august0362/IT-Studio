import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Cases whose pass/fail depends on the machine, not on the code: BRK-C12 asserts an absolute latency budget
// (p95 < 200 ms) and BRK-D07 relies on a read-only ACL that an elevated account (GitHub's runner) is not stopped by.
// CI runs them in a separate, non-blocking job (docs/qa/stabilization/05-CI-GOVERNANCE.md §4); a local
// `npm run test:integration` runs everything.
const MACHINE_SENSITIVE = ['BRK-C12', 'BRK-D07'];
const selection = process.env.ITSTUDIO_INTEGRATION_SELECTION;
const testNamePattern =
  selection === 'stable'
    ? new RegExp(`^(?!.*(?:${MACHINE_SENSITIVE.join('|')}))`, 'u')
    : selection === 'machine-sensitive'
      ? new RegExp(MACHINE_SENSITIVE.join('|'), 'u')
      : undefined;

// L3 integration suite (docs/TESTING.md §1): spawns the real sidecar process; run with `npm run test:integration`.
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
    ...(testNamePattern === undefined ? {} : { testNamePattern }),
  },
});
