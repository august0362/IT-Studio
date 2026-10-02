import type {
  AppSettings,
  CommandSpec,
  EmbeddingConfig,
  ImageProviderId,
  LadderEntry,
  ModelKey,
  RoleAssignment,
  ThemeCatalog,
} from '@itstudio/schemas';

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
  return {
    activeProjectId: null,
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
      autoLaunch: true,
      codeExecutable: null,
      showDiffBeforeValidate: true,
      revealChangedFiles: true,
    },
    pipeline: {
      roleAssignment: seeds.defaultRoleAssignment,
      validationCommands: [...seeds.commands],
      maxFixAttempts: 1,
    },
    rag: {
      embedding: seeds.defaultEmbedding,
      chunking: { targetTokens: 500, overlapTokens: 80, respectHeadings: true },
      defaultTopK: 6,
      minScore: 0.35,
    },
    image: { enabled: false, providerOrder: IMAGE_PROVIDER_ORDER },
    ui: { themeId: seeds.themes.defaultLight, mode: 'system', locale: 'en' },
  };
}
