import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ProjectId } from '@itstudio/schemas';
import { projectSchema } from '../../src/kernel/validation/projects.js';
import { startSidecar, type SidecarHarness, waitFor } from './harness.js';

let nextRawId = 90_000;

export async function makeProject(
  harness: SidecarHarness,
  name = 'Break test',
): Promise<{ id: ProjectId; root: string }> {
  const root = join(harness.dataDir, `workspace-${String(nextRawId++)}`);
  await mkdir(root, { recursive: true });
  const response = await harness.call('project.create', { name, workspaceRoot: root });
  return { id: projectSchema.parse(response.result).id, root };
}

export async function rawRequest(
  harness: SidecarHarness,
  request: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const id = typeof request.id === 'number' ? request.id : nextRawId++;
  const response = new Promise<unknown>((resolveResponse) => {
    const listener = (line: string): void => {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      const envelope = z.object({ id: z.number().nullable().optional() }).safeParse(value);
      if (envelope.success && envelope.data.id === id) {
        harness.notifications.off('line', listener);
        resolveResponse(value);
      }
    };
    harness.notifications.on('line', listener);
  });
  harness.writeLine(JSON.stringify({ jsonrpc: '2.0', ...request, id }));
  await waitFor(() => harness.stdoutLines.some((line) => line.includes(`"id":${String(id)}`)));
  return response;
}

export async function waitForLine(
  harness: SidecarHarness,
  predicate: (line: string) => boolean,
  timeoutMs = 10_000,
): Promise<string> {
  await waitFor(() => harness.stdoutLines.some(predicate), timeoutMs);
  const found = harness.stdoutLines.find(predicate);
  if (found === undefined) throw new Error('Expected protocol response was not observed');
  return found;
}

export { startSidecar, waitFor };
export type { SidecarHarness };
