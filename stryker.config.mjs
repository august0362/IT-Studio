import { declareFactoryPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { vitestTestRunnerFactory } from './node_modules/@stryker-mutator/vitest-runner/dist/src/vitest-test-runner.js';

function createVitest5Runner(injector) {
  const runner = vitestTestRunnerFactory(injector);
  const mutantRun = runner.mutantRun.bind(runner);
  runner.mutantRun = (options) => {
    // Vitest 5 separates suite and test names with " > "; Stryker 10 filters with a space.
    // Keep the covering test files, but run every test within those files.
    const testFilter = options.testFilter?.map((id) => {
      const separator = id.indexOf('#');
      return separator < 0 ? id : id.slice(0, separator + 1);
    });
    return mutantRun({ ...options, testFilter });
  };
  return runner;
}

createVitest5Runner.inject = vitestTestRunnerFactory.inject;

export const strykerPlugins = [declareFactoryPlugin(PluginKind.TestRunner, 'vitest5', createVitest5Runner)];

export default {
  testRunner: 'vitest5',
  appendPlugins: ['./stryker.config.mjs'],
  concurrency: 2,
  coverageAnalysis: 'perTest',
  mutate: [
    'apps/sidecar/src/kernel/domain/path-guard.ts',
    'apps/sidecar/src/modules/pipeline/services/write-transaction.ts',
    'apps/sidecar/src/modules/pipeline/domain/pipeline-machine.ts',
    'apps/sidecar/src/kernel/domain/template.ts',
  ],
  reporters: ['clear-text', 'progress'],
  vitest: {
    configFile: 'vitest.config.ts',
    related: true,
  },
  thresholds: { high: 80, low: 0, break: null },
};
