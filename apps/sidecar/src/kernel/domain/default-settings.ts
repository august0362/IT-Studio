import type {
  AppSettings,
  CommandSpec,
  EmbeddingConfig,
  ImageProviderId,
  LadderEntry,
  ModelKey,
  RoleAssignment,
  ThemeCatalog,
  ProviderId,
} from '@itstudio/schemas';
import { OPENAI_COMPATIBLE_BASE_URLS } from './provider-endpoints.js';
import { DEFAULT_WEB_CHAT_SETTINGS } from './web-chat.js';
import { microUsd } from './cost.js';

export interface Seeds {
  readonly defaultLadder: readonly LadderEntry[];
  readonly defaultRoleAssignment: RoleAssignment;
  readonly defaultEmbedding: EmbeddingConfig;
  readonly defaultPricingExtractionModel: ModelKey;
  readonly commands: readonly CommandSpec[];
  readonly themes: ThemeCatalog;
}

const IMAGE_PROVIDER_ORDER: readonly ImageProviderId[] = ['openai_dalle3', 'flux_together', 'flux_replicate'];

export function buildDefaultSettings(seeds: Seeds): AppSettings {
  const orchAgent = (
    agentId: string,
    role: 'supervisor' | 'worker' | 'reviewer',
    providerId: ProviderId,
    modelId: string,
  ) => ({ agentId, role, transport: 'api' as const, providerId, modelId });
  return {
    activeProjectId: null,
    providers: { qwen: { baseUrl: OPENAI_COMPATIBLE_BASE_URLS.qwen } },
    router: {
      ladder: [...seeds.defaultLadder],
      autoFallback: true,
      lockedModelKey: null,
      circuitBreaker: { failureThreshold: 3, cooldownMs: 120000 },
      userDecisionTimeoutMs: 120000,
    },
    budget: { hardStop: false },
    pricing: {
      autoUpdate: false,
      updateIntervalHours: 24,
      maxAutoChangePercent: 50,
      extractionModelKey: seeds.defaultPricingExtractionModel,
    },
    fx: { autoUpdate: true, manualUsdToVnd: null },
    vscode: {
      closeWithStudio: true,
      closeWithProject: true,
      closeManuallyOpened: false,
      autoLaunch: true,
      codeExecutable: null,
      showDiffBeforeValidate: true,
      revealChangedFiles: true,
    },
    pipeline: {
      roleAssignment: seeds.defaultRoleAssignment,
      validationCommands: [...seeds.commands],
      maxFixAttempts: 1,
      autoClarify: false,
    },
    rag: {
      embedding: seeds.defaultEmbedding,
      chunking: { targetTokens: 500, overlapTokens: 80, respectHeadings: true },
      defaultTopK: 6,
      minScore: 0.35,
    },
    image: { enabled: false, providerOrder: IMAGE_PROVIDER_ORDER },
    ui: { themeId: seeds.themes.defaultLight, mode: 'system', locale: 'en' },
    webChat: DEFAULT_WEB_CHAT_SETTINGS,
    orchestration: {
      roles: {
        supervisor: orchAgent('orch-supervisor', 'supervisor', 'anthropic', 'claude-sonnet-5-5'),
        workerA: orchAgent('orch-worker-a', 'worker', 'openrouter', 'deepseek/deepseek-v4-flash'),
        workerB: orchAgent('orch-worker-b', 'worker', 'openai', 'gpt-5.3-codex'),
        reviewer: orchAgent('orch-reviewer', 'reviewer', 'openai', 'gpt-5.3-codex'),
      },
      limits: {
        maxCostMicroUsd: microUsd(2_000_000),
        maxWallClockMs: 3_600_000,
        maxAgentCalls: 40,
        maxConcurrentWorkers: 2,
        maxFixRounds: 2,
        transientRetries: 1,
        hardStop: false,
      },
    },
  };
}
