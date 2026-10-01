import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      './apps/sidecar/vitest.config.ts',
      './apps/desktop/vitest.config.ts',
      './apps/vscode-ext/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['apps/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        '**/*.d.ts',
        '**/*.types.ts',
        '**/types/**',
        '**/test-setup.ts',
        'apps/desktop/src/main.tsx',
        'apps/vscode-ext/src/extension.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
        'apps/sidecar/src/domain/**': {
          lines: 90,
          perFile: true,
        },
      },
    },
  },
});
