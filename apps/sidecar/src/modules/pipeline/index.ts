import { ModelCapability, type ProcessRecord, type ProviderId } from '@itstudio/schemas';
import { NodeProcessRunner } from '../../kernel/infra/node-process-runner.js';
import { PipelineRepository } from '../../kernel/infra/sqlite/pipeline-repository.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import type { IProcessTracker } from '../../kernel/ports/process-tracker.js';
import type { ISecretStore } from '../../kernel/ports/secret-store.js';
import type { WorkflowInternalEventBus } from '../../kernel/ports/workflow-internal-events.js';
import { pipelineRunIdSchema } from '../../kernel/validation/brand.js';
import type { CostModule } from '../cost/index.js';
import type { ProjectsModule } from '../projects/index.js';
import type { RouterModule } from '../router/index.js';
import type { SettingsService } from '../settings/index.js';
import { CommandRunner } from './services/command-runner.js';
import { FailureReportBuilder } from './services/failure-report-builder.js';
import { JournalRecoveryService } from './services/journal-recovery.js';
import { PipelineOrchestrator } from './services/pipeline-orchestrator.js';
import { recoverInterruptedRuns } from './services/pipeline-recovery.js';
import { RoleCaller } from './services/role-caller.js';
import { WriteTransactionService } from './services/write-transaction.js';

export interface PipelineModuleDependencies {
  readonly processes: IProcessTracker;
  readonly settings: SettingsService;
  readonly secretStore: ISecretStore;
  readonly router: RouterModule;
  readonly cost: CostModule;
  readonly projects: ProjectsModule;
  readonly internalEvents: WorkflowInternalEventBus;
}

export function createPipelineModule(ctx: ModuleContext, deps: PipelineModuleDependencies) {
  const { fileSystem, events, ids, clock, logger } = ctx;
  const { router, cost, projects } = deps;
  const { models } = router;
  const repository = new PipelineRepository(ctx.db);
  const writer = new WriteTransactionService({ fileSystem, ids, clock });
  const runner = new NodeProcessRunner();
  const commands = new CommandRunner({ processRunner: runner, fileSystem, ids, internalEvents: deps.internalEvents });
  const journalRecovery = new JournalRecoveryService(fileSystem, clock, logger);
  const reports = new FailureReportBuilder();
  const orchestrator = new PipelineOrchestrator({
    processes: deps.processes,
    eligibility: {
      load: async () => {
        const configuredProviders: ProviderId[] = [];
        for (const provider of new Set(models.list().map((model) => model.provider))) {
          const stored = await deps.secretStore.get(provider);
          if (!stored.ok) return stored;
          if (stored.value !== null) configuredProviders.push(provider);
        }
        return {
          ok: true,
          value: {
            models: models.list(),
            configuredProviders,
            eligibleModelKeys: models
              .list()
              .filter(
                (model) =>
                  models.eligibility(model.key, [ModelCapability.CHAT, ModelCapability.JSON_MODE], (provider) =>
                    configuredProviders.includes(provider),
                  ).eligible,
              )
              .map((model) => model.key),
          },
        };
      },
    },
    repository,
    projects: projects.repository,
    settings: async () => {
      const result = await deps.settings.get();
      return result.ok ? { ok: true, value: result.value.pipeline } : result;
    },
    context: projects.context,
    roles: new RoleCaller({ router: router.router, logger, ids, now: () => clock.now() }),
    writer,
    commands,
    reports,
    fileSystem,
    events,
    ids,
    clock,
    runCost: (runId) => cost.ledgerRepository.sumByPipelineRun(runId),
    moneyDisplay: cost.moneyDisplay,
    budgetHardStop: async (projectId) => {
      const status = await cost.budget.status(projectId);
      return status.ok && status.value.some((item) => item.blocking);
    },
  });
  return {
    orchestrator,
    writer,
    commands,
    runner,
    /** Recovered processes waiting for clarification answers stay open across restarts. */
    isClarifying: async (process: ProcessRecord) => {
      const id = pipelineRunIdSchema.safeParse(process.ref?.id);
      return id.success && (await repository.get(id.data))?.stage === 'clarifying';
    },
    /**
     * Rolls back interrupted write transactions in every project and closes interrupted runs, then reports the
     * count in the same tick (system.ready must precede responses to requests sent during startup).
     */
    recoverWorkspaces: async (onRecovered: (recoveredTransactions: number) => void) => {
      let recoveredTransactions = 0;
      for (const project of await projects.repository.list()) {
        const recoveredIds = new Set<string>();
        const recovered = await journalRecovery.recover(project.workspaceRoot, (id) => recoveredIds.add(id));
        if (recovered.ok) {
          recoveredTransactions += recovered.value;
        } else
          logger.error(
            { svc: 'journal-recovery', projectId: project.id, remediation: recovered.error.remediation },
            'Journal recovery failed',
          );
        await recoverInterruptedRuns({
          projectId: project.id,
          recoveredTransactions: recoveredIds,
          repository,
          reports,
          events,
          clock,
        });
      }
      onRecovered(recoveredTransactions);
    },
  };
}

export type PipelineModule = ReturnType<typeof createPipelineModule>;
export type { CommandRunner } from './services/command-runner.js';
export { WriteTransactionService } from './services/write-transaction.js';
export { registerPipelineRpc } from './rpc.js';
