import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { projectSchema } from '../../src/validation/projects.js';
import { pipelineRunSchema } from '../../src/validation/pipeline.js';
import { providerIdSchema } from '../../src/validation/common.js';
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

async function setup(
  validationExitCode: 0 | 1,
  options: {
    readonly crashAt?: 'after_prepare' | 'mid_commit';
    readonly twoFiles?: boolean;
    readonly coderPath?: string;
    readonly invalidCoder?: boolean;
    readonly validationArgs?: readonly string[];
    readonly validationTimeoutMs?: number;
    readonly parentSecret?: string;
  } = {},
) {
  const scriptedTexts = { ...responseTexts };
  if (options.twoFiles || options.coderPath !== undefined || options.invalidCoder) {
    const multiFileCoder = {
      ...coderOutput,
      operations:
        options.coderPath === undefined
          ? [...coderOutput.operations, { kind: 'create', path: 'src/second.txt', content: 'second file' }]
          : [{ kind: 'create', path: options.coderPath, content: 'outside TaskSpec' }],
    };
    scriptedTexts['gpt-5.3-codex'] = options.invalidCoder ? '{"not":"a coder output"}' : JSON.stringify(multiFileCoder);
  }
  sidecar = await startSidecar(
    {
      ITSTUDIO_E2E_LLM_TEXT: JSON.stringify(scriptedTexts),
      ...(options.parentSecret === undefined ? {} : { OPENAI_API_KEY: options.parentSecret }),
      ...(options.crashAt === undefined ? {} : { ITSTUDIO_E2E_CRASH_AT: options.crashAt }),
    },
    modelScripts,
  );
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
  const defaultValidationArgs = ['-e', `process.exit(${String(validationExitCode)})`];
  await sidecar.call('settings.update', {
    patch: {
      pipeline: {
        validationCommands: [
          {
            kind: 'build',
            executable: 'node',
            args: options.validationArgs ?? defaultValidationArgs,
            timeoutMs: options.validationTimeoutMs ?? 5000,
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
  it('TC-M6-001 and TC-M6-052 complete a scripted pipeline with attributed cost and writes', async () => {
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
        items: z.array(z.object({ pipelineRunId: z.string().optional(), costMicroUsd: z.number() })),
      })
      .parse(ledgerResponse?.result);
    const attributedCost = ledger.items
      .filter((entry) => entry.pipelineRunId === runId)
      .reduce((total, entry) => total + entry.costMicroUsd, 0);
    expect(run.cost.microUsd).toBeGreaterThan(0);
    expect(run.cost.microUsd).toBe(attributedCost);
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

  it.each([
    ['TC-M6-030', 'after_prepare'],
    ['TC-M6-031', 'mid_commit'],
  ] as const)(
    '%s recovers journal state after killing the sidecar',
    async (caseId, crashAt) => {
      const { workspace, projectId } = await setup(0, {
        crashAt,
        ...(crashAt === 'mid_commit' ? { twoFiles: true } : {}),
      });
      const before = await projectHash(workspace);
      await sidecar?.call('pipeline.start', { projectId, prompt: `Crash recovery ${caseId}` });
      await waitFor(
        () =>
          existsSync(resolve(workspace, '.itstudio/tx')) &&
          existsSync(
            resolve(
              workspace,
              '.itstudio/tx',
              readdirSync(resolve(workspace, '.itstudio/tx'))[0] ?? '',
              'manifest.json',
            ),
          ),
      );
      await sidecar?.kill();
      await sidecar?.restart({ ITSTUDIO_E2E_CRASH_AT: '' });
      await waitFor(() => sidecar?.stdoutLines.some((line) => line.includes('"recoveredTransactions":1')) === true);
      await waitFor(() => observed('pipeline.failureReport').length === 1);
      expect(await projectHash(workspace)).toBe(before);
      expect(await readFile(resolve(workspace, 'src/greeting.txt')).catch(() => '')).toBe('');
      if (crashAt === 'mid_commit')
        expect(await readFile(resolve(workspace, 'src/second.txt')).catch(() => '')).toBe('');
    },
    30_000,
  );

  it('TC-M6-023 rejects writes outside the TaskSpec allow list before disk changes', async () => {
    const { workspace, projectId } = await setup(0, { coderPath: 'src/not-allowed.txt' });
    const before = await projectHash(workspace);
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Write outside allowed paths' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() => observed('pipeline.failureReport').length > 0);
    expect(pipelineRunSchema.parse((await sidecar?.call('pipeline.get', { runId }))?.result).stage).toBe('failed');
    expect(await projectHash(workspace)).toBe(before);
  });

  it('TC-M6-006 fails after the one permitted re-ask for invalid coder JSON', async () => {
    const { workspace, projectId } = await setup(0, { invalidCoder: true });
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Create a greeting file' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() => observed('pipeline.failureReport').length > 0);
    const run = pipelineRunSchema.parse((await sidecar?.call('pipeline.get', { runId }))?.result);
    expect(run.stage).toBe('failed');
    expect(await readFile(resolve(workspace, 'src/greeting.txt')).catch(() => '')).toBe('');
  }, 30_000);

  it('TC-M6-041 strips provider secrets from validation child environments', async () => {
    const { projectId } = await setup(0, {
      parentSecret: 'integration-parent-secret',
      validationArgs: ['-e', 'if (process.env.OPENAI_API_KEY) process.exit(9)'],
    });
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Check child environment' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() => observed('pipeline.event').some((event) => JSON.stringify(event).includes('completed')));
    expect(pipelineRunSchema.parse((await sidecar?.call('pipeline.get', { runId }))?.result).stage).toBe('completed');
  }, 30_000);

  it('TC-M6-042 times out validation and rolls back the workspace write', async () => {
    const { workspace, projectId } = await setup(0, {
      validationArgs: ['-e', 'setInterval(() => undefined, 1000)'],
      validationTimeoutMs: 30,
    });
    const before = await projectHash(workspace);
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Timeout validation' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() => observed('pipeline.failureReport').length > 0);
    expect(pipelineRunSchema.parse((await sidecar?.call('pipeline.get', { runId }))?.result).stage).toBe('rolled_back');
    expect(await projectHash(workspace)).toBe(before);
  }, 30_000);

  it('TC-M6-012 cancels the running validation process and rolls back the workspace write', async () => {
    const { workspace, projectId } = await setup(0, {
      validationArgs: ['-e', 'setInterval(() => undefined, 1000)'],
      validationTimeoutMs: 30_000,
    });
    const before = await projectHash(workspace);
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Cancel validation' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() =>
      observed('pipeline.event').some(
        (event) => JSON.stringify(event).includes(runId) && JSON.stringify(event).includes('validating'),
      ),
    );
    await sidecar?.call('pipeline.cancel', { runId });
    await waitFor(() => observed('pipeline.failureReport').length > 0);
    expect(pipelineRunSchema.parse((await sidecar?.call('pipeline.get', { runId }))?.result).stage).toBe('rolled_back');
    expect(await projectHash(workspace)).toBe(before);
  }, 30_000);

  it('TC-M6-044 passes shell metacharacters as literal node arguments', async () => {
    const { projectId } = await setup(0, {
      validationArgs: ['-e', 'if (process.argv[1] !== "&&") process.exit(10)', '&&'],
    });
    const response = await sidecar?.call('pipeline.start', { projectId, prompt: 'Pass a literal argument' });
    const runId = pipelineRunSchema.parse(response?.result).id;
    await waitFor(() => observed('pipeline.event').some((event) => JSON.stringify(event).includes('completed')));
    expect(pipelineRunSchema.parse((await sidecar?.call('pipeline.get', { runId }))?.result).stage).toBe('completed');
  }, 30_000);
});
