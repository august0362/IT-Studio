import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppError, AppSettings, Result, SettingsPatch } from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../infra/clock.js';
import type { ISettingsRepository } from '../ports/settings-repository.js';
import { appSettingsSchema } from '../validation/settings.js';

export interface SettingsServiceDependencies {
  readonly repository: ISettingsRepository;
  readonly defaults: AppSettings;
  readonly dataDir: string;
  readonly themeIds: ReadonlySet<string>;
  readonly clock: IClock;
  readonly logger: Logger;
}

export class SettingsService {
  private readonly repository: ISettingsRepository;
  private readonly defaults: AppSettings;
  private readonly dataDir: string;
  private readonly themeIds: ReadonlySet<string>;
  private readonly clock: IClock;
  private readonly logger: Logger;

  constructor(dependencies: SettingsServiceDependencies) {
    this.repository = dependencies.repository;
    this.defaults = dependencies.defaults;
    this.dataDir = dependencies.dataDir;
    this.themeIds = dependencies.themeIds;
    this.clock = dependencies.clock;
    this.logger = dependencies.logger;
  }

  async get(): Promise<Result<AppSettings>> {
    const stored = await this.repository.load();
    if (stored === null) {
      await this.persist(this.defaults);
      return { ok: true, value: this.defaults };
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(stored.json) as unknown;
    } catch {
      return this.recoverCorrupted(stored.json, 'Settings row contains invalid JSON');
    }
    const upgraded = addMissingTopLevelDefaults(decoded, this.defaults);
    const parsed = appSettingsSchema.safeParse(upgraded);
    if (!parsed.success) return this.recoverCorrupted(stored.json, 'Settings row failed validation');
    if (!this.themeIds.has(parsed.data.ui.themeId)) {
      return this.recoverCorrupted(stored.json, 'Settings row refers to an unknown theme');
    }
    if (upgraded !== decoded) await this.persist(parsed.data);
    return { ok: true, value: parsed.data };
  }

  async update(patch: SettingsPatch): Promise<Result<AppSettings>> {
    if (patch.ui?.themeId !== undefined && !this.themeIds.has(patch.ui.themeId)) {
      return validationError('Unknown theme id');
    }
    const current = await this.get();
    if (!current.ok) return current;
    const candidate = mergeSettings(current.value, patch);
    const parsed = appSettingsSchema.safeParse(candidate);
    if (!parsed.success) {
      return validationError('Settings patch failed validation', {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    await this.persist(parsed.data);
    return { ok: true, value: parsed.data };
  }

  private async persist(value: AppSettings): Promise<void> {
    await this.repository.save(JSON.stringify(value), this.clock.now().toISOString());
  }

  private async recoverCorrupted(json: string, reason: string): Promise<Result<AppSettings>> {
    const stamp = this.clock.now().toISOString().replaceAll(':', '-');
    try {
      writeFileSync(join(this.dataDir, `settings_backup_${stamp}.json`), json, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      this.logger.error({ err: error }, 'Could not back up invalid settings');
      return {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: 'Invalid settings could not be backed up',
          remediation: ['Check that the application data folder is writable.'],
          retryable: false,
        },
      };
    }
    this.logger.warn({ backup: `settings_backup_${stamp}.json`, reason }, 'Invalid settings reset to defaults');
    await this.persist(this.defaults);
    return { ok: true, value: this.defaults };
  }
}

function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    ...current,
    ...patch,
    router: { ...current.router, ...patch.router },
    budget: { ...current.budget, ...patch.budget },
    pricing: { ...current.pricing, ...patch.pricing },
    fx: { ...current.fx, ...patch.fx },
    vscode: { ...current.vscode, ...patch.vscode },
    pipeline: { ...current.pipeline, ...patch.pipeline },
    rag: { ...current.rag, ...patch.rag },
    image: { ...current.image, ...patch.image },
    ui: { ...current.ui, ...patch.ui },
    webChat: { ...current.webChat, ...patch.webChat },
  };
}

function addMissingTopLevelDefaults(value: unknown, defaults: AppSettings): unknown {
  if (!isRecord(value)) return value;
  const stored = value;
  let changed = false;
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!(key in stored)) {
      merged[key] = defaultValue;
      changed = true;
    }
  }
  return changed ? merged : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validationError(message: string, details?: AppError['details']): Result<never> {
  return {
    ok: false,
    error: {
      code: 'VALIDATION',
      message,
      remediation: ['Review the setting values and try again.'],
      retryable: false,
      ...(details === undefined ? {} : { details }),
    },
  };
}
