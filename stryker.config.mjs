export default {
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  mutate: [
    'apps/sidecar/src/domain/path-guard.ts',
    'apps/sidecar/src/services/write-transaction.ts',
    'apps/sidecar/src/domain/pipeline-machine.ts',
    'apps/sidecar/src/domain/template.ts',
  ],
  reporters: ['clear-text', 'progress'],
  vitest: {
    configFile: 'vitest.config.ts',
    related: true,
  },
  thresholds: { high: 80, low: 0, break: null },
};
