import { describe, expect, it } from 'vitest';
import { applyMigrations, openDatabase } from './database.js';
import { projects, settings } from './schema.js';

describe('SQLite database', () => {
  it('applies migrations on a fresh in-memory database and is idempotent', () => {
    const opened = openDatabase(':memory:');
    expect(opened.client.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(opened.client.pragma('busy_timeout', { simple: true })).toBe(5000);
    applyMigrations(opened.db);
    expect(opened.db.select().from(projects).all()).toEqual([]);
    expect(opened.db.select().from(settings).all()).toEqual([]);
    opened.client.close();
  });
});
