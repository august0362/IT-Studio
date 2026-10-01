import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CommandSpec,
  EmbeddingConfig,
  LadderEntry,
  ModelDescriptor,
  ModelKey,
  PriceTable,
  RoleAssignment,
  Result,
  ThemeCatalog,
} from '@itstudio/schemas';
import { parse, providerIdSchema, modelKeySchema, z } from '../validation/common.js';
import { modelDescriptorSchema } from '../validation/models.js';
import { ladderEntrySchema } from '../validation/router.js';
import { roleAssignmentSchema } from '../validation/pipeline.js';
import { embeddingConfigSchema } from '../validation/rag.js';
import { priceTableSchema } from '../validation/cost.js';
import { commandSpecSchema } from '../validation/worker.js';
import { themeCatalogSchema } from '../validation/image.js';

interface FxConfig {
  readonly sourceUrl: string;
  readonly vndField: string;
  readonly updateIntervalHours: number;
  readonly seedUsdToVnd: number;
  readonly seedAsOf: string;
}

interface Seeds {
  readonly models: readonly ModelDescriptor[];
  readonly defaultLadder: readonly LadderEntry[];
  readonly defaultRoleAssignment: RoleAssignment;
  readonly defaultEmbedding: EmbeddingConfig;
  readonly defaultPricingExtractionModel: ModelKey;
  readonly pricing: PriceTable;
  readonly fx: FxConfig;
  readonly pricingSources: Readonly<Record<string, readonly string[]>>;
  readonly commands: readonly CommandSpec[];
  readonly themes: ThemeCatalog;
  readonly warnings: readonly string[];
}

const modelsFileSchema = z.object({
  models: z.array(modelDescriptorSchema),
  defaultLadder: z.array(ladderEntrySchema),
  defaultRoleAssignment: roleAssignmentSchema,
  defaultEmbedding: embeddingConfigSchema,
  defaultPricingExtractionModel: modelKeySchema,
});
const fxSchema = z.object({
  sourceUrl: z.string(),
  vndField: z.string(),
  updateIntervalHours: z.number(),
  seedUsdToVnd: z.number(),
  seedAsOf: z.string(),
});
const pricingSourcesSchema = z.record(providerIdSchema, z.array(z.string()));

function readJson(configDir: string, name: string): unknown {
  return JSON.parse(readFileSync(join(configDir, name), 'utf8'));
}

function validationFailure(message: string): Result<Seeds> {
  return {
    ok: false,
    error: { code: 'VALIDATION', message, retryable: false, details: { issues: [{ path: '', message }] } },
  };
}

export function loadSeeds(configDir: string): Result<Seeds> {
  try {
    const modelParse = parse(modelsFileSchema, readJson(configDir, 'models.seed.json'));
    if (!modelParse.ok) return modelParse;
    const pricingParse = parse(priceTableSchema, readJson(configDir, 'pricing.seed.json'));
    if (!pricingParse.ok) return pricingParse;
    const fxParse = parse(fxSchema, readJson(configDir, 'fx.json'));
    if (!fxParse.ok) return fxParse;
    const sourcesParse = parse(pricingSourcesSchema, readJson(configDir, 'pricing.sources.json'));
    if (!sourcesParse.ok) return sourcesParse;
    const commandsParse = parse(z.array(commandSpecSchema), readJson(configDir, 'commands.default.json'));
    if (!commandsParse.ok) return commandsParse;
    const themesParse = parse(themeCatalogSchema, readJson(configDir, 'themes.json'));
    if (!themesParse.ok) return themesParse;

    const modelKeys = new Set(modelParse.value.models.map((model) => model.key));
    const references = [
      ...modelParse.value.defaultLadder.map((item) => item.modelKey),
      ...Object.values(modelParse.value.defaultRoleAssignment).flat(),
      modelParse.value.defaultEmbedding.modelKey,
      ...modelParse.value.defaultEmbedding.fallbackModelKeys,
      modelParse.value.defaultPricingExtractionModel,
    ];
    const missingModel = references.find((key) => !modelKeys.has(key));
    if (missingModel !== undefined) return validationFailure(`Unknown model key: ${missingModel}`);

    const priorities = modelParse.value.defaultLadder.map((item) => item.priority);
    if (new Set(priorities).size !== priorities.length)
      return validationFailure('Default ladder priorities must be unique');
    const pricedModels = new Set(pricingParse.value.entries.map((entry) => entry.modelKey));
    const warnings = modelParse.value.models
      .filter((model) => model.enabled && !pricedModels.has(model.key))
      .map((model) => `Enabled model has no price entry: ${model.key}`);
    const seedData: Seeds = {
      ...modelParse.value,
      pricing: pricingParse.value,
      fx: fxParse.value,
      pricingSources: sourcesParse.value,
      commands: commandsParse.value,
      themes: themesParse.value,
      warnings,
    };
    return { ok: true, value: seedData };
  } catch {
    return validationFailure('Unable to read or parse seed configuration');
  }
}
