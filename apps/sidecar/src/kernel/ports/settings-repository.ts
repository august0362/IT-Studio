export interface StoredSettings {
  readonly json: string;
  readonly updatedAt: string;
}

export interface ISettingsRepository {
  load(): Promise<StoredSettings | null>;
  save(json: string, updatedAt: string): Promise<void>;
}
