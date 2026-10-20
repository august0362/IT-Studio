import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ProcessEvent, ProcessId, ProcessKind, RpcNotificationMap } from '@itstudio/schemas';
import { createFakeClock } from '../../../kernel/infra/clock.js';
import { createLogger } from '../../../kernel/infra/logger.js';
import { EventBus } from '../../../kernel/rpc/event-bus.js';
import type { IProcessRepository, ProcessOperation, StoredProcess } from '../../../kernel/ports/process-tracker.js';
import { conversationIdSchema, projectIdSchema } from '../../../kernel/validation/brand.js';
import { processGraph } from '../../../kernel/domain/process-graphs.js';
import { processEventSchema, processListSchema, processReportSchema } from '../../../kernel/validation/process.js';
import { ProcessRegistry, type ProcessRegistryDependencies } from './process-registry.js';

class MemoryProcesses implements IProcessRepository {
  readonly rows = new Map<ProcessId, StoredProcess>();
  readonly save = vi.fn<IProcessRepository['save']>((records, removed) => {
    for (const id of removed) this.rows.delete(id);
    for (const record of records) this.rows.set(record.process.id, record);
  });
  load() {
    return [...this.rows.values()];
  }
}
const registries: ProcessRegistry[] = [];
afterEach(() => {
  registries.forEach((registry) => {
    registry.stop();
  });
  registries.length = 0;
  vi.useRealTimers();
});
function setup(
  options: Partial<Pick<ProcessRegistryDependencies, 'dispatch' | 'cancelRecovered'>> = {},
  repository = new MemoryProcesses(),
) {
  const events = new EventBus<RpcNotificationMap>();
  const observed: ProcessEvent[] = [];
  events.subscribe('process.event', (event) => {
    processEventSchema.parse(event);
    observed.push(event);
  });
  const clock = createFakeClock(new Date('2026-10-16T00:00:00.000Z'));
  const dispatch = vi.fn<ProcessRegistryDependencies['dispatch']>(
    options.dispatch ?? (() => Promise.resolve({ ok: true, value: undefined })),
  );
  const registry = new ProcessRegistry({
    repository,
    events,
    clock,
    ids: { uuid: randomUUID },
    logger: createLogger({ streams: [] }),
    dispatch,
    cancelRecovered: options.cancelRecovered ?? (() => Promise.resolve({ ok: true, value: undefined })),
  });
  registries.push(registry);
  return { registry, repository, events, observed, clock, dispatch };
}
const projectId = projectIdSchema.parse('20000000-0000-4000-8000-000000000001');
const conversationId = conversationIdSchema.parse('30000000-0000-4000-8000-000000000001');
const operations: readonly ProcessOperation[] = [
  { kind: 'chat', params: { conversationId, text: 'Hello' } },
  { kind: 'code_pipeline', params: { projectId, prompt: 'Build notes' } },
  { kind: 'knowledge_ingest', params: { projectId, paths: ['guide.md'], tags: ['manual'] } },
  { kind: 'image', params: { projectId, args: { prompt: 'A cat' } } },
  { kind: 'price_update', params: { projectId, modelKey: 'openai/test' } },
  { kind: 'key_verify', params: { provider: 'openai' } },
];

