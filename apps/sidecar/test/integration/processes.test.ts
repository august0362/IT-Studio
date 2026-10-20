import { afterEach, describe, expect, it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProcessRecord, RpcNotificationMap } from '@itstudio/schemas';
import { z } from 'zod';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';
import { appSettingsSchema } from '../../src/kernel/validation/settings.js';
import { projectSchema } from '../../src/kernel/validation/projects.js';
import { conversationSchema } from '../../src/kernel/validation/chat.js';
import { processEventSchema, processRecordSchema } from '../../src/kernel/validation/process.js';
import { pipelineRunSchema } from '../../src/kernel/validation/pipeline.js';
import { modelKeySchema, providerIdSchema } from '../../src/kernel/validation/common.js';

let sidecar: SidecarHarness | undefined;
afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

async function setup(outcomes: readonly string[]) {
  // Auto also tries the other chat models belonging to the keyed Google provider.
  sidecar = await startSidecar(
    {},
    {
      'google/gemini-3.8-flash': outcomes,
      'google/gemini-3.1-pro-preview': outcomes,
    },
  );
  const root = resolve(sidecar.dataDir, 'process-project');
  await mkdir(root);
  const project = projectSchema.parse(
    (await sidecar.call('project.create', { name: 'Processes', workspaceRoot: root })).result,
  );
  const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
  const first = settings.router.ladder[0];
  if (first === undefined) throw new Error('A seeded chat model is required');
  await sidecar.call('router.updateConfig', { config: { ...settings.router, ladder: [{ ...first, maxRetries: 0 }] } });
  const provider = providerIdSchema.parse(first.modelKey.split('/')[0]);
  await sidecar.call('secrets.set', {
    provider,
    apiKey: 'process-integration-only',
  });
  const conversation = conversationSchema.parse(
    (await sidecar.call('chat.createConversation', { projectId: project.id })).result,
  );
  const processEvents: RpcNotificationMap['process.event'][] = [];
  sidecar.notifications.on('notification', (raw: unknown) => {
    const envelope = z.object({ method: z.literal('process.event'), params: processEventSchema }).safeParse(raw);
    if (envelope.success) processEvents.push(envelope.data.params);
  });
  return { h: sidecar, project, conversation, processEvents, provider };
}

async function waitForStatus(h: SidecarHarness, id: ProcessRecord['id'], status: ProcessRecord['status']) {
  let record: ProcessRecord | undefined;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    record = processRecordSchema.parse((await h.call('process.get', { id })).result);
    if (record.status === status) return record;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  throw new Error(`Process did not become ${status}; last status: ${record?.status ?? 'missing'}`);
}
async function onlyChat(h: SidecarHarness, projectId: ProcessRecord['projectId']) {
  const result = await h.call('process.list', {
    kind: ['chat'],
    limit: 100,
    ...(projectId === undefined ? {} : { projectId }),
  });
  const records = processRecordSchema.array().parse(result.result);
  const record = records[0];
  if (record === undefined) throw new Error('Chat process was missing');
  return record;
}

