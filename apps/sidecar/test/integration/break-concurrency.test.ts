import { afterEach, describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/kernel/validation/settings.js';
import { ledgerEntrySchema } from '../../src/kernel/validation/cost.js';
import { sourceDocumentSchema } from '../../src/kernel/validation/rag.js';
import { pipelineEventSchema, pipelineRunSchema } from '../../src/kernel/validation/pipeline.js';
import { activityEventSchema } from '../../src/kernel/validation/workflow.js';
import { providerIdSchema } from '../../src/kernel/validation/common.js';
import { llmRequestIdSchema } from '../../src/kernel/validation/brand.js';
import { LanceDbVectorStore } from '../../src/kernel/infra/lancedb/vector-store.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';
import { makeChat, makeProject, observed } from './break-helpers-02.js';

let sidecar: SidecarHarness | undefined;
function currentSidecar(): SidecarHarness {
  if (sidecar === undefined) throw new Error('Sidecar has not been started');
  return sidecar;
}
afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

const task = {
  title: 'Create note',
  userStory: 'Create note',
  acceptanceCriteria: [],
  allowedPaths: ['note.txt'],
  contracts: '',
  constraints: [],
  testPlan: [],
  outOfScope: [],
};
const coder = {
  summary: 'Create note',
  operations: [{ kind: 'create', path: 'note.txt', content: 'note' }],
  assumptions: [],
};
const pipelineResponses = {
  'claude-opus-5-5': JSON.stringify(task),
  'gpt-5.3-codex': JSON.stringify(coder),
  'claude-sonnet-5-5': JSON.stringify({ approved: true, findings: [], summary: 'Approved' }),
};
const pipelineModels = {
  'anthropic/claude-opus-5-5': ['ok'],
  'openai/gpt-5.3-codex': ['ok'],
  'anthropic/claude-sonnet-5-5': ['ok'],
};

async function setupChat(
  scripts: Readonly<Record<string, readonly string[]>> = { 'google/gemini-3.8-flash': Array(25).fill('ok') },
) {
  sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: 'Race reply.' }, scripts);
  const project = await makeProject(sidecar, 'Race project');
  const chat = await makeChat(sidecar, project.projectId);
  return { project, chat };
}

