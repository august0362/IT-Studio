import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createContainer } from './container.js';
import { createLogger } from './kernel/infra/logger.js';
import { MemorySecretStore } from './kernel/infra/memory-secret-store.js';
import type { Result, RpcNotificationMap } from '@itstudio/schemas';
import { providerIdSchema } from './kernel/validation/common.js';

const resources: { container: ReturnType<typeof createContainer>; root: string }[] = [];
afterEach(async () => {
  for (const { container, root } of resources) {
    container.processRegistry.stop();
    container.database.client.close();
    await rm(root, { recursive: true, force: true });
  }
  resources.length = 0;
});
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function setup(configureKey = true) {
  const root = mkdtempSync(join(tmpdir(), 'itstudio-process-component-'));
  const container = createContainer(
    { ITSTUDIO_E2E: '1', ITSTUDIO_E2E_LLM_TEXT: 'A composed chat reply.' },
    {
      dataDir: ':memory:',
      secretStore: new MemorySecretStore(),
      logger: createLogger({ streams: [] }),
      input: new PassThrough(),
      output: new PassThrough(),
      fxHttpClient: { request: () => Promise.resolve(Response.json({ rates: { VND: 26_300 } })) },
    },
  );
  resources.push({ container, root });
  const project = unwrap(await container.projectService.create('Process integration', root));
  const conversation = unwrap(await container.chatService.createConversation(project.id));
  const settings = unwrap(await container.settingsService.get());
  const first = settings.router.ladder[0];
  if (first === undefined) throw new Error('Seeded ladder required');
  unwrap(
    await container.settingsService.update({ router: { ...settings.router, ladder: [{ ...first, maxRetries: 0 }] } }),
  );
  const provider = providerIdSchema.parse(first.modelKey.split('/')[0]);
  if (configureKey) unwrap(await container.secretsService.set(provider, 'component-test-key'));
  return { container, project, conversation, provider };
}
function completion(container: ReturnType<typeof createContainer>, name: 'chat.completed' | 'chat.failed') {
  return new Promise<RpcNotificationMap[typeof name]>((resolveDone) => {
    const unsubscribe = container.events.subscribe(name, (event) => {
      unsubscribe();
      resolveDone(event);
    });
  });
}

describe('process registry composition with fake providers and real SQLite', () => {
  it('completes chat through router, ledger, registry persistence and typed process events', async () => {
    const { container, project, conversation } = await setup();
    const completed = completion(container, 'chat.completed');
    unwrap(await container.chatService.send(conversation.id, 'Track the actual composed services'));
    await completed;
    const records = unwrap(container.processRegistry.list({ projectId: project.id, kind: ['chat'], limit: 20 }));
    const record = records[0];
    expect(record).toMatchObject({
      status: 'ended',
      costText: expect.stringContaining('$') as unknown,
      ref: { type: 'conversation', id: conversation.id },
    });
    expect(record?.modules.map((module) => [module.id, module.state])).toEqual([
      ['input', 'done'],
      ['context', 'skipped'],
      ['router', 'done'],
      ['provider', 'done'],
      ['stream', 'done'],
      ['cost', 'done'],
      ['output', 'done'],
    ]);
    expect(record?.modules.find((module) => module.id === 'router')?.detail?.attempts).toEqual(expect.any(Array));
    container.processRegistry.flush();
    expect(unwrap(await container.chatService.getMessages(conversation.id))).toHaveLength(2);
  });

  it('dispatches a stopped chat retry through the owning service and creates a new process', async () => {
    const { container, project, conversation, provider } = await setup(false);
    const failed = completion(container, 'chat.failed');
    unwrap(await container.chatService.send(conversation.id, 'Resend the same turn'));
    await failed;
    const original = unwrap(container.processRegistry.list({ projectId: project.id, kind: ['chat'], limit: 20 }))[0];
    if (original === undefined) throw new Error('Missing stopped process');
    expect(original.status).toBe('stopped');
    unwrap(await container.secretsService.set(provider, 'component-test-key'));
    const completed = completion(container, 'chat.completed');
    const retried = unwrap(await container.processRegistry.retry(original.id));
    await completed;
    expect(retried.id).not.toBe(original.id);
    expect(unwrap(container.processRegistry.get(retried.id)).status).toBe('ended');
    expect(unwrap(container.processRegistry.get(original.id)).status).toBe('stopped');
    const messages = unwrap(await container.chatService.getMessages(conversation.id));
    expect(messages.filter((message) => message.role === 'user').map((message) => message.parts)).toEqual([
      [{ type: 'text', text: 'Resend the same turn' }],
      [{ type: 'text', text: 'Resend the same turn' }],
    ]);
  });
});
