import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['sidecar', 'desktop', 'vscode-ext'].map((name) => ({
      extends: `./apps/${name}/vitest.config.ts`,
      root: `./apps/${name}`,
      test: { name, testTimeout: 15_000, hookTimeout: 20_000 },
    })),
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
        'apps/sidecar/src/{kernel,modules/*}/domain/**': {
          lines: 90,
          perFile: true,
        },
      },
    },
  },
});