describe('process registry', () => {
  it('keeps dirty records after a failed persistence batch and retries the write', () => {
    vi.useFakeTimers();
    const h = setup();
    h.repository.save.mockImplementationOnce(() => {
      throw new Error('Database busy');
    });
    const id = h.registry.start('image', { title: 'Persist me' });
    vi.advanceTimersByTime(500);
    expect(h.repository.rows.has(id)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(h.repository.rows.has(id)).toBe(true);
    expect(h.repository.save).toHaveBeenCalledTimes(2);
  });

  it('does not sweep operations started during recovery and removes stale waiting reasons on module activation', async () => {
    const h = setup();
    const waiting = h.registry.start('code_pipeline', { title: 'Clarifying' });
    h.registry.status(waiting, 'waiting', 'Queued');
    h.registry.flush();
    h.registry.stop();
    const restored = setup({}, h.repository);
    const fresh = restored.registry.start('vscode_launch', { title: 'New startup launch' });
    await restored.registry.recover(() => Promise.resolve(true));
    expect(restored.registry.get(fresh)).toMatchObject({ value: { status: 'running' } });
    restored.registry.module(waiting, 'clarify', { state: 'active' });
    const resumed = restored.registry.get(waiting);
    expect(resumed.ok && resumed.value.statusReason).toBeUndefined();
  });

  it('orders ended processes by transition order when timestamps tie, including after persistence', () => {
    const h = setup();
    const first = h.registry.start('chat', { title: 'First created' });
    const second = h.registry.start('chat', { title: 'Second created' });
    h.registry.end(second);
    h.registry.end(first);
    h.registry.flush();
    h.registry.stop();
    const restarted = setup({}, h.repository);
    const records = restarted.registry.list({ status: ['ended'], limit: 20 });
    expect(records.ok && records.value.map((record) => record.id)).toEqual([first, second]);
  });

  it('turns a module failure into a stopped process and closes a failed web-chat lifecycle', () => {
    const h = setup();
    const id = h.registry.start('image', { title: 'Image' });
    h.registry.module(id, 'prompt', { state: 'failed', output: 'Rejected' });
    expect(h.registry.get(id)).toMatchObject({ value: { status: 'stopped' } });
    const input = { kind: 'web_chat' as const, linkId: 'site' };
    h.registry.report({ ...input, event: 'opened' });
    h.registry.report({ ...input, event: 'failed' });
    expect(h.registry.report({ ...input, event: 'closed' })).toMatchObject({ value: { status: 'ended' } });
  });

  it('tracks modules, timestamps, waiting, completion and illegal actions', async () => {
    const h = setup();
    const id = h.registry.start('chat', {
      title: 'Chat',
      projectId,
      operation: { kind: 'chat', params: { conversationId, text: 'Hello' } },
    });
    expect(h.registry.get(id)).toMatchObject({
      ok: true,
      value: {
        status: 'running',
        modules: expect.arrayContaining([expect.objectContaining({ id: 'input', state: 'active' })]) as unknown,
      },
    });
    h.clock.advance(100);
    h.registry.module(id, 'input', { state: 'done', output: 'Received' });
    h.registry.module(id, 'router', { state: 'active' });
    h.registry.status(id, 'waiting', 'Waiting for your decision');
    expect(h.registry.get(id)).toMatchObject({ value: { status: 'waiting' } });
    h.registry.status(id, 'running');
    h.registry.annotate(id, { costText: '$0.0010', ref: { type: 'conversation', id: conversationId } });
    h.registry.end(id, 'Complete');
    const ended = h.registry.get(id);
    expect(ended).toMatchObject({
      value: { status: 'ended', result: 'Complete', costText: '$0.0010', endedAt: h.clock.now().toISOString() },
    });
    h.registry.status(id, 'running');
    h.registry.module(id, 'stream', { state: 'active' });
    h.registry.end(id, 'changed');
    expect(h.registry.get(id)).toEqual(ended);
    expect(await h.registry.cancel(id)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await h.registry.retry(id)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(h.registry.dismiss(id)).toMatchObject({ ok: false });
    expect(h.registry.delete(id)).toEqual({ ok: true, value: { deleted: true } });
    expect(h.registry.delete(id)).toEqual({ ok: true, value: { deleted: false } });
    expect(h.registry.get(id)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('coalesces updates to at most 10/s and persists within one second', () => {
    vi.useFakeTimers();
    const h = setup();
    const id = h.registry.start('chat', { title: 'Burst' });
    for (let i = 0; i < 50; i++) h.registry.module(id, 'input', { output: String(i) });
    expect(h.observed).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(h.observed).toHaveLength(1);
    expect(h.observed[0]).toMatchObject({
      process: { modules: expect.arrayContaining([expect.objectContaining({ output: '49' })]) as unknown },
    });
    for (let i = 0; i < 900; i += 10) {
      h.registry.module(id, 'input', { output: String(i) });
      vi.advanceTimersByTime(10);
    }
    expect(h.observed.length).toBeLessThanOrEqual(10);
    vi.advanceTimersByTime(500);
    expect(h.repository.save).toHaveBeenCalled();
    expect(h.repository.rows.get(id)?.process.modules[0]?.output).toBe('890');
  });

  it('retains exactly the newest 20 ended globally and keeps every unfinished process', () => {
    vi.useFakeTimers();
    const h = setup();
    const running = h.registry.start('image', { title: 'Running' });
    const waiting = h.registry.start('chat', { title: 'Waiting' });
    h.registry.status(waiting, 'waiting');
    const stopped = h.registry.start('chat', { title: 'Stopped' });
    h.registry.status(stopped, 'stopped');
    const ids: ProcessId[] = [];
    for (let i = 0; i < 23; i++) {
      const id = h.registry.start('web_chat', { title: String(i) });
      ids.push(id);
      h.clock.advance(10);
      h.registry.end(id);
    }
    expect(h.registry.list({ limit: 1000 })).toMatchObject({
      value: expect.arrayContaining([
        expect.objectContaining({ id: running }),
        expect.objectContaining({ id: waiting }),
        expect.objectContaining({ id: stopped }),
      ]) as unknown,
    });
    expect(h.registry.list({ status: ['ended'], limit: 1000 })).toMatchObject({ value: expect.any(Array) as unknown });
    const ended = h.registry.list({ status: ['ended'], limit: 1000 });
    expect(ended.ok && ended.value.map((item) => item.id)).toEqual(ids.slice(3).reverse());
    expect(h.registry.delete(stopped)).toMatchObject({ ok: true, value: { deleted: true } });
    h.registry.flush();
    expect(h.repository.rows.size).toBe(22);
    vi.advanceTimersByTime(100);
    expect(h.observed.filter((event) => event.type === 'removed')).toHaveLength(4);
  });

  it('sweeps persisted active processes on restart except clarifying pipelines', async () => {
    const h = setup();
    const active = h.registry.start('chat', {
      title: 'Chat',
      operation: { kind: 'chat', params: { conversationId, text: 'Hello' } },
    });
    const queued = h.registry.start('knowledge_ingest', { title: 'Queued' });
    h.registry.status(queued, 'waiting');
    const pipeline = h.registry.start('code_pipeline', { title: 'Answers' });
    h.registry.status(pipeline, 'waiting');
    h.registry.flush();
    h.registry.stop();
    const restarted = setup({}, h.repository);
    await restarted.registry.recover((process) => Promise.resolve(process.id === pipeline));
    expect(restarted.registry.get(active)).toMatchObject({
      value: { status: 'stopped', statusReason: 'Interrupted by restart', retryable: true },
    });
    expect(restarted.registry.get(queued)).toMatchObject({ value: { status: 'stopped' } });
    expect(restarted.registry.get(pipeline)).toMatchObject({ value: { status: 'waiting' } });
  });

  it.each(operations)('retries $kind using persisted safe parameters and creates a new record', async (operation) => {
    const h = setup();
    const id = h.registry.start(operation.kind, { title: 'Original', operation });
    h.registry.status(id, 'stopped', 'Failed');
    h.registry.flush();
    h.registry.stop();
    const restarted = setup(
      {
        dispatch: (stored, retryOf) => {
          restarted.registry.start(stored.kind, { title: 'Retried', operation: stored, retryOf });
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
      h.repository,
    );
    const result = await restarted.registry.retry(id);
    expect(result).toMatchObject({ ok: true, value: { kind: operation.kind, status: 'running' } });
    expect(result.ok && result.value.id).not.toBe(id);
    expect(restarted.dispatch).toHaveBeenCalledWith(operation, id);
    expect(restarted.registry.get(id)).toMatchObject({ value: { status: 'stopped' } });
  });

  it('delegates cancellation and ignores late completion; surfaces failed cancellation and replay', async () => {
    const h = setup({
      dispatch: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'VALIDATION',
            message: 'Missing project',
            retryable: false,
            remediation: ['Choose a project.'],
          },
        }),
    });
    const cancel = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }));
    const id = h.registry.start('chat', {
      title: 'Chat',
      cancel,
      operation: { kind: 'chat', params: { conversationId, text: 'Hello' } },
    });
    expect(await h.registry.cancel(id)).toMatchObject({ value: { status: 'stopped', statusReason: 'Cancelled' } });
    expect(cancel).toHaveBeenCalledOnce();
    h.registry.end(id, 'Too late');
    expect(h.registry.get(id)).toMatchObject({ value: { status: 'stopped' } });
    expect(await h.registry.retry(id)).toMatchObject({ ok: false, error: { message: 'Missing project' } });
    const second = h.registry.start('key_verify', {
      title: 'Key',
      cancel: () =>
        Promise.resolve({
          ok: false,
          error: { code: 'INTERNAL', message: 'Unavailable', retryable: true, remediation: ['Retry.'] },
        }),
    });
    expect(await h.registry.cancel(second)).toMatchObject({ ok: false });
    expect(h.registry.get(second)).toMatchObject({ value: { status: 'running' } });
    const nonRetryable = h.registry.start('vscode_launch', { title: 'VS Code' });
    h.registry.status(nonRetryable, 'stopped');
    expect(await h.registry.retry(nonRetryable)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });

  it('redacts repeated secrets in all summaries, nested detail and private replay data', () => {
    const h = setup();
    const secret = 'sk' + '-' + 'sensitive'.repeat(6);
    const text = `${secret} ${secret}`;
    const id = h.registry.start('chat', {
      title: text.repeat(10),
      operation: { kind: 'chat', params: { conversationId, text } },
    });
    h.registry.module(id, 'input', { input: text.repeat(100), output: text, detail: { nested: [{ key: text }] } });
    h.registry.annotate(id, { costText: text });
    h.registry.end(id, text.repeat(100));
    h.registry.flush();
    const stored = h.repository.rows.get(id);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(stored?.process.title.length).toBeLessThanOrEqual(120);
    expect(stored?.process.result?.length).toBeLessThanOrEqual(500);
    expect(stored?.process.modules[0]?.input?.length).toBeLessThanOrEqual(500);
  });

  it('filters by project, kind and status and validates IPC boundaries', () => {
    const h = setup();
    h.registry.start('chat', { title: 'Project', projectId });
    h.registry.start('image', { title: 'Global' });
    expect(h.registry.list({ projectId, kind: ['chat'], status: ['running'], limit: 1 })).toMatchObject({
      value: [expect.objectContaining({ title: 'Project' })],
    });
    for (const limit of [0, -1, 1.5, 1001]) expect(processListSchema.safeParse({ limit }).success).toBe(false);
    expect(
      processReportSchema.safeParse({ kind: 'web_chat', linkId: 'site', event: 'loaded', content: 'Page content' })
        .success,
    ).toBe(false);
  });

  it('tracks web-chat opened/loaded/closed and failure without accepting page content', () => {
    const h = setup();
    const input = { kind: 'web_chat' as const, linkId: 'site', projectId };
    const opened = h.registry.report({ ...input, event: 'opened' });
    expect(opened).toMatchObject({ value: { status: 'running', retryable: false } });
    expect(h.registry.report({ ...input, event: 'loaded' })).toMatchObject({
      value: {
        modules: expect.arrayContaining([expect.objectContaining({ id: 'active', state: 'active' })]) as unknown,
      },
    });
    expect(h.registry.report({ ...input, event: 'closed' })).toMatchObject({ value: { status: 'ended' } });
    h.registry.report({ ...input, event: 'opened' });
    expect(h.registry.report({ ...input, event: 'failed' })).toMatchObject({ value: { status: 'stopped' } });
    expect(h.registry.report({ ...input, event: 'loaded' })).toMatchObject({ ok: false });
  });

  it.each<ProcessKind>([
    'chat',
    'code_pipeline',
    'knowledge_ingest',
    'image',
    'price_update',
    'key_verify',
    'vscode_launch',
    'web_chat',
  ])('uses a connected binding graph for %s', (kind) => {
    const graph = processGraph(kind);
    expect(graph.modules.length).toBeGreaterThan(2);
    const ids = graph.modules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const edge of graph.edges) {
      expect(ids).toContain(edge.from);
      expect(ids).toContain(edge.to);
    }
    if (kind === 'code_pipeline') expect(graph.edges).toContainEqual({ from: 'review', to: 'write' });
  });
});

describe('OWNER-FB3 process deletion', () => {
  it.each(['stopped', 'ended'] as const)('TC-OWNER-FB3-003 deletes %s processes and emits removed', (status) => {
    vi.useFakeTimers();
    const h = setup();
    const id = h.registry.start('chat', { title: 'Delete me' });
    if (status === 'stopped') h.registry.status(id, 'stopped', 'Cancelled');
    else h.registry.end(id);
    expect(h.registry.delete(id)).toEqual({ ok: true, value: { deleted: true } });
    expect(h.registry.get(id)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    vi.advanceTimersByTime(100);
    expect(h.observed.at(-1)).toEqual({ type: 'removed', id });
    h.registry.flush();
    expect(h.repository.rows.has(id)).toBe(false);
  });
  it('TC-OWNER-FB3-004 rejects deletion of running and waiting processes', () => {
    const h = setup();
    const id = h.registry.start('chat', { title: 'Running' });
    expect(h.registry.delete(id)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    h.registry.status(id, 'waiting');
    expect(h.registry.delete(id)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  });
});
