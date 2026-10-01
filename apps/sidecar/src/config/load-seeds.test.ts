import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSeeds } from './load-seeds.js';

describe('loadSeeds', () => {
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
