import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { pipelineRunSchema } from '../../src/validation/pipeline.js';
import { providerIdSchema } from '../../src/validation/common.js';
import { isoDateTimeSchema } from '../../src/validation/brand.js';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';

let sidecar: SidecarHarness | undefined;
afterEach(async () => {
  await sidecar?.close();
  sidecar = undefined;
});

const taskSpec = {
  title: 'Add greeting',
  userStory: 'Write a greeting file',
  acceptanceCriteria: ['The greeting file exists'],
  allowedPaths: ['src/greeting.txt'],
  contracts: '',
  constraints: [],
  testPlan: ['Check the file exists'],
  outOfScope: [],
};
const coderOutput = {
  summary: 'Create a greeting file',
  operations: [{ kind: 'create', path: 'src/greeting.txt', content: 'hello from pipeline' }],
  assumptions: [],
};
const reviewVerdict = { approved: true, findings: [], summary: 'Approved' };
const modelScripts = {
  'anthropic/claude-opus-5-5': ['ok'],
  'openai/gpt-5.3-codex': ['ok'],
  'anthropic/claude-sonnet-5-5': ['ok'],
};
const responseTexts = {
  'claude-opus-5-5': JSON.stringify(taskSpec),
  'gpt-5.3-codex': JSON.stringify(coderOutput),
  'claude-sonnet-5-5': JSON.stringify(reviewVerdict),
};
const notificationSchema = z.object({ method: z.string(), params: z.unknown() });

// Hash of the user's files only: the `.itstudio/` journal is kept after rollback by design (ARCH §9.3 audit trail).
async function projectHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (directory === root && entry.name === '.itstudio') continue;
      const path = resolve(directory, entry.name);
      hash.update(path.slice(root.length));
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) hash.update(await readFile(path));
    }
  };
  await visit(root);
  return hash.digest('hex');
}

async function setup(validationExitCode: 0 | 1) {
  sidecar = await startSidecar({ ITSTUDIO_E2E_LLM_TEXT: JSON.stringify(responseTexts) }, modelScripts);
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/sample-project');
  const workspace = resolve(sidecar.dataDir, 'sample-project');
  await cp(fixture, workspace, { recursive: true });
  await mkdir(resolve(workspace, 'src'));
  const projectResponse = await sidecar.call('project.create', { name: 'Pipeline fixture', workspaceRoot: workspace });
  const projectId = projectSchema.parse(projectResponse.result).id;
  const settings = appSettingsSchema.parse((await sidecar.call('settings.get')).result);
  const roleModels = [
    ...new Set([
      ...settings.pipeline.roleAssignment.pm,
      ...settings.pipeline.roleAssignment.coder,
      ...settings.pipeline.roleAssignment.reviewer,
    ]),
  ];
  for (const modelKey of roleModels) {
    const provider = providerIdSchema.parse(modelKey.split('/')[0]);
    await sidecar.call('secrets.set', { provider, apiKey: `integration-only-${provider}-key` });
  }
  await sidecar.call('settings.update', {
    patch: {
      pipeline: {
        validationCommands: [
          {
            kind: 'build',
            executable: 'node',
            args: ['-e', `process.exit(${String(validationExitCode)})`],
            timeoutMs: 5000,
          },
        ],
      },
    },
  });
  return { workspace, projectId };
}

function observed(method: string): unknown[] {
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

describe('pipeline integration', () => {
  it('TC-M3-045 TC-M6-001 attributes completed pipeline cost in P&L', async () => {
    const { workspace, projectId } = await setup(0);
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Create a greeting file' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() => {
      const notifications = observed('pipeline.event');
      return notifications.some((value) => JSON.stringify(value).includes('completed'));
    });
    const result = await sidecar?.call('pipeline.get', { runId });
    const run = pipelineRunSchema.parse(result?.result);
    expect(run.stage).toBe('completed');
    const ledgerResponse = await sidecar?.call('ledger.query', { projectId, limit: 100 });
    const ledger = z
      .object({
        items: z.array(
          z.object({
            pipelineRunId: z.string().optional(),
            costMicroUsd: z.number(),
            purpose: z.string(),
          }),
        ),
      })
      .parse(ledgerResponse?.result);
    const attributedCost = ledger.items
      .filter((entry) => entry.pipelineRunId === runId)
      .reduce((total, entry) => total + entry.costMicroUsd, 0);
    expect(
      ledger.items
        .filter((entry) => entry.pipelineRunId === runId)
        .every((entry) => entry.purpose.startsWith('pipeline_')),
    ).toBe(true);
    expect(run.cost.microUsd).toBeGreaterThan(0);
    expect(run.cost.microUsd).toBe(attributedCost);
    const pnl = await sidecar?.call('pnl.get', {
      projectId,
      from: isoDateTimeSchema.parse('2020-01-01T00:00:00.000Z'),
      to: isoDateTimeSchema.parse('2030-01-01T00:00:00.000Z'),
    });
    expect(pnl?.result).toMatchObject({ cost: { microUsd: attributedCost } });
    expect(await readFile(resolve(workspace, 'src/greeting.txt'), 'utf8')).toBe('hello from pipeline');
  }, 30_000);

  it('TC-M6-002 rolls back failed validation and publishes a failure report', async () => {
    const { workspace, projectId } = await setup(1);
    const before = await projectHash(workspace);
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Create a greeting file' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() => observed('pipeline.failureReport').length > 0);
    const result = await sidecar?.call('pipeline.get', { runId });
    const run = pipelineRunSchema.parse(result?.result);
    expect(run.stage).toBe('rolled_back');
    expect(run.failureReport?.rolledBack).toBe(true);
    expect(await projectHash(workspace)).toBe(before);
    const journals = await readdir(resolve(workspace, '.itstudio/tx'));
    expect(journals).toHaveLength(1);
    const manifest = z
      .object({ transaction: z.object({ status: z.string() }) })
      .parse(
        JSON.parse(await readFile(resolve(workspace, '.itstudio/tx', journals[0] ?? '', 'manifest.json'), 'utf8')),
      );
    expect(manifest.transaction.status).toBe('rolled_back');
    expect(observed('pipeline.failureReport')).toHaveLength(1);
  }, 30_000);
});
