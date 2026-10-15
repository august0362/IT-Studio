import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConversationId } from '@itstudio/schemas';
import { z } from 'zod';
import { startSidecar, waitFor, type SidecarHarness } from './harness.js';
import { makeDataDir, makeProject, observed, removeDataDir, startOnDir } from './break-helpers-02.js';
import { projectSchema } from '../../src/validation/projects.js';
import { conversationSchema } from '../../src/validation/chat.js';
import { appSettingsSchema } from '../../src/validation/settings.js';
import { providerIdSchema } from '../../src/validation/common.js';
import { projectIdSchema, conversationIdSchema } from '../../src/validation/brand.js';
import { isoDateTimeSchema } from '../../src/validation/brand.js';
import { pipelineRunSchema } from '../../src/validation/pipeline.js';
import { retrievalHitSchema } from '../../src/validation/rag.js';

let sidecars: SidecarHarness[] = [];
let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(sidecars.map((sidecar) => sidecar.close()));
  await Promise.all(tempDirs.map(removeDataDir));
  sidecars = [];
  tempDirs = [];
});

const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/infra/sqlite/migrations');

async function projectHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  const visit = async (directory: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (directory === root && entry.name === '.itstudio') continue;
      const path = join(directory, entry.name);
      hash.update(path.slice(root.length));
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) hash.update(await readFile(path));
    }
  };
  await visit(root);
  return hash.digest('hex');
}

