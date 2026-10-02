import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { startSidecar, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;

afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

describe('sidecar process integration', () => {
  it('TC-M1-002 first stdout line is system.ready', async () => {
    sidecar = await startSidecar();
    const first = z
      .object({ method: z.string(), params: z.object({ version: z.string() }) })
      .safeParse(JSON.parse(sidecar.stdoutLines[0] ?? 'null'));
    expect(first.success).toBe(true);
    if (first.success) {
      expect(first.data.method).toBe('system.ready');
      expect(first.data.params.version).toBe('0.1.0');
    }
  }, 30_000);

  it('TC-M1-003 stdout carries protocol only', async () => {
    const harness = await startSidecar();
    sidecar = harness;
    await Promise.all(Array.from({ length: 50 }, () => harness.call('system.ping')));
    expect(harness.stdoutLines.every((line) => JSON.parse(line) !== null)).toBe(true);
    expect(harness.stdoutLines.some((line) => line.includes('system.ping'))).toBe(false);
    expect(harness.stderr.join('')).not.toContain('system.ready');
  }, 30_000);

  it('TC-M1-007 sidecar can be killed while a request is in flight', async () => {
    const harness = await startSidecar();
    sidecar = harness;
    const pending = Array.from({ length: 100 }, () => harness.call('system.ping'));
    await harness.kill();
    const outcomes = await Promise.allSettled(pending);
    expect(
      outcomes.some(
        (outcome) => outcome.status === 'fulfilled' && outcome.value.error?.message === 'sidecar restarted',
      ),
    ).toBe(true);
  }, 30_000);
});
