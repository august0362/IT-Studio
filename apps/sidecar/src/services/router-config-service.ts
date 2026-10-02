import type { AppError, Result, RouterConfig } from '@itstudio/schemas';
import type { SettingsService } from './settings-service.js';
import type { ModelRegistry } from './model-registry.js';
import { routerConfigSchema } from '../validation/router.js';

export interface RouterConfigServiceDependencies {
  readonly settings: SettingsService;
  readonly models: ModelRegistry;
}

export class RouterConfigService {
  private readonly settings: SettingsService;
  private readonly models: ModelRegistry;

  constructor(dependencies: RouterConfigServiceDependencies) {
    this.settings = dependencies.settings;
    this.models = dependencies.models;
  }

  async getConfig(): Promise<Result<RouterConfig>> {
    const settings = await this.settings.get();
    return settings.ok ? { ok: true, value: settings.value.router } : settings;
  }

  async updateConfig(input: RouterConfig): Promise<Result<RouterConfig>> {
    const parsed = routerConfigSchema.safeParse(input);
    if (!parsed.success) return validationError('Router configuration failed validation');
    const config = parsed.data;
    const priorities = config.ladder.map((entry) => entry.priority);
    if (new Set(priorities).size !== priorities.length || priorities.some((priority) => priority < 1)) {
      return validationError('Router ladder priorities must be unique positive integers');
    }
    if (config.ladder.some((entry) => !this.models.get(entry.modelKey))) {
      return validationError('Router ladder contains an unknown model');
    }
    if (config.lockedModelKey !== null && !this.models.get(config.lockedModelKey)) {
      return validationError('Locked model does not exist');
    }
    if (config.ladder.some((entry) => entry.maxRetries < 0 || entry.maxRetries > 5)) {
      return validationError('maxRetries must be between 0 and 5');
    }
    if (config.ladder.some((entry) => entry.timeoutMs < 5_000 || entry.timeoutMs > 300_000)) {
      return validationError('timeoutMs must be between 5000 and 300000');
    }
    if (config.userDecisionTimeoutMs < 10_000 || config.userDecisionTimeoutMs > 600_000) {
      return validationError('userDecisionTimeoutMs must be between 10000 and 600000');
    }

    const ladder = [...config.ladder]
      .sort((left, right) => left.priority - right.priority)
      .map((entry, index) => ({ ...entry, priority: index + 1 }));
    const updated = await this.settings.update({ router: { ...config, ladder } });
    return updated.ok ? { ok: true, value: updated.value.router } : updated;
  }
}

function validationError(message: string): Result<never> {
  const error: AppError = {
    code: 'VALIDATION',
    message,
    remediation: ['Review the router configuration and try again.'],
    retryable: false,
  };
  return { ok: false, error };
}