async function setupPipeline() {
  sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: JSON.stringify(pipelineResponses) }, pipelineModels);
  const first = await makeProject(sidecar, 'Pipeline one');
  const second = await makeProject(sidecar, 'Pipeline two');
  const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
  const keys = [
    ...new Set([
      ...settings.pipeline.roleAssignment.pm,
      ...settings.pipeline.roleAssignment.coder,
      ...settings.pipeline.roleAssignment.reviewer,
    ]),
  ];
  for (const key of keys) {
    const provider = providerIdSchema.parse(key.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-break02` });
  }
  await sidecar.call('settings.update', { patch: { pipeline: { validationCommands: [] } } });
  return { first, second };
}

describe('QA-BREAK-02 adversarial concurrency and sync', () => {
  it('QA-BREAK-02-D06 BRK-C01 queues the second same-tick pipeline start and never runs both at once', async () => {
    const { first } = await setupPipeline();
    const responses = await Promise.all([
      currentSidecar().call('pipeline.start', { projectId: first.projectId, prompt: 'first' }),
      currentSidecar().call('pipeline.start', { projectId: first.projectId, prompt: 'second' }),
    ]);
    for (const response of responses) expect(response.error).toBeUndefined();
    const runIds = responses.map((response) => pipelineRunSchema.parse(response.result).id);
    expect(new Set(runIds).size).toBe(2);
    await waitFor(
      () =>
        runIds.every((runId) =>
          observed(currentSidecar(), 'pipeline.event')
            .map((event) => pipelineEventSchema.parse(event))
            .some((event) => event.runId === runId && event.type === 'finished'),
        ),
      45_000,
    );
    const events = observed(currentSidecar(), 'pipeline.event').map((event) => pipelineEventSchema.parse(event));
    const firstFinishedIndex = events.findIndex((event) => event.runId === runIds[0] && event.type === 'finished');
    expect(firstFinishedIndex).toBeGreaterThanOrEqual(0);
    for (const runId of runIds) {
      expect(events.filter((event) => event.runId === runId && event.type === 'stage').length).toBeGreaterThan(0);
      expect(events.filter((event) => event.runId === runId && event.type === 'finished')).toHaveLength(1);
    }
    // The first stage notification announces creation before the run waits on the project queue.
    for (const [index] of [...events.entries()]
      .filter(([, event]) => event.runId === runIds[1] && event.type === 'stage')
      .slice(1)) {
      expect(index).toBeGreaterThan(firstFinishedIndex);
    }
    const list = await currentSidecar().call('pipeline.list', { projectId: first.projectId, limit: 20 });
    expect(list.error).toBeUndefined();
    const runs = z.array(pipelineRunSchema).parse(list.result);
    expect(runs).toHaveLength(2);
    for (const run of runs) {
      expect(runIds).toContain(run.id);
      expect(['completed', 'rolled_back', 'failed', 'cancelled']).toContain(run.stage);
      expect(run.finishedAt).toBeDefined();
      expect(events.find((event) => event.runId === run.id && event.type === 'finished')).toMatchObject({
        stage: run.stage,
      });
    }
  }, 60_000);

  it('BRK-C02 attributes parallel pipeline events and ledger rows to their own projects', async () => {
    const { first, second } = await setupPipeline();
    const starts = await Promise.all(
      [first, second].map((project) =>
        currentSidecar().call('pipeline.start', { projectId: project.projectId, prompt: 'create a note' }),
      ),
    );
    const runIds = starts.map((response) => pipelineRunSchema.parse(response.result).id);
    await waitFor(
      () =>
        runIds.every((id) =>
          observed<{ type?: string; runId?: string }>(currentSidecar(), 'pipeline.event').some(
            (event) => event.runId === id && event.type === 'finished',
          ),
        ),
      45_000,
    );
    const runProject = new Map(
      runIds.map((runId, index) => [String(runId), index === 0 ? first.projectId : second.projectId]),
    );
    const events = observed<{ runId: string }>(currentSidecar(), 'pipeline.event');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(runProject.has(event.runId)).toBe(true);
    for (const project of [first, second]) {
      const ledger = z
        .object({ items: z.array(ledgerEntrySchema) })
        .parse((await currentSidecar().call('ledger.query', { projectId: project.projectId, limit: 100 })).result);
      expect(ledger.items.every((row) => row.projectId === project.projectId)).toBe(true);
      expect(events.some((event) => runProject.get(event.runId) === project.projectId)).toBe(true);
    }
  }, 75_000);

  it('BRK-C03 keeps an in-flight chat bound to its original project during 50 active-project switches', async () => {
    const { project, chat } = await setupChat({ 'google/gemini-3.8-flash': ['delay:250'] });
    const other = await makeProject(currentSidecar(), 'Other active project');
    await currentSidecar().call('project.setActive', { projectId: project.projectId });
    await currentSidecar().call('chat.send', { conversationId: chat.conversationId, text: 'original project message' });
    for (let index = 0; index < 50; index += 1)
      await currentSidecar().call('project.setActive', { projectId: index % 2 ? project.projectId : other.projectId });
    await waitFor(() => observed(currentSidecar(), 'chat.completed').length === 1);
    const rows = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await currentSidecar().call('ledger.query', { projectId: project.projectId, limit: 20 })).result).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.projectId).toBe(project.projectId);
    const messages = z
      .array(z.object({ role: z.string(), parts: z.array(z.object({ text: z.string().optional() })) }))
      .parse((await currentSidecar().call('chat.getMessages', { conversationId: chat.conversationId })).result);
    expect(messages.map((message) => message.parts.map((part) => part.text ?? '').join('')).join(' ')).toContain(
      'Race reply.',
    );
  }, 45_000);

  it('BRK-C04 handles cancel before delta, duplicate cancel, post-completion cancel, and unknown id', async () => {
    const { project, chat } = await setupChat({ 'google/gemini-3.8-flash': ['delay:30000', 'ok'] });
    const sent = await currentSidecar().call('chat.send', {
      conversationId: chat.conversationId,
      text: 'cancel immediately',
    });
    const requestId = llmRequestIdSchema.parse(z.object({ requestId: z.string() }).parse(sent.result).requestId);
    await currentSidecar().call('chat.cancel', { requestId });
    await currentSidecar().call('chat.cancel', { requestId });
    await waitFor(() => observed(currentSidecar(), 'chat.failed').length === 1);
    const second = await currentSidecar().call('chat.send', {
      conversationId: chat.conversationId,
      text: 'complete normally',
    });
    const completedId = llmRequestIdSchema.parse(z.object({ requestId: z.string() }).parse(second.result).requestId);
    await waitFor(() => observed(currentSidecar(), 'chat.completed').length === 1);
    await currentSidecar().call('chat.cancel', { requestId: completedId });
    const unknown = await currentSidecar().call('chat.cancel', {
      requestId: llmRequestIdSchema.parse('00000000-0000-4000-8000-000000000000'),
    });
    expect(unknown.error === undefined || unknown.error.code === -32000).toBe(true);
    expect(observed(currentSidecar(), 'chat.completed').length + observed(currentSidecar(), 'chat.failed').length).toBe(
      2,
    );
    const ledger = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await currentSidecar().call('ledger.query', { projectId: project.projectId, limit: 10 })).result);
    expect(ledger.items).toHaveLength(1);
  }, 45_000);

  it('BRK-C05 serializes 20 same-conversation sends without message or ledger duplication', async () => {
    const { project, chat } = await setupChat();
    for (let index = 0; index < 20; index += 1) {
      const response = await currentSidecar().call('chat.send', {
        conversationId: chat.conversationId,
        text: `message ${String(index)}`,
      });
      expect(response.error).toBeUndefined();
      await waitFor(() => observed(currentSidecar(), 'chat.completed').length === index + 1);
    }
    const messages = z
      .array(z.object({ role: z.string(), parts: z.array(z.object({ text: z.string().optional() })) }))
      .parse((await currentSidecar().call('chat.getMessages', { conversationId: chat.conversationId })).result);
    expect(messages).toHaveLength(40);
    expect(messages.filter((message) => message.role === 'user')).toHaveLength(20);
    expect(
      new Set(messages.filter((message) => message.role === 'user').map((message) => message.parts[0]?.text)).size,
    ).toBe(20);
    const rows = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await currentSidecar().call('ledger.query', { projectId: project.projectId, limit: 100 })).result).items;
    expect(rows).toHaveLength(20);
  }, 85_000);

  it('QA-BREAK-02-D08 BRK-C06 preserves concurrent distinct settings fields across valid settings patches', async () => {
    sidecar = await startSidecar();
    const initial = appSettingsSchema.parse((await currentSidecar().call('settings.get')).result);
    const patches = [
      { ui: { mode: 'dark' as const } },
      { ui: { locale: 'vi' as const } },
      { budget: { hardStop: !initial.budget.hardStop } },
      { pricing: { autoUpdate: !initial.pricing.autoUpdate } },
      { pricing: { updateIntervalHours: 73 } },
      { pricing: { maxAutoChangePercent: 17 } },
      { fx: { autoUpdate: !initial.fx.autoUpdate } },
      { fx: { manualUsdToVnd: initial.fx.manualUsdToVnd === null ? 25000 : null } },
      { vscode: { autoLaunch: !initial.vscode.autoLaunch } },
      { vscode: { showDiffBeforeValidate: !initial.vscode.showDiffBeforeValidate } },
      { vscode: { revealChangedFiles: !initial.vscode.revealChangedFiles } },
      { image: { enabled: !initial.image.enabled } },
      { rag: { defaultTopK: 13 } },
      { rag: { minScore: 0.23 } },
      { router: { autoFallback: !initial.router.autoFallback } },
      { router: { userDecisionTimeoutMs: 61000 } },
      { router: { circuitBreaker: { failureThreshold: 4, cooldownMs: 121000 } } },
      {
        webChat: {
          browser: 'custom' as const,
          customBrowserPath: resolve(currentSidecar().dataDir, 'custom-browser.exe'),
        },
      },
    ];
    const results = await Promise.all(patches.map((patch) => currentSidecar().call('settings.update', { patch })));
    expect(
      results.map((result, index) => ({ index, error: result.error })).filter((result) => result.error !== undefined),
    ).toEqual([]);
    const final = appSettingsSchema.parse((await currentSidecar().call('settings.get')).result);
    expect(final.ui.mode).toBe('dark');
    expect(final.ui.locale).toBe('vi');
    expect(final.budget.hardStop).toBe(!initial.budget.hardStop);
    expect(final.pricing).toMatchObject({
      autoUpdate: !initial.pricing.autoUpdate,
      updateIntervalHours: 73,
      maxAutoChangePercent: 17,
    });
    expect(final.fx).toMatchObject({
      autoUpdate: !initial.fx.autoUpdate,
      manualUsdToVnd: initial.fx.manualUsdToVnd === null ? 25000 : null,
    });
    expect(final.vscode).toMatchObject({
      autoLaunch: !initial.vscode.autoLaunch,
      showDiffBeforeValidate: !initial.vscode.showDiffBeforeValidate,
      revealChangedFiles: !initial.vscode.revealChangedFiles,
    });
    expect(final.image.enabled).toBe(!initial.image.enabled);
    expect(final.rag).toMatchObject({ defaultTopK: 13, minScore: 0.23 });
    expect(final.router).toMatchObject({
      autoFallback: !initial.router.autoFallback,
      userDecisionTimeoutMs: 61000,
      circuitBreaker: { failureThreshold: 4, cooldownMs: 121000 },
    });
    expect(final.webChat).toMatchObject({
      browser: 'custom',
      customBrowserPath: resolve(currentSidecar().dataDir, 'custom-browser.exe'),
    });
    // The SettingsPatch contract currently exposes 18 independently patchable leaves/objects, not 50.
  });

  it('BRK-C07 keeps the in-flight router request valid while applying the reordered config to the next request', async () => {
    const { chat } = await setupChat({ 'google/gemini-3.8-flash': ['delay:200', 'ok'] });
    const original = appSettingsSchema.parse((await currentSidecar().call('settings.get')).result);
    const sent = await currentSidecar().call('chat.send', { conversationId: chat.conversationId, text: 'in-flight' });
    const revised = { ...original.router, autoFallback: false, ladder: [...original.router.ladder].reverse() };
    expect((await currentSidecar().call('router.updateConfig', { config: revised })).error).toBeUndefined();
    await waitFor(() => observed(currentSidecar(), 'chat.completed').length === 1);
    expect(
      (await currentSidecar().call('chat.send', { conversationId: chat.conversationId, text: 'next request' })).error,
    ).toBeUndefined();
    await waitFor(() => observed(currentSidecar(), 'chat.completed').length === 2);
    expect(z.object({ requestId: z.string() }).safeParse(sent.result).success).toBe(true);
    expect(appSettingsSchema.parse((await currentSidecar().call('settings.get')).result).router.autoFallback).toBe(
      false,
    );
  }, 45_000);

  it('BRK-C08 bounds hard-stop overspend by requests admitted before the limit was crossed', async () => {
    const { project, chat } = await setupChat({ 'google/gemini-3.8-flash': Array(20).fill('delay:100') });
    const baseline = await currentSidecar().call('chat.send', {
      conversationId: chat.conversationId,
      text: 'calibrate one paid call',
    });
    const baselineRequestId = z.object({ requestId: z.string() }).parse(baseline.result).requestId;
    await waitFor(() =>
      observed<{ requestId: string }>(currentSidecar(), 'chat.completed').some(
        (e) => e.requestId === baselineRequestId,
      ),
    );
    const before = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await currentSidecar().call('ledger.query', { projectId: project.projectId, limit: 100 })).result).items;
    const alreadySpent = before.reduce((sum, entry) => sum + entry.costMicroUsd, 0);
    const oneCallCost = before.at(-1)?.costMicroUsd ?? 0;
    expect(oneCallCost).toBeGreaterThan(0);
    const budgetLimit = alreadySpent + oneCallCost + 1;
    const chats = [
      chat,
      ...(await Promise.all(Array.from({ length: 9 }, () => makeChat(currentSidecar(), project.projectId)))),
    ];
    await currentSidecar().call('budget.setUsd', {
      projectId: project.projectId,
      period: 'monthly',
      limitUsd: (budgetLimit / 1_000_000).toFixed(6),
      warnAt: [1],
    });
    await currentSidecar().call('settings.update', { patch: { budget: { hardStop: true } } });
    const calls = await Promise.all(
      chats.map((targetChat, index) =>
        currentSidecar().call('chat.send', {
          conversationId: targetChat.conversationId,
          text: `paid ${String(index)}`,
        }),
      ),
    );
    const requestIds = calls.flatMap((call) =>
      call.result ? [z.object({ requestId: z.string() }).parse(call.result).requestId] : [],
    );
    expect(requestIds.length).toBeGreaterThan(0);
    expect(requestIds.length).toBeLessThanOrEqual(10);
    await waitFor(() => {
      const terminal = new Set([
        ...observed<{ requestId: string }>(currentSidecar(), 'chat.completed').map((event) => event.requestId),
        ...observed<{ requestId: string }>(currentSidecar(), 'chat.failed').map((event) => event.requestId),
      ]);
      return requestIds.every((id) => terminal.has(id));
    });
    const failed = observed<{ requestId: string; error: { code: string } }>(currentSidecar(), 'chat.failed');
    expect(
      failed.some((event) => requestIds.includes(event.requestId) && event.error.code === 'BUDGET_HARD_STOP'),
      JSON.stringify(failed.filter((event) => requestIds.includes(event.requestId))),
    ).toBe(true);
    const completedCount = observed<{ requestId: string }>(currentSidecar(), 'chat.completed').filter((event) =>
      requestIds.includes(event.requestId),
    ).length;
    const ledger = z
      .object({ items: z.array(ledgerEntrySchema) })
      .parse((await currentSidecar().call('ledger.query', { projectId: project.projectId, limit: 100 })).result).items;
    const spent = ledger.reduce((sum, entry) => sum + entry.costMicroUsd, 0);
    const overspend = Math.max(0, spent - budgetLimit);
    const maximumSingleCall = Math.max(0, ...ledger.map((entry) => entry.costMicroUsd));
    const concurrentLedger = ledger.filter(
      (entry) => entry.llmRequestId !== undefined && requestIds.includes(entry.llmRequestId),
    );
    expect(overspend).toBeLessThanOrEqual(maximumSingleCall * completedCount);
    expect(completedCount).toBeLessThanOrEqual(10);
    expect(concurrentLedger.length).toBe(completedCount);
  }, 45_000);

  it('QA-BREAK-02-D05 BRK-C09 preserves delete across concurrent re-index of an existing source', async () => {
    sidecar = await startSidecar();
    const { projectId, workspaceRoot } = await makeProject(sidecar, 'RAG race');
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    await sidecar.call('secrets.set', {
      provider: providerIdSchema.parse(settings.rag.embedding.modelKey.split('/')[0]),
      apiKey: 'integration-only-embedding-key',
    });
    const sourcePath = resolve(workspaceRoot, 'source.md');
    await writeFile(sourcePath, '# Seed\n\nSmall initial document.');
    const seed = await currentSidecar().call('rag.ingest', { projectId, paths: ['source.md'] });
    expect(seed.error).toBeUndefined();
    const seedJobId = z.object({ id: z.string() }).parse(seed.result).id;
    await waitFor(
      () =>
        observed<{ id: string; status: string }>(currentSidecar(), 'rag.progress').some(
          (event) => event.id === seedJobId && event.status === 'indexed',
        ),
      30_000,
    );
    const original = z
      .array(sourceDocumentSchema)
      .parse((await currentSidecar().call('rag.listDocuments', { projectId })).result)[0];
    if (original === undefined) throw new Error('Seed ingest produced no document');
    await writeFile(sourcePath, '# Race\n\n' + 'Same source indexed concurrently. '.repeat(120_000));
    const started = await Promise.all(
      [1, 2].map(() => currentSidecar().call('rag.ingest', { projectId, paths: ['source.md'] })),
    );
    const ids = started.flatMap((result) =>
      result.result ? [z.object({ id: z.string() }).parse(result.result).id] : [],
    );
    expect(ids).toHaveLength(2);
    await waitFor(
      () =>
        ids.some((id) =>
          observed<{ id: string; status: string }>(currentSidecar(), 'rag.progress').some(
            (event) => event.id === id && event.status === 'parsing',
          ),
        ),
      30_000,
    );
    expect((await currentSidecar().call('rag.deleteDocument', { documentId: original.id })).error).toBeUndefined();
    await waitFor(
      () =>
        ids.every((id) =>
          observed<{ id: string; status: string }>(currentSidecar(), 'rag.progress').some(
            (event) => event.id === id && ['indexed', 'failed'].includes(event.status),
          ),
        ),
      60_000,
    );
    expect(await sidecar.call('rag.listDocuments', { projectId })).toMatchObject({ result: [] });
    expect(await new LanceDbVectorStore(resolve(sidecar.dataDir, 'lancedb')).count(projectId)).toEqual({
      ok: true,
      value: 0,
    });
  }, 80_000);

  it('BRK-C10 applies concurrent pricing refreshes without exposing a partial row set', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_PRICING_HTTP: 'fail' });
    const project = await makeProject(sidecar, 'Pricing refresh race');
    await sidecar.call('project.setActive', { projectId: project.projectId });
    const before = await sidecar.call('pricing.getRows');
    const responses = await Promise.all([sidecar.call('pricing.refresh'), sidecar.call('pricing.refresh')]);
    const rows = await sidecar.call('pricing.getRows');
    expect(responses.every((response) => response.error !== undefined)).toBe(true);
    expect(rows.result).toEqual(before.result);
    expect(before.error).toBeUndefined();
  }, 60_000);

  it('BRK-C11 serializes verify-and-save and delete history for one provider', async () => {
    sidecar = await startSidecar({ ITSTUDIO_E2E_VERIFIER_OUTCOME: 'success' });
    for (let index = 0; index < 10; index += 1) {
      const results = await Promise.all([
        sidecar.call('secrets.verifyAndSave', {
          provider: 'openai',
          apiKey: `break02-key-${String(index).padStart(4, '0')}`,
        }),
        sidecar.call('secrets.delete', { provider: 'openai' }),
      ]);
      expect(results.every((response) => response.error === undefined)).toBe(true);
    }
    const status = await sidecar.call('secrets.status');
    const history = await sidecar.call('secrets.history', { provider: 'openai', limit: 50 });
    expect(status.error).toBeUndefined();
    expect(history.error).toBeUndefined();
    expect(z.array(z.unknown()).parse(history.result).length).toBeGreaterThanOrEqual(20);
  }, 60_000);

  it('QA-BREAK-02-D07 BRK-C12 keeps ping responsive and workflow activity bounded during a query burst', async () => {
    sidecar = await startSidecar();
    const { projectId } = await makeProject(sidecar, 'Activity burst');
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const embeddingProvider = providerIdSchema.parse(settings.rag.embedding.modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider: embeddingProvider, apiKey: 'integration-only-workflow-burst-key' });
    const durations: number[] = [];
    await Promise.all(
      Array.from({ length: 500 }, async () => {
        const started = performance.now();
        const [query, ping] = await Promise.all([
          currentSidecar().call('rag.query', { projectId, query: 'burst query', topK: 5, minScore: 0 }),
          currentSidecar().call('system.ping'),
        ]);
        expect(query.error).toBeUndefined();
        expect(ping.error).toBeUndefined();
        durations.push(performance.now() - started);
      }),
    );
    const p95 = durations.sort((a, b) => a - b)[Math.floor(durations.length * 0.95)] ?? 0;
    const activity = await sidecar.call('workflow.activity', { projectId, limit: 200 });
    const events = z.array(activityEventSchema).parse(activity.result);
    expect(events.length).toBeGreaterThan(0);
    expect(p95).toBeLessThan(200);
    expect(events.length).toBeLessThanOrEqual(5_000);
  }, 85_000);
});
