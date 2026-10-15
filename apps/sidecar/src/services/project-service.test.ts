import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeFileSystem } from '../infra/node-file-system.js';
import { MemoryVectorStore } from '../infra/memory-vector-store.js';
import { LanceDbVectorStore } from '../infra/lancedb/vector-store.js';
import { loadLanceDb } from '../infra/native-modules.js';
import { loadSeeds } from '../config/load-seeds.js';
import { buildDefaultSettings } from '../domain/default-settings.js';
import { createFakeClock } from '../infra/clock.js';
import { createFakeIdGenerator } from '../infra/id.js';
import { openDatabase } from '../infra/sqlite/database.js';
import { ProjectRepository } from '../infra/sqlite/project-repository.js';
import { SettingsRepository } from '../infra/sqlite/settings-repository.js';
import { createLogger } from '../infra/logger.js';
import { SettingsService } from './settings-service.js';
import { ProjectService } from './project-service.js';
import { isoDateTimeSchema, projectIdSchema } from '../validation/brand.js';
import * as tables from '../infra/sqlite/schema.js';

const directories: string[] = [];

function createService(useLanceDb = false) {
  const dir = mkdtempSync(join(tmpdir(), 'itstudio-project-'));
  directories.push(dir);
  const opened = openDatabase(dir);
  const loaded = loadSeeds('config');
  if (!loaded.ok) throw new Error(loaded.error.message);
  const clock = createFakeClock(new Date('2026-01-01T00:00:00.000Z'));
  const settings = new SettingsService({
    repository: new SettingsRepository(opened.db),
    defaults: buildDefaultSettings(loaded.value),
    dataDir: dir,
    themeIds: new Set(loaded.value.themes.themes.map((theme) => theme.id)),
    clock,
    logger: createLogger({ streams: [] }),
  });
  const vectors = useLanceDb ? new LanceDbVectorStore(dir) : new MemoryVectorStore();
  const repository = new ProjectRepository(opened.db);
  const pipelineBusy = vi.fn(() => false);
  const forgetActivity = vi.fn(() => Promise.resolve());
  return {
    opened,
    settings,
    clock,
    vectors,
    repository,
    dir,
    pipelineBusy,
    forgetActivity,
    service: new ProjectService({
      repository,
      settings,
      ids: createFakeIdGenerator([
        'a1111111-1111-4111-8111-111111111111',
        'a2222222-2222-4222-8222-222222222222',
        'a3333333-3333-4333-8333-333333333333',
      ]),
      clock,
      fileSystem: new NodeFileSystem(),
      vectors,
      dataDir: dir,
      logger: createLogger({ streams: [] }),
      pipelineBusy,
      forgetActivity,
    }),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('ProjectService', () => {
  it('OWNER-FB2-A drops the project LanceDB table', async () => {
    const h = createService(true);
    try {
      const workspace = join(h.dir, 'workspace');
      mkdirSync(workspace);
      const created = await h.service.create('Vectors', workspace);
      if (!created.ok) throw new Error(created.error.message);
      const id = created.value.id;
      expect(
        await h.vectors.upsertChunks(id, [
          {
            projectId: id,
            documentId: '00000000-0000-4000-8000-000000000021',
            chunkId: '00000000-0000-4000-8000-000000000022',
            ordinal: 0,
            text: 'indexed text',
            sectionPath: [],
            vector: [1, 0],
          },
        ]),
      ).toMatchObject({ ok: true });
      const connection = await loadLanceDb().connect(join(h.dir, 'vectors'));
      expect((await connection.listTables()).tables).toContain(`chunks_${id}`);
      expect(await h.service.delete(id)).toEqual({ ok: true, value: { deleted: true } });
      expect((await connection.listTables()).tables).not.toContain(`chunks_${id}`);
    } finally {
      h.opened.client.close();
    }
  });

  it('OWNER-FB2-A refuses image cleanup overlapping the workspace', async () => {
    const h = createService();
    try {
      const created = await h.service.create('Overlap', h.dir);
      if (!created.ok) throw new Error(created.error.message);
      const folder = join(h.dir, 'images', created.value.id);
      mkdirSync(folder, { recursive: true });
      const preserved = join(folder, 'workspace.png');
      writeFileSync(preserved, 'preserve');
      expect(await h.service.delete(created.value.id)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(readFileSync(preserved, 'utf8')).toBe('preserve');
      expect(await h.repository.get(created.value.id)).not.toBeNull();
    } finally {
      h.opened.client.close();
    }
  });
  it('OWNER-FB2-A deletes every scoped table, vectors, and stored images while preserving workspace and other projects', async () => {
    const h = createService();
    try {
      const workspace = join(h.dir, 'workspace');
      mkdirSync(join(workspace, '.itstudio', 'tx'), { recursive: true });
      const preserved = join(workspace, '.itstudio', 'tx', 'manifest.json');
      writeFileSync(preserved, 'workspace and journals remain intact');
      const created = await h.service.create('Delete', workspace);
      if (!created.ok) throw new Error(created.error.message);
      const projectId = created.value.id;
      const otherWorkspace = join(h.dir, 'other-workspace');
      mkdirSync(otherWorkspace);
      const other = await h.service.create('Keep', otherWorkspace);
      if (!other.ok) throw new Error(other.error.message);
      const at = h.clock.now().toISOString();
      const conversationId = '00000000-0000-4000-8000-000000000011';
      const documentId = '00000000-0000-4000-8000-000000000012';
      h.opened.db
        .insert(tables.conversations)
        .values({ id: conversationId, projectId, title: 'chat', createdAt: at, updatedAt: at })
        .run();
      h.opened.db
        .insert(tables.messages)
        .values({ id: 'message', conversationId, role: 'user', partsJson: '[]', createdAt: at })
        .run();
      h.opened.db
        .insert(tables.documents)
        .values({
          id: documentId,
          projectId,
          title: 'doc',
          sourcePath: preserved,
          format: 'text',
          contentHash: 'hash',
          chunkCount: 1,
          embeddingModel: 'openai/embed',
          embeddingDimensions: 2,
          ingestedAt: at,
          tagsJson: '[]',
        })
        .run();
      h.opened.db
        .insert(tables.pipelineRuns)
        .values({ id: 'run', projectId, prompt: 'build', stage: 'completed', artifactsJson: '{}', startedAt: at })
        .run();
      h.opened.db
        .insert(tables.ledgerEntries)
        .values({
          id: 'ledger',
          projectId,
          occurredAt: at,
          purpose: 'chat',
          modelKey: 'openai/model-a',
          usageJson: '{}',
          costMicroUsd: 1,
          priceTableVersion: 'seed',
          billedFailure: 0,
        })
        .run();
      h.opened.db
        .insert(tables.revenueEntries)
        .values({
          id: 'revenue',
          projectId,
          occurredAt: at,
          amountMicroUsd: 1,
          enteredCurrency: 'USD',
          description: 'income',
        })
        .run();
      h.opened.db
        .insert(tables.budgets)
        .values({ projectId, period: 'daily', limitMicroUsd: 100, warnAtJson: '[0.8]' })
        .run();
      h.opened.db
        .insert(tables.budgetAlerts)
        .values({ projectId, period: 'daily', windowKey: 'day', threshold: 0.8, alertedAt: at })
        .run();
      h.opened.db
        .insert(tables.activityEvents)
        .values([
          { id: 'activity-delete', projectId, moduleId: 'chat', occurredAt: at, eventJson: '{}' },
          { id: 'activity-keep', projectId: other.value.id, moduleId: 'chat', occurredAt: at, eventJson: '{}' },
        ])
        .run();
      const folder = join(h.dir, 'images', projectId);
      mkdirSync(folder, { recursive: true });
      const image = join(folder, 'image.png');
      writeFileSync(image, 'stored image');
      h.opened.db
        .insert(tables.imageAssets)
        .values({
          id: 'image',
          projectId,
          provider: 'openai_dalle3',
          prompt: 'image',
          size: '1024x1024',
          mimeType: 'image/png',
          localPath: image,
          cost: 1,
          createdAt: at,
        })
        .run();
      await h.vectors.upsertChunks(projectId, [
        {
          projectId,
          documentId,
          chunkId: '00000000-0000-4000-8000-000000000013',
          ordinal: 0,
          text: 'chunk',
          sectionPath: [],
          vector: [1, 0],
        },
      ]);
      await h.vectors.upsertChunks(other.value.id, [
        {
          projectId: other.value.id,
          documentId,
          chunkId: '00000000-0000-4000-8000-000000000014',
          ordinal: 0,
          text: 'keep',
          sectionPath: [],
          vector: [1, 0],
        },
      ]);
      await h.service.setActive(projectId);
      expect(await h.service.delete(projectId)).toEqual({ ok: true, value: { deleted: true } });
      for (const table of [
        tables.conversations,
        tables.messages,
        tables.documents,
        tables.pipelineRuns,
        tables.ledgerEntries,
        tables.revenueEntries,
        tables.budgets,
        tables.budgetAlerts,
        tables.imageAssets,
      ]) {
        expect(h.opened.db.select().from(table).all()).toEqual([]);
      }
      expect(h.opened.db.select().from(tables.activityEvents).all()).toMatchObject([{ id: 'activity-keep' }]);
      expect(await h.vectors.count(projectId)).toEqual({ ok: true, value: 0 });
      expect(await h.vectors.count(other.value.id)).toEqual({ ok: true, value: 1 });
      expect(existsSync(folder)).toBe(false);
      expect(readFileSync(preserved, 'utf8')).toBe('workspace and journals remain intact');
      expect(await h.settings.get()).toMatchObject({ ok: true, value: { activeProjectId: null } });
      expect(await h.service.list()).toMatchObject({ ok: true, value: [{ id: other.value.id }] });
      expect(h.forgetActivity).toHaveBeenCalledExactlyOnceWith(projectId);
      expect(await h.service.delete(projectId)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    } finally {
      h.opened.client.close();
    }
  });

  it.each([
    'specifying',
    'clarifying',
    'coding',
    'reviewing',
    'fixing',
    're_reviewing',
    'writing',
    'validating',
    'admitting',
  ])('OWNER-FB2-A rejects deletion while a pipeline is %s', async (stage) => {
    const h = createService();
    try {
      const workspace = join(h.dir, 'workspace');
      mkdirSync(workspace);
      const created = await h.service.create('Busy', workspace);
      if (!created.ok) throw new Error(created.error.message);
      if (stage === 'admitting') h.pipelineBusy.mockReturnValue(true);
      else
        h.opened.db
          .insert(tables.pipelineRuns)
          .values({
            id: 'running',
            projectId: created.value.id,
            prompt: 'build',
            stage,
            artifactsJson: '{}',
            startedAt: h.clock.now().toISOString(),
          })
          .run();
      const drop = vi.spyOn(h.vectors, 'dropTable');
      expect(await h.service.delete(created.value.id)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
      expect(drop).not.toHaveBeenCalled();
      expect(await h.repository.get(created.value.id)).not.toBeNull();
    } finally {
      h.opened.client.close();
    }
  });

  it('OWNER-FB2-A sorts history by last opened, then creation, and leaves another active selection intact', async () => {
    const h = createService();
    try {
      const ids = [1, 2, 3].map((value) =>
        projectIdSchema.parse(`00000000-0000-4000-8000-${String(value).padStart(12, '0')}`),
      );
      for (const [index, id] of ids.entries()) {
        h.clock.advance(1000);
        await h.repository.create({
          id,
          name: `Project ${String(index)}`,
          workspaceRoot: join(h.dir, String(index)),
          createdAt: isoDateTimeSchema.parse(h.clock.now().toISOString()),
          archived: false,
        });
      }
      const [oldest, middle, newest] = ids;
      if (!oldest || !middle || !newest) throw new Error('Missing project');
      expect((await h.repository.list()).map((project) => project.id)).toEqual([newest, middle, oldest]);
      const selected = await h.service.setActive(oldest);
      expect(selected).toMatchObject({ ok: true, value: { lastOpenedAt: h.clock.now().toISOString() } });
      expect((await h.repository.list()).map((project) => project.id)).toEqual([oldest, newest, middle]);
      await h.service.setActive(middle);
      expect((await h.repository.list()).map((project) => project.id)).toEqual([middle, oldest, newest]);
      h.clock.advance(1000);
      await h.service.setActive(oldest);
      expect((await h.repository.list()).map((project) => project.id)).toEqual([oldest, middle, newest]);
      expect((await h.service.delete(newest)).ok).toBe(true);
      expect(await h.settings.get()).toMatchObject({ ok: true, value: { activeProjectId: oldest } });
    } finally {
      h.opened.client.close();
    }
  });
  it('creates projects, lists them and sets the active project', async () => {
    const { opened, service } = createService();
    const workspace = mkdtempSync(join(tmpdir(), 'itstudio-workspace-'));
    directories.push(workspace);
    const created = await service.create('Sample', workspace);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect((await service.list()).ok).toBe(true);
      expect((await service.setActive(created.value.id)).ok).toBe(true);
    }
    opened.client.close();
  });

  it('returns documented error codes for invalid roots and duplicates', async () => {
    const { opened, service } = createService();
    const workspace = mkdtempSync(join(tmpdir(), 'itstudio-workspace-'));
    directories.push(workspace);
    const file = join(workspace, 'file.txt');
    writeFileSync(file, 'x');
    expect(await service.create('relative', 'relative')).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await service.create('missing', join(workspace, 'missing'))).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await service.create('file', file)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(await service.create('root', parse(workspace).root)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
    expect((await service.create('one', workspace)).ok).toBe(true);
    expect(await service.create('duplicate', workspace)).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    opened.client.close();
  });
});
