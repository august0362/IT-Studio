import { dirname } from 'node:path';
import { CostPurpose, ErrorCode, ModelCapability, type MicroUsd, type OrchRunId } from '@itstudio/schemas';
import { isSea } from '../../kernel/infra/native-modules.js';
import { NodeProcessRunner } from '../../kernel/infra/node-process-runner.js';
import type { ModuleContext } from '../../kernel/module-context.js';
import {
  conversationIdSchema,
  isoDateTimeSchema,
  llmRequestIdSchema,
  messageIdSchema,
  projectIdSchema,
} from '../../kernel/validation/brand.js';
import { modelKeySchema } from '../../kernel/validation/common.js';
import type { CostModule } from '../cost/index.js';
import type { PipelineModule } from '../pipeline/index.js';
import type { ProcessRegistry } from '../processes/index.js';
import type { ProjectsModule } from '../projects/index.js';
import type { RouterModule } from '../router/index.js';
import type { SettingsService } from '../settings/index.js';
import { ApiAgentAdapter } from './adapters/api-adapter.js';
import { ClaudeCliAdapter } from './adapters/claude-cli-adapter.js';
import { CodexCliAdapter } from './adapters/codex-cli-adapter.js';
import { createOrchestrationModule } from './orchestration-module.js';
import { buildAgentPrompt, extractJsonObjects } from './prompts.js';
import { OrchRepository } from './storage/orch-repository.js';
import { OrchWorkspace } from './workspace.js';
import { WorktreeManager } from './worktrees.js';

export interface OrchestrationWiringDependencies {
  readonly processes: Pick<ProcessRegistry, 'upsertOrchestration'>;
  readonly settings: SettingsService;
  readonly router: RouterModule;
  readonly cost: CostModule;
  readonly pipeline: PipelineModule;
  readonly projects: ProjectsModule;
}

