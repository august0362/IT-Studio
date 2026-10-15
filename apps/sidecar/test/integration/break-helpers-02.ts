import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ProjectId } from '@itstudio/schemas';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { providerIdSchema } from '../../src/validation/common.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

export const responseSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
export const notificationSchema = z.object({ method: z.string(), params: z.unknown() });

export async function makeProject(sidecar: SidecarHarness, name: string) {
  const workspaceRoot = resolve(sidecar.dataDir, name.toLowerCase().replaceAll(' ', '-'));
  await mkdir(workspaceRoot, { recursive: true });
  const response = await sidecar.call('project.create', { name, workspaceRoot });
  return { workspaceRoot, projectId: projectSchema.parse(response.result).id };
}

export async function makeChat(sidecar: SidecarHarness, projectId: ProjectId) {
  const conversationId = conversationSchema.parse(
    (await sidecar.call('chat.createConversation', { projectId })).result,
  ).id;
  const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
  const modelKey = settings.router.ladder[0]?.modelKey;
  if (modelKey === undefined) throw new Error('No configured router model');
  const provider = providerIdSchema.parse(modelKey.split('/')[0]);
  const providers = new Set(
    settings.router.ladder.map((entry) => providerIdSchema.parse(entry.modelKey.split('/')[0])),
  );
  for (const routerProvider of providers) {
    await sidecar.call('secrets.set', {
      provider: routerProvider,
      apiKey: `integration-only-${routerProvider}-break02`,
    });
  }
  return { conversationId, modelKey, provider };
}

export function observed<T>(sidecar: SidecarHarness, method: string): T[] {
  return sidecar.stdoutLines.flatMap((line) => {
    try {
      const parsed = notificationSchema.safeParse(JSON.parse(line));
      return parsed.success && parsed.data.method === method ? [parsed.data.params as T] : [];
    } catch {
      return [];
    }
  });
}

export async function waitUntil(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  await waitFor(predicate, timeoutMs);
}

export async function startOnDir(dataDir: string, env: Readonly<Record<string, string>> = {}): Promise<SidecarHarness> {
  return startSidecar({ ...env, ITSTUDIO_DATA_DIR: dataDir });
}

export async function makeDataDir(): Promise<string> {
  return mkdtemp(resolve(tmpdir(), 'itstudio-break02-'));
}

export async function removeDataDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