describe('processes integration', () => {
  it('TC-PROC-001 chat send ends its module pipeline and includes a formatted cost', async () => {
    const { h, project, conversation, processEvents } = await setup(['stream:3']);
    await h.call('chat.send', { conversationId: conversation.id, text: 'Track a chat turn' });
    const initial = await onlyChat(h, project.id);
    const ended = await waitForStatus(h, initial.id, 'ended');
    expect(ended.ref).toEqual({ type: 'conversation', id: conversation.id });
    expect(ended.costText).toContain('$');
    expect(ended.modules.map(({ id, state }) => [id, state])).toEqual([
      ['input', 'done'],
      ['context', 'skipped'],
      ['router', 'done'],
      ['provider', 'done'],
      ['stream', 'done'],
      ['cost', 'done'],
      ['output', 'done'],
    ]);
    await waitFor(() =>
      processEvents.some(
        (event) => event.type === 'upsert' && event.process.id === ended.id && event.process.status === 'ended',
      ),
    );
    expect((await h.call('process.delete', { id: ended.id })).result).toEqual({ deleted: true });
  });

  it('TC-PROC-002 a failed chat stops and retry creates a distinct process in the same conversation', async () => {
    const { h, project, conversation } = await setup(['http:503', 'ok']);
    await h.call('chat.send', { conversationId: conversation.id, text: 'Retry this message' });
    const initial = await onlyChat(h, project.id);
    await waitForStatus(h, initial.id, 'stopped');
    const retried = processRecordSchema.parse((await h.call('process.retry', { id: initial.id })).result);
    expect(retried.id).not.toBe(initial.id);
    expect(retried.ref).toEqual(initial.ref);
    await waitForStatus(h, retried.id, 'ended');
    expect(processRecordSchema.parse((await h.call('process.get', { id: initial.id })).result).status).toBe('stopped');
    expect((await h.call('process.dismiss', { id: initial.id })).result).toMatchObject({ status: 'ended' });
  });

  it('TC-PROC-003 restart changes a persisted running chat to stopped and preserves retry parameters', async () => {
    const { h, project, conversation, provider } = await setup(['delay:30000']);
    await h.call('chat.send', { conversationId: conversation.id, text: 'Survive a restart' });
    const initial = await onlyChat(h, project.id);
    expect(initial.status).toBe('running');
    // Persistence batches at 500 ms; leave the delayed provider running until the record is durable.
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 700));
    await h.kill();
    await h.restart();
    const stopped = processRecordSchema.parse((await h.call('process.get', { id: initial.id })).result);
    expect(stopped).toMatchObject({ status: 'stopped', statusReason: 'Interrupted by restart', retryable: true });
    // Restart clears the in-memory key store and resets the delayed script's cursor.
    expect((await h.call('secrets.set', { provider, apiKey: 'process-integration-only' })).error).toBeUndefined();
    const retried = processRecordSchema.parse((await h.call('process.retry', { id: initial.id })).result);
    expect(retried.id).not.toBe(initial.id);
    await waitForStatus(h, retried.id, 'running');
    expect((await h.call('process.cancel', { id: retried.id })).result).toMatchObject({ status: 'stopped' });
    await waitForStatus(h, retried.id, 'stopped');
  });
});

it('TC-OWNER-FB3-015 PM questions keep Spec idle, Clarify waiting, and stopped deletion emits removed', async () => {
  const questions = [
    {
      id: 'storage',
      question: 'Where to store data?',
      why: 'Choose storage',
      options: [
        { id: 'local', label: 'Local' },
        { id: 'cloud', label: 'Cloud' },
      ],
      recommendedOptionId: 'local',
      recommendationReason: 'Offline',
    },
  ];
  sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: JSON.stringify({ kind: 'questions', questions }) });
  const h = sidecar;
  const root = resolve(h.dataDir, 'questions-project');
  await mkdir(root);
  const project = projectSchema.parse(
    (await h.call('project.create', { name: 'Questions', workspaceRoot: root })).result,
  );
  await h.call('secrets.set', { provider: providerIdSchema.parse('deepseek'), apiKey: 'integration-only-key' });
  const key = modelKeySchema.parse('deepseek/deepseek-v4-flash');
  await h.call('settings.update', {
    patch: { pipeline: { autoClarify: false, roleAssignment: { pm: [key], coder: [key], reviewer: [key] } } },
  });
  const run = pipelineRunSchema.parse(
    (await h.call('pipeline.start', { projectId: project.id, prompt: 'Build notes' })).result,
  );
  await waitFor(() => h.stdoutLines.some((line) => line.includes('clarifying')));
  const record = processRecordSchema
    .array()
    .parse((await h.call('process.list', { projectId: project.id, kind: ['code_pipeline'], limit: 100 })).result)[0];
  if (record === undefined) throw new Error('Missing process');
  const waiting = await waitForStatus(h, record.id, 'waiting');
  expect(waiting.modules.find((module) => module.id === 'spec')).toMatchObject({ state: 'idle' });
  expect(waiting.modules.find((module) => module.id === 'clarify')).toMatchObject({
    state: 'waiting',
    output: '1 questions · 0 answered',
  });
  expect((await h.call('process.delete', { id: record.id })).error?.data).toMatchObject({ code: 'VALIDATION' });
  await h.call('pipeline.cancel', { runId: run.id });
  await waitForStatus(h, record.id, 'stopped');
  expect((await h.call('process.delete', { id: record.id })).result).toEqual({ deleted: true });
  await waitFor(() => h.stdoutLines.some((line) => line.includes('removed') && line.includes(record.id)));
}, 30000);
