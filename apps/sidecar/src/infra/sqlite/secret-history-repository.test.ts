import { describe, expect, it } from 'vitest';
import { SecretHistoryRepository } from './secret-history-repository.js';
import { openDatabase, applyMigrations, type AppDatabase } from './database.js';
import { secretHistoryEntrySchema } from '../../validation/models.js';

describe('SecretHistoryRepository', () => {
  it('roundtrips masked history through the migrated SQLite database with filters and limits', () => {
    const opened = openDatabase(':memory:');
    try {
      const repository = new SecretHistoryRepository(opened.db);
      const entries = [
        {
          id: '123e4567-e89b-42d3-a456-426614174001',
          provider: 'openai',
          hint: '1234',
          action: 'saved',
          resultCode: null,
          at: '2026-10-04T00:00:00.000Z',
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174002',
          provider: 'google',
          hint: '5678',
          action: 'verify_failed',
          resultCode: 'PROVIDER_AUTH',
          at: '2026-10-04T00:01:00.000Z',
        },
        {
          id: '123e4567-e89b-42d3-a456-426614174003',
          provider: 'openai',
          hint: '1234',
          action: 'deleted',
          resultCode: null,
          at: '2026-10-04T00:02:00.000Z',
        },
      ].map((entry) => secretHistoryEntrySchema.parse(entry));
      for (const entry of entries) repository.append(entry);
      applyMigrations(opened.db);
      expect(repository.list(undefined, 50)).toEqual([...entries].reverse());
      expect(repository.list('openai', 1)).toEqual([entries[2]]);
      expect(repository.list('google', 50)).toEqual([entries[1]]);
      expect(Object.keys(repository.list(undefined, 1)[0] ?? {})).toEqual([
        'id',
        'provider',
        'hint',
        'action',
        'resultCode',
        'at',
      ]);
    } finally {
      opened.client.close();
    }
  });

  it('stores only masked history data and returns validated entries', () => {
    const entry = secretHistoryEntrySchema.parse({
      id: '123e4567-e89b-42d3-a456-426614174000',
      provider: 'openai',
      hint: '9876',
      action: 'saved',
      resultCode: null,
      at: '2026-10-02T12:00:00.000Z',
    });
    let inserted: Readonly<Record<string, unknown>> | undefined;
    let whereCalled = false;
    let requestedLimit = 0;
    const row = { ...entry };
    const query = {
      all: () => [row],
      limit: (limit: number) => {
        requestedLimit = limit;
        return query;
      },
      orderBy: () => query,
      where: () => {
        whereCalled = true;
        return query;
      },
    };
    const database = {
      insert: () => ({ values: (value: Readonly<Record<string, unknown>>) => ({ run: () => (inserted = value) }) }),
      select: () => ({ from: () => query }),
    } as unknown as AppDatabase;
    const repository = new SecretHistoryRepository(database);

    repository.append(entry);
    expect(inserted).toEqual({
      id: entry.id,
      provider: 'openai',
      hint: '9876',
      action: 'saved',
      resultCode: null,
      at: entry.at,
    });
    expect(JSON.stringify(inserted)).not.toContain('secret');
    expect(repository.list('openai', 1)).toEqual([entry]);
    expect(whereCalled).toBe(true);
    expect(requestedLimit).toBe(1);
  });
});
