import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { isoDateTimeSchema, microUsdSchema } from '../../validation/brand.js';
import { modelKeySchema, priceTableVersionSchema } from '../../validation/common.js';
import { openDatabase } from './database.js';
import { PriceRepository } from './price-repository.js';

it('V1-POLISH-01 preserves automatic price backups in SQLite after closing and reopening the database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'itstudio-prices-'));
  const key = modelKeySchema.parse('openai/test-model');
  const entry = {
    modelKey: key,
    inputPerMTokMicroUsd: microUsdSchema.parse(100),
    outputPerMTokMicroUsd: microUsdSchema.parse(200),
    cachedInputPerMTokMicroUsd: microUsdSchema.parse(50),
    freeTier: false,
    sourceUrl: 'https://example.invalid/prices',
  };
  const seed = {
    version: priceTableVersionSchema.parse('seed-test'),
    effectiveFrom: isoDateTimeSchema.parse('2026-10-01T00:00:00.000Z'),
    origin: 'seed' as const,
    entries: [entry],
  };
  let database = openDatabase(directory);
  try {
    const first = new PriceRepository(database.db);
    first.insert({ ...seed, manualOverrides: [] });
    expect(first.current()).not.toHaveProperty('automaticEntries');
    first.insert({
      ...seed,
      version: priceTableVersionSchema.parse('manual-test'),
      effectiveFrom: isoDateTimeSchema.parse('2026-10-01T00:00:01.000Z'),
      origin: 'manual_override',
      entries: [{ ...entry, origin: 'manual_override', inputPerMTokMicroUsd: microUsdSchema.parse(999) }],
      manualOverrides: [key],
      automaticEntries: [{ ...entry, origin: 'auto_extracted', inputPerMTokMicroUsd: microUsdSchema.parse(600) }],
    });
    database.client.close();
    database = openDatabase(directory);
    const restarted = new PriceRepository(database.db);
    expect(restarted.current()?.entries[0]?.inputPerMTokMicroUsd).toBe(999);
    expect(restarted.current()?.automaticEntries?.[0]).toMatchObject({
      inputPerMTokMicroUsd: 600,
      origin: 'auto_extracted',
    });
  } finally {
    database.client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
