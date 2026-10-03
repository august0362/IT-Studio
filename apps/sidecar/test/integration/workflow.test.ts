import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { projectSchema } from '../../src/validation/projects.js';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { pipelineRunSchema } from '../../src/validation/pipeline.js';
import { providerIdSchema } from '../../src/validation/common.js';
import { activityEventSchema, workflowGraphSchema } from '../../src/validation/workflow.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;
afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

const notificationSchema = z.object({ method: z.string(), params: z.unknown() });
function notifications(method: string): unknown[] {
  if (sidecar === undefined) return [];
  return sidecar.stdoutLines
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value) => {
      const parsed = notificationSchema.safeParse(value);
      return parsed.success && parsed.data.method === method;
    });
}

describe('workflow RPC integration', () => {
  it('TC-MW-001 shows chat, router, provider, and ledger activity in the graph and history', async () => {
    sidecar = await startSidecar(
      { ITSTUDIO_E2E_LLM_TEXT: 'Scripted assistant reply.' },
      { 'google/gemini-3.8-flash': ['ok'] },
    );
    const workspace = resolve(sidecar.dataDir, 'workflow-chat');
    await mkdir(workspace);
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Workflow chat', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const provider = providerIdSchema.parse(settings.router.ladder[0]?.modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-key` });
    const conversationId = conversationSchema.parse(
      (await sidecar.call('chat.createConversation', { projectId })).result,
    ).id;
    await sidecar.call('chat.send', { conversationId, text: 'workflow integration prompt' });
    await waitFor(() => notifications('chat.completed').length === 1);
    await waitFor(() => notifications('workflow.activity').length > 0);
    const history = (await sidecar.call('workflow.activity', { projectId, limit: 200 })).result;
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ moduleId: 'chat' }),
        expect.objectContaining({ moduleId: 'router' }),
        expect.objectContaining({ moduleId: 'providers' }),
        expect.objectContaining({ moduleId: 'ledger' }),
      ]),
    );
    const graph = await sidecar.call('workflow.graph', { projectId });
    expect(graph.error).toBeUndefined();
    expect(graph.result).toMatchObject({ projectId });
  });

  it('TC-MW-003 counts a scripted chat in the project graph and all-project aggregate', async () => {
    sidecar = await startSidecar(
      { ITSTUDIO_E2E_LLM_TEXT: 'Scripted assistant reply.' },
      { 'google/gemini-3.8-flash': ['ok'] },
    );
    const workspace = resolve(sidecar.dataDir, 'workflow-aggregate-chat');
    await mkdir(workspace);
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Workflow aggregate chat', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const provider = providerIdSchema.parse(settings.router.ladder[0]?.modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-key` });
    const conversationId = conversationSchema.parse(
      (await sidecar.call('chat.createConversation', { projectId })).result,
    ).id;
    await sidecar.call('chat.send', { conversationId, text: 'aggregate counter integration prompt' });
    await waitFor(() => notifications('chat.completed').length === 1);

    const projectGraph = workflowGraphSchema.parse((await sidecar.call('workflow.graph', { projectId })).result);
    const aggregateGraph = workflowGraphSchema.parse(
      (await sidecar.call('workflow.graph', { projectId: null })).result,
    );
    expect(projectGraph.nodes.find((node) => node.id === 'router')?.calls24h).toBeGreaterThanOrEqual(1);
    expect(aggregateGraph.nodes.find((node) => node.id === 'router')?.calls24h).toBeGreaterThanOrEqual(1);
  });

  it('TC-MW-002 reports the pipeline role modules and returns them to idle', async () => {
    const modelScripts = {
      'anthropic/claude-opus-5-5': ['delay:250'],
      'openai/gpt-5.3-codex': ['delay:250'],
      'anthropic/claude-sonnet-5-5': ['delay:250'],
    };
    const responseTexts = {
      'claude-opus-5-5': JSON.stringify({
        title: 'Create note',
        userStory: 'Create a note',
        acceptanceCriteria: [],
        allowedPaths: ['note.txt'],
        contracts: '',
        constraints: [],
        testPlan: [],
        outOfScope: [],
      }),
      'gpt-5.3-codex': JSON.stringify({
        summary: 'Create note',
        operations: [{ kind: 'create', path: 'note.txt', content: 'note' }],
        assumptions: [],
      }),
      'claude-sonnet-5-5': JSON.stringify({ approved: true, findings: [], summary: 'Approved' }),
    };
    sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: JSON.stringify(responseTexts) }, modelScripts);
    const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/sample-project');
    const workspace = resolve(sidecar.dataDir, 'workflow-pipeline');
    await cp(fixture, workspace, { recursive: true });
    const projectId = projectSchema.parse(
      (await sidecar.call('project.create', { name: 'Workflow pipeline', workspaceRoot: workspace })).result,
    ).id;
    const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
    const providers = new Set(
      settings.pipeline.roleAssignment.pm
        .concat(settings.pipeline.roleAssignment.coder, settings.pipeline.roleAssignment.reviewer)
        .map((key) => providerIdSchema.parse(key.split('/')[0])),
    );
    for (const provider of providers)
      await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-key` });
    await sidecar.call('settings.update', { patch: { pipeline: { validationCommands: [] } } });
    const started = await sidecar.call('pipeline.start', { projectId, prompt: 'Create a note' });
    const runId = pipelineRunSchema.parse(started.result).id;
    await waitFor(() => notifications('pipeline.event').some((value) => JSON.stringify(value).includes('completed')));
    const history = z
      .array(activityEventSchema)
      .parse((await sidecar.call('workflow.activity', { projectId, limit: 200 })).result);
    for (const moduleId of ['pipeline_pm', 'pipeline_coder', 'pipeline_reviewer', 'worker'] as const)
      expect(history.some((event) => event.moduleId === moduleId && event.refs.pipelineRunId === runId)).toBe(true);
    const graph = z
      .object({ nodes: z.array(z.object({ id: z.string(), status: z.string(), inFlight: z.number() })) })
      .parse((await sidecar.call('workflow.graph', { projectId })).result);
    expect(
      graph.nodes
        .filter((node) => ['pipeline_pm', 'pipeline_coder', 'pipeline_reviewer', 'worker'].includes(node.id))
        .every((node) => node.status === 'idle' && node.inFlight === 0),
    ).toBe(true);
  });
});
