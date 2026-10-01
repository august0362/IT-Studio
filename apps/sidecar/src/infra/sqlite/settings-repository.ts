import { eq } from 'drizzle-orm';
import type { AppDatabase } from './database.js';
import { settings } from './schema.js';
import type { ISettingsRepository, StoredSettings } from '../../ports/settings-repository.js';

export class SettingsRepository implements ISettingsRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  load(): Promise<StoredSettings | null> {
    const row = this.db.select().from(settings).where(eq(settings.id, 1)).get();
    return Promise.resolve(row === undefined ? null : { json: row.json, updatedAt: row.updatedAt });
  }

  save(json: string, updatedAt: string): Promise<void> {
    this.db
      .insert(settings)
      .values({ id: 1, json, updatedAt })
      .onConflictDoUpdate({
        target: settings.id,
        set: { json, updatedAt },
      })
      .run();
    return Promise.resolve();
  }
}
