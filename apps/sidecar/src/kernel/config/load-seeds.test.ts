import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSeeds } from './load-seeds.js';

describe('loadSeeds', () => {
  it('PROV-01 loads ten enabled provider models with unverified prices and preserves default ladders', () => {
    const loaded = loadSeeds('config');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const providers = ['deepseek', 'openrouter', 'qwen', 'mistral'];
    const added = loaded.value.models.filter((model) => providers.includes(model.provider));
    expect(added).toHaveLength(10);
    expect(loaded.value.pricing.origin).toBe('seed');
    for (const model of loaded.value.models) {
      expect(loaded.value.pricing.entries.some((entry) => entry.modelKey === model.key)).toBe(true);
    }
    for (const model of added) {
      expect(model.enabled).toBe(true);
      expect(model.key).toBe(model.provider + '/' + model.providerModelId);
      expect(loaded.value.pricingSources[model.provider]?.length).toBeGreaterThan(0);
      expect(loaded.value.defaultLadder.some((entry) => entry.modelKey === model.key)).toBe(false);
      expect(Object.values(loaded.value.defaultRoleAssignment).flat()).not.toContain(model.key);
    }
    expect(added.find((model) => model.key === 'openrouter/deepseek/deepseek-v4-flash')).toMatchObject({
      provider: 'openrouter',
      providerModelId: 'deepseek/deepseek-v4-flash',
    });
  });
  it('loads committed config and rejects a bad ladder model key', async () => {
    const loaded = loadSeeds(join(process.cwd(), 'config'));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.warnings).toEqual([]);
    const temp = await mkdtemp(join(tmpdir(), 'itstudio-seeds-'));
    try {
      await cp(join(process.cwd(), 'config'), temp, { recursive: true });
      const modelPath = join(temp, 'models.seed.json');
      const models: unknown = JSON.parse(await readFile(modelPath, 'utf8'));
      if (
        typeof models !== 'object' ||
        models === null ||
        !('defaultLadder' in models) ||
        !Array.isArray(models.defaultLadder)
      )
        throw new Error('Unexpected seed test fixture');
      const first: unknown = models.defaultLadder[0];
      if (typeof first !== 'object' || first === null) throw new Error('Unexpected ladder fixture');
      Object.assign(first, { modelKey: 'openai/missing-model' });
      await writeFile(modelPath, JSON.stringify(models));
      const bad = loadSeeds(temp);
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.code).toBe('VALIDATION');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