/** Builds the orchestration module with the real agent adapters (API via the router, Claude and Codex CLIs). */
export function createOrchestration(ctx: ModuleContext, deps: OrchestrationWiringDependencies) {
  const { env, ids, clock } = ctx;
  const { runner: workerProcessRunner, commands, writer } = deps.pipeline;
  const projectRepository = deps.projects.repository;
  const orchProcessRunner = new NodeProcessRunner();
  // Orchestration must never target IT Studio itself: the install folder when packaged, the source
  // repository in development (the dev shell starts the sidecar there). A packaged app's cwd is arbitrary.
  const itStudioRoot = isSea() ? dirname(process.execPath) : process.cwd();
  return createOrchestrationModule({
    repository: new OrchRepository(ctx.db),
    processes: deps.processes,
    workspace: new OrchWorkspace({
      projects: projectRepository,
      worktrees: new WorktreeManager(workerProcessRunner),
      apply: { runner: workerProcessRunner, fileSystem: ctx.fileSystem, commands, writer },
      runner: workerProcessRunner,
      sidecarCwd: itStudioRoot,
      appExecutableDir: dirname(process.execPath),
    }),
    adapters: [
      new ApiAgentAdapter(async ({ envelope, input, signal }) => {
        const modelKey = modelKeySchema.safeParse(
          envelope.modelId.startsWith(`${envelope.providerId}/`)
            ? envelope.modelId
            : `${envelope.providerId}/${envelope.modelId}`,
        );
        const requestId = llmRequestIdSchema.parse(ids.uuid());
        const response = await deps.router.router.dispatch(
          {
            id: requestId,
            projectId: projectIdSchema.parse(envelope.projectId),
            purpose:
              envelope.roleId === 'worker'
                ? CostPurpose.PIPELINE_CODER
                : envelope.roleId === 'reviewer'
                  ? CostPurpose.PIPELINE_REVIEWER
                  : CostPurpose.PIPELINE_PM,
            messages: [
              {
                id: messageIdSchema.parse(ids.uuid()),
                conversationId: conversationIdSchema.parse(ids.uuid()),
                role: 'user',
                createdAt: isoDateTimeSchema.parse(clock.now().toISOString()),
                parts: [{ type: 'text', text: buildAgentPrompt(envelope, input, { withAck: false }) }],
              },
            ],
            systemPrompt: `You are the ${envelope.roleId} agent of an IT Studio orchestration run. Follow the user message exactly and return one JSON object.`,
            requiredCapabilities: [ModelCapability.CHAT, ModelCapability.JSON_MODE],
            responseFormat: 'json',
            ...(envelope.modelId === 'mock' || !modelKey.success ? {} : { preferredModelKey: modelKey.data }),
            maxOutputTokens: envelope.roleId === 'worker' ? 16_384 : 8_192,
            stream: false,
          },
          { signal },
        );
        if (!response.ok) return response;
        const text = response.value.message.parts.find((part) => part.type === 'text');
        const payload = text === undefined ? undefined : extractJsonObjects(text.text)[0];
        // The router reports 0; the real cost is priced by the ledger. Unknown stays null, never 0.
        const recorded = await deps.cost.ledger.recordedCost(requestId);
        return payload === undefined
          ? {
              ok: false as const,
              error: { code: ErrorCode.VALIDATION, message: 'Agent returned no JSON object.', retryable: false },
            }
          : {
              ok: true as const,
              value: {
                payload,
                usage: {
                  inputTokens: response.value.usage.inputTokens,
                  outputTokens: response.value.usage.outputTokens,
                  cachedInputTokens: response.value.usage.cachedInputTokens,
                  reasoningTokens: null,
                  source: 'provider' as const,
                  costMicroUsd: recorded?.microUsd ?? null,
                  billing: 'api' as const,
                },
              },
            };
      }),
      new ClaudeCliAdapter(orchProcessRunner),
      new CodexCliAdapter(orchProcessRunner),
    ],
    includeMock: env.ITSTUDIO_E2E_ORCH_MOCK === '1' || process.env.NODE_ENV === 'test',
    ...(env.ITSTUDIO_E2E_ORCH_MOCK === '1'
      ? {
          scripts: {
            worker: () =>
              Promise.resolve({
                summary: 'Create the orchestration E2E fixture file.',
                operations: [
                  {
                    kind: 'create',
                    path: 'src/orchestration-e2e.ts',
                    content: 'export const orchestrationE2e = true;\n',
                  },
                ],
                assumptions: [],
              }),
          },
        }
      : {}),
    validate: { workspaceRoot: ctx.dataDir, allowedCommands: [] },
    runner: workerProcessRunner,
    projects: projectRepository,
    sidecarCwd: itStudioRoot,
    appExecutableDir: dirname(process.execPath),
    settings: async () => {
      const settings = await deps.settings.get();
      return settings.ok
        ? {
            ok: true as const,
            value: {
              orchestration: settings.value.orchestration,
              allowedCommands: settings.value.pipeline.validationCommands,
            },
          }
        : settings;
    },
    createRun: (projectId, request, specs, options) => {
      const now = isoDateTimeSchema.parse(clock.now().toISOString());
      return {
        id: (options?.id ?? ids.uuid()) as OrchRunId,
        projectId,
        request,
        state: 'plan_ready',
        agents: options?.agents ?? [
          { agentId: 'mock-supervisor', role: 'supervisor', transport: 'mock' },
          { agentId: 'mock-worker', role: 'worker', transport: 'mock' },
          { agentId: 'mock-reviewer', role: 'reviewer', transport: 'mock' },
        ],
        tasks: specs.map((spec) => ({ ...spec, state: 'ready' as const, fixRounds: 0, attempts: [] })),
        limits: options?.limits ?? {
          maxCostMicroUsd: 2_000_000 as MicroUsd,
          maxWallClockMs: 3_600_000,
          maxAgentCalls: 40,
          maxConcurrentWorkers: 2,
          maxFixRounds: 2,
          transientRetries: 1,
          hardStop: false,
        },
        targetBranch: options?.targetBranch ?? 'main',
        costMicroUsd: 0 as MicroUsd,
        agentCalls: 0,
        createdAt: now,
        updatedAt: now,
      };
    },
    publish: (event) => {
      ctx.events.publish('orch.event', event);
    },
  });
}