describe('QA-BREAK-02 adversarial crash durability and upgrade', () => {
  it('BRK-D01 recovers a WAL after abrupt termination during ledger writes', async () => {
    const harness = await startSidecar(
      { ITSTUDIO_E2E_LLM_TEXT: 'Crash recovery reply.' },
      { 'google/gemini-3.8-flash': Array(40).fill('ok') },
    );
    sidecars.push(harness);
    const { projectId } = await makeProject(harness, 'Crash ledger');
    const conversations: ConversationId[] = [];
    for (let index = 0; index < 20; index += 1) {
      const conversation = conversationSchema.parse(
        (await harness.call('chat.createConversation', { projectId })).result,
      );
      conversations.push(conversation.id);
    }
    await Promise.all(
      conversations.map((conversationId) => harness.call('chat.send', { conversationId, text: 'write ledger' })),
    );
    await harness.kill();
    await harness.restart();
    const database = new Database(resolve(harness.dataDir, 'itstudio.db'));
    expect(database.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    const duplicateRows = database
      .prepare('SELECT id, COUNT(*) AS count FROM ledger_entries GROUP BY id HAVING COUNT(*) > 1')
      .all();
    expect(duplicateRows).toEqual([]);
    const sums = database.prepare('SELECT COALESCE(SUM(cost_micro_usd), 0) AS cost FROM ledger_entries').get() as {
      cost: number;
    };
    expect(sums.cost).toBeGreaterThanOrEqual(0);
    database.close();
    const pnl = await harness.call('pnl.get', {
      projectId,
      from: isoDateTimeSchema.parse('2000-01-01T00:00:00.000Z'),
      to: isoDateTimeSchema.parse('2100-01-01T00:00:00.000Z'),
    });
    expect(pnl.error).toBeUndefined();
    expect(pnl.result).toMatchObject({ cost: { microUsd: sums.cost } });
  }, 60_000);

  it.each(['after_prepare', 'mid_commit'] as const)(
    'BRK-D02 crash point %s restores the project tree and fails the run',
    async (crashAt) => {
      const scripts = {
        'anthropic/claude-opus-5-5': ['ok'],
        'openai/gpt-5.3-codex': ['ok'],
        'anthropic/claude-sonnet-5-5': ['ok'],
      };
      const output = {
        'claude-opus-5-5': JSON.stringify({
          title: 'write',
          userStory: 'write',
          acceptanceCriteria: [],
          allowedPaths: ['note.txt'],
          contracts: '',
          constraints: [],
          testPlan: [],
          outOfScope: [],
        }),
        'gpt-5.3-codex': JSON.stringify({
          summary: 'write',
          operations: [{ kind: 'create', path: 'note.txt', content: 'created' }],
          assumptions: [],
        }),
        'claude-sonnet-5-5': JSON.stringify({ approved: true, findings: [], summary: 'approved' }),
      };
      const harness = await startSidecar(
        { ITSTUDIO_E2E_LLM_TEXT: JSON.stringify(output), ITSTUDIO_E2E_CRASH_AT: crashAt },
        scripts,
      );
      sidecars.push(harness);
      const workspaceRoot = resolve(harness.dataDir, 'crash-project');
      await mkdir(workspaceRoot);
      await writeFile(resolve(workspaceRoot, 'original.txt'), 'original bytes');
      const projectId = projectSchema.parse(
        (await harness.call('project.create', { name: 'Crash recovery', workspaceRoot })).result,
      ).id;
      const before = await projectHash(workspaceRoot);
      const started = await harness.call('pipeline.start', { projectId, prompt: 'write note' });
      expect(started.error).toBeUndefined();
      await waitFor(() => harness.exitCode !== null, 30_000).catch(() => undefined);
      await harness.kill();
      await harness.restart({ ITSTUDIO_E2E_CRASH_AT: '' });
      const after = await projectHash(workspaceRoot);
      expect(after).toBe(before);
      const runs = z
        .array(pipelineRunSchema)
        .parse((await harness.call('pipeline.list', { projectId, limit: 20 })).result);
      expect(runs.some((run) => run.stage === 'failed')).toBe(true);
    },
    60_000,
  );

  it('BRK-D03 restarts a sidecar killed during RAG ingest and completes a clean re-ingest', async () => {
    const harness = await startSidecar();
    sidecars.push(harness);
    const { projectId, workspaceRoot } = await makeProject(harness, 'RAG crash');
    const settings = appSettingsSchema.parse((await harness.call('settings.get')).result);
    const embeddingProvider = providerIdSchema.parse(settings.rag.embedding.modelKey.split('/')[0]);
    await harness.call('secrets.set', { provider: embeddingProvider, apiKey: 'integration-only-rag-crash-key' });
    await writeFile(resolve(workspaceRoot, 'large.md'), '# Large\n\n' + 'embedding crash fixture '.repeat(4_000));
    const started = await harness.call('rag.ingest', { projectId, paths: ['large.md'] });
    expect(started.error).toBeUndefined();
    await waitFor(
      () =>
        observed<{ id: string; status: string }>(harness, 'rag.progress').some(
          (event) => event.id === z.object({ id: z.string() }).parse(started.result).id && event.status === 'parsing',
        ),
      30_000,
    );
    await harness.kill();
    await harness.restart();
    await writeFile(resolve(workspaceRoot, 'large.md'), '# Retry\n\n' + 'small re-ingest recovery. '.repeat(100));
    await harness.call('secrets.set', {
      provider: embeddingProvider,
      apiKey: 'integration-only-rag-crash-key',
    });
    const docs = await harness.call('rag.listDocuments', { projectId });
    expect(Array.isArray(docs.result)).toBe(true);
    const retry = await harness.call('rag.ingest', { projectId, paths: ['large.md'] });
    expect(retry.error).toBeUndefined();
    const retryId = z.object({ id: z.string() }).parse(retry.result).id;
    await waitFor(
      () =>
        observed<{ id: string; status: string }>(harness, 'rag.progress').some(
          (event) => event.id === retryId && ['indexed', 'failed', 'skipped_unchanged'].includes(event.status),
        ),
      20_000,
    );
    const retryEvents = observed<{ id: string; status: string; error?: { message: string } }>(harness, 'rag.progress');
    const terminal = retryEvents.findLast(
      (event) => event.id === retryId && ['indexed', 'failed', 'skipped_unchanged'].includes(event.status),
    );
    expect(terminal?.status, JSON.stringify(terminal)).not.toBe('failed');
    const query = await harness.call('rag.query', {
      projectId,
      query: 'small re-ingest recovery',
      topK: 10,
      minScore: 0,
    });
    expect(query.error).toBeUndefined();
    const hits = z.array(retrievalHitSchema).parse(query.result);
    expect(hits.length).toBeGreaterThan(0);
    const chunkIds = hits.map((hit) => hit.chunkId);
    expect(new Set(chunkIds).size).toBe(chunkIds.length);
    expect(new Set(hits.map((hit) => hit.documentId)).size).toBeLessThanOrEqual(1);
  }, 80_000);

  it('BRK-D04 handles truncated WAL, invalid settings JSON, and missing LanceDB with a clear outcome', async () => {
    const dir = await makeDataDir();
    tempDirs.push(dir);
    const seed = await startOnDir(dir);
    sidecars.push(seed);
    await seed.call('settings.get');
    const sentinel = await makeProject(seed, 'Corruption sentinel');
    await seed.close();
    sidecars = sidecars.filter((entry) => entry !== seed);
    const db = new Database(resolve(dir, 'itstudio.db'));
    db.prepare("UPDATE settings SET json = '{invalid' WHERE id = 1").run();
    db.close();
    await writeFile(resolve(dir, 'itstudio.db-wal'), new Uint8Array([1, 2, 3, 4]));
    await rm(resolve(dir, 'lancedb'), { recursive: true, force: true });
    let recovered: SidecarHarness;
    try {
      recovered = await startOnDir(dir);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/database|wal|corrupt|recover|invalid|error/iu);
      return;
    }
    sidecars.push(recovered);
    const settings = await recovered.call('settings.get');
    expect(settings.result !== undefined || settings.error?.message.length).toBeTruthy();
    if (settings.result !== undefined) {
      expect(await recovered.call('project.list')).toMatchObject({
        result: [expect.objectContaining({ id: sentinel.projectId })],
      });
    }
    expect(recovered.stderr.join('') + recovered.stdoutLines.join('')).toMatch(/settings|database|wal|recover|error/iu);
    const check = new Database(resolve(dir, 'itstudio.db'));
    expect(check.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    check.close();
  }, 45_000);

  it('BRK-D05 keeps the database consistent when two sidecars open the same data directory', async () => {
    const dir = await makeDataDir();
    tempDirs.push(dir);
    const first = await startOnDir(dir);
    sidecars.push(first);
    const second = await startOnDir(dir).catch(() => undefined);
    if (second !== undefined) sidecars.push(second);
    await first.call('settings.get');
    if (second !== undefined) {
      await second.call('settings.get');
      const concurrentWrites = await Promise.all([
        first.call('settings.update', { patch: { ui: { locale: 'en' } } }),
        second.call('settings.update', { patch: { ui: { mode: 'dark' } } }),
      ]);
      expect(concurrentWrites.every((response) => response.error === undefined)).toBe(true);
    }
    await Promise.all(sidecars.map((instance) => instance.close()));
    sidecars = [];
    const db = new Database(resolve(dir, 'itstudio.db'));
    expect(db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    db.close();
  }, 45_000);

  it('BRK-D06 applies migration 0011 to a v0.1.0 database and preserves its legacy rows', async () => {
    const dir = await makeDataDir();
    tempDirs.push(dir);
    const databasePath = resolve(dir, 'itstudio.db');
    const db = new Database(databasePath);
    const journal = JSON.parse(await readFile(resolve(migrationRoot, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    db.exec(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)',
    );
    for (const entry of journal.entries.filter((migration) => migration.idx <= 10)) {
      const sql = await readFile(resolve(migrationRoot, `${entry.tag}.sql`), 'utf8');
      for (const statement of sql
        .split('--> statement-breakpoint')
        .map((chunk) => chunk.trim())
        .filter(Boolean))
        db.exec(statement);
      const digest = createHash('sha256').update(sql).digest('hex');
      db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(digest, entry.when);
    }
    const createdAt = new Date().toISOString();
    const legacyWorkspace = resolve(dir, 'legacy-workspace');
    await mkdir(legacyWorkspace);
    const legacyProjectId = projectIdSchema.parse('11111111-1111-4111-8111-111111111111');
    const legacyConversationId = conversationIdSchema.parse('22222222-2222-4222-8222-222222222222');
    db.prepare('INSERT INTO projects (id, name, workspace_root, created_at, archived) VALUES (?, ?, ?, ?, ?)').run(
      legacyProjectId,
      'Legacy project',
      legacyWorkspace,
      createdAt,
      0,
    );
    db.prepare(
      'INSERT INTO conversations (id, project_id, title, rag_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(legacyConversationId, legacyProjectId, 'Legacy conversation', 0, createdAt, createdAt);
    db.prepare(
      'INSERT INTO messages (id, conversation_id, role, parts_json, model_key, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      '33333333-3333-4333-8333-333333333333',
      legacyConversationId,
      'user',
      JSON.stringify([{ type: 'text', text: 'legacy message' }]),
      null,
      null,
      createdAt,
    );
    db.prepare(
      'INSERT INTO ledger_entries (id, project_id, occurred_at, purpose, model_key, llm_request_id, pipeline_run_id, conversation_id, usage_json, image_count, cost_micro_usd, price_table_version, billed_failure) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      '44444444-4444-4444-8444-444444444444',
      legacyProjectId,
      createdAt,
      'chat',
      'openai/gpt-4o-mini',
      null,
      null,
      legacyConversationId,
      JSON.stringify({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 }),
      null,
      25,
      'legacy-unknown-price-version',
      0,
    );
    db.prepare(
      'INSERT INTO revenue_entries (id, project_id, occurred_at, amount_micro_usd, entered_currency, description) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('55555555-5555-4555-8555-555555555555', legacyProjectId, createdAt, 250_000, 'USD', 'Legacy revenue');
    db.prepare('INSERT INTO settings (id, json, updated_at) VALUES (?, ?, ?)').run(1, '{}', createdAt);
    db.prepare('INSERT INTO price_tables (version, effective_from, origin, entries_json) VALUES (?, ?, ?, ?)').run(
      'legacy-v0.1.0',
      createdAt,
      'seed',
      JSON.stringify({ entries: [], manualOverrides: [] }),
    );
    const columns = db.prepare("SELECT name FROM pragma_table_info('settings')").all() as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('json');
    db.close();
    const harness = await startOnDir(dir);
    sidecars.push(harness);
    expect(await harness.call('project.list')).toMatchObject({
      result: [expect.objectContaining({ id: legacyProjectId })],
    });
    expect(await harness.call('chat.getMessages', { conversationId: legacyConversationId })).toMatchObject({
      result: [expect.objectContaining({ parts: [{ type: 'text', text: 'legacy message' }] })],
    });
    expect(await harness.call('ledger.query', { projectId: legacyProjectId, limit: 20 })).toMatchObject({
      result: {
        items: [expect.objectContaining({ costMicroUsd: 25, priceTableVersion: 'legacy-unknown-price-version' })],
      },
    });
    const legacyRevenue = await harness.call('revenue.listRows', {
      projectId: legacyProjectId,
      from: isoDateTimeSchema.parse('2000-01-01T00:00:00.000Z'),
      to: isoDateTimeSchema.parse('2100-01-01T00:00:00.000Z'),
    });
    expect(z.array(z.object({ entry: z.object({ description: z.string() }) })).parse(legacyRevenue.result)).toEqual([
      { entry: { description: 'Legacy revenue' } },
    ]);
    const statuses = z
      .array(z.object({ provider: z.string(), configured: z.boolean() }))
      .parse((await harness.call('secrets.status')).result);
    expect(statuses.find((status) => status.provider === 'openai')?.configured).toBe(false);
    const migrated = new Database(databasePath);
    const latest = migrated.prepare('SELECT MAX(created_at) AS created_at FROM __drizzle_migrations').get() as {
      created_at: number;
    };
    expect(latest.created_at).toBe(journal.entries.find((entry) => entry.idx === 11)?.when);
    migrated.close();
  }, 60_000);

  it('BRK-D07 fails promptly with a clear error when the data directory is read-only', async () => {
    const dir = await makeDataDir();
    tempDirs.push(dir);
    const seed = await startOnDir(dir);
    await seed.call('settings.get');
    await seed.close();
    const windowsUser = process.env.USERNAME;
    if (process.platform === 'win32' && windowsUser === undefined)
      throw new Error('Cannot apply read-only ACL: USERNAME is unavailable.');
    try {
      if (process.platform === 'win32') {
        if (windowsUser === undefined) throw new Error('Cannot apply read-only ACL: USERNAME is unavailable.');
        execFileSync('icacls.exe', [dir, '/inheritance:r', '/grant:r', `${windowsUser}:(RX)`], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        await chmod(dir, 0o555);
      }
      const result = await startOnDir(dir)
        .then((harness) => {
          sidecars.push(harness);
          return harness.call('settings.get').then((response) => response.error?.message ?? 'started');
        })
        .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      expect(result).not.toBe('started');
      expect(result).toMatch(/read.?only|permission|write|database|failed|unable/iu);
    } finally {
      if (process.platform === 'win32') {
        execFileSync('icacls.exe', [dir, '/reset', '/T', '/C'], { windowsHide: true, stdio: 'ignore' });
      } else {
        await chmod(dir, 0o700);
      }
    }
  }, 30_000);
});
