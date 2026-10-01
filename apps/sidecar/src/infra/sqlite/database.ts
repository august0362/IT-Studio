import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

export function applyMigrations(database: AppDatabase, folder = migrationsFolder): void {
  migrate(database, { migrationsFolder: folder });
}

export function openDatabase(dataDir: string): { readonly client: Database.Database; readonly db: AppDatabase } {
  const inMemory = dataDir === ':memory:';
  if (!inMemory) mkdirSync(dataDir, { recursive: true });
  const filename = inMemory ? ':memory:' : join(dataDir, 'itstudio.db');
  const client = new Database(filename);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  client.pragma('busy_timeout = 5000');
  const db = drizzle(client, { schema });
  applyMigrations(db);
  return { client, db };
}
