import { afterEach, describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { secretStatusSchema } from '../../src/validation/models.js';
import { startSidecar, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('secret store integration', () => {
  it('TC-M1-031 validates API key length and character partitions', async () => {
    sidecar = await startSidecar();
    for (const apiKey of ['', '   ', 'x'.repeat(513), 'has space', 'has\nnewline']) {
      const response = await sidecar.call('secrets.set', { provider: 'openai', apiKey });
      expect(response.error?.data).toMatchObject({ code: 'VALIDATION' });
    }
    await expect(sidecar.call('secrets.set', { provider: 'openai', apiKey: 'x'.repeat(512) })).resolves.toMatchObject({
      result: { configured: true, hint: 'xxxx' },
    });
  }, 30_000);

  it('TC-M1-032 returns statuses for seven providers without key material', async () => {
    sidecar = await startSidecar();
    await sidecar.call('secrets.set', { provider: 'openai', apiKey: 'sk-TEST-secret-1234' });
    const response = await sidecar.call('secrets.status');
    const statuses = z.array(secretStatusSchema).safeParse(response.result);
    expect(statuses.success).toBe(true);
    if (statuses.success) {
      expect(statuses.data).toHaveLength(7);
      expect(statuses.data.find((status) => status.provider === 'openai')).toMatchObject({
        configured: true,
        hint: '1234',
      });
      expect(JSON.stringify(statuses.data)).not.toContain('sk-TEST-secret-1234');
    }
  }, 30_000);

  it('TC-M1-033 scripts verifier success, auth, server, and timeout outcomes', async () => {
    for (const [outcome, expectedCode] of [
      ['success', undefined],
      ['auth', 'PROVIDER_AUTH'],
      ['server', 'PROVIDER_SERVER'],
      ['timeout', 'PROVIDER_TIMEOUT'],
    ] as const) {
      sidecar = await startSidecar({ ITSTUDIO_E2E_VERIFIER_OUTCOME: outcome });
      await sidecar.call('secrets.set', { provider: 'openai', apiKey: 'test-key-1234' });
      const response = await sidecar.call('secrets.verify', { provider: 'openai' });
      if (expectedCode === undefined) expect(response.result).toMatchObject({ configured: true, hint: '1234' });
      else expect(response.error?.data).toMatchObject({ code: expectedCode });
      await sidecar.close();
      sidecar = undefined;
    }
  }, 90_000); // 4 sequential cold sidecar starts (~4 s each in dev, PERF-01) flake at 30 s under parallel load.

  it('TC-M1-034 never writes API key material to protocol, logs, or database', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_VERIFIER_OUTCOME: 'auth' });
    const secret = 'ITSTUDIO-TEST-KEY-DO-NOT-LEAK-9876';
    await sidecar.call('secrets.set', { provider: 'openai', apiKey: secret });
    await sidecar.call('secrets.verify', { provider: 'openai' });
    const files = await readdir(sidecar.dataDir, { withFileTypes: true });
    const content: string[] = [];
    for (const file of files) {
      if (file.isFile()) content.push((await readFile(join(sidecar.dataDir, file.name))).toString('utf8'));
      else if (file.isDirectory()) {
        const children = await readdir(join(sidecar.dataDir, file.name));
        for (const child of children)
          content.push((await readFile(join(sidecar.dataDir, file.name, child))).toString('utf8'));
      }
    }
    const observed = [sidecar.stdoutLines.join('\n'), sidecar.stderr.join(''), ...content].join('\n');
    expect(observed).not.toContain(secret);
  }, 30_000);
});
