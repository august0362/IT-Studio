import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  type AppError,
  type DocumentId,
  type IngestJob,
  type SourceDocument,
  type RpcNotificationMap,
} from '@itstudio/schemas';
import { EventBus } from '../../rpc/event-bus.js';
import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import { MemoryVectorStore } from '../../infra/memory-vector-store.js';
import { systemClock } from '../../infra/clock.js';
import { systemIdGenerator } from '../../infra/id.js';
import { loadSeeds } from '../../config/load-seeds.js';
import { buildDefaultSettings } from '../../domain/default-settings.js';
import { SettingsService } from '../settings-service.js';
import { RagService } from './rag-service.js';
import { createLogger } from '../../infra/logger.js';
import type { IDocumentRepository } from '../../ports/document-repository.js';
import type { IProjectRepository } from '../../ports/project-repository.js';
import { documentIdSchema, projectIdSchema } from '../../validation/brand.js';
import { projectSchema } from '../../validation/projects.js';

const PROJECT_ID = projectIdSchema.parse('11111111-1111-4111-8111-111111111111');

describe('RagService', () => {
  it('TC-M5-008 re-embeds after dimension changes and TC-M5-006 stops after a budget hard stop', async () => {
    const fs = new MemoryFileSystem();
    const root = resolve(process.cwd(), 'rag-service-workspace');
    await fs.mkdir(root, true);
    const file = resolve(root, 'guide.md');
    await fs.writeFile(file, '# Guide\n\nProject notes.');
    const project = projectSchema.parse({
      id: PROJECT_ID,
      name: 'Test Project',
      workspaceRoot: root,
      createdAt: '2026-01-01T00:00:00.000Z',
      archived: false,
    });
    const projects: IProjectRepository = {
      list: () => Promise.resolve([project]),
      get: (id) => Promise.resolve(id === PROJECT_ID ? project : null),
      getByWorkspaceRoot: () => Promise.resolve(project),
      create: () => Promise.resolve(),
      setArchived: () => Promise.resolve(true),
    };
    const rows = new Map<string, SourceDocument>();
    const storedDimensions = new Map<DocumentId, number>();
    const documents: IDocumentRepository = {
      list: (id) =>
        Promise.resolve(
          [...rows.values()].filter((row) => row.projectId === id).sort((a, b) => a.title.localeCompare(b.title)),
        ),
      getByPath: (id, path) =>
        Promise.resolve([...rows.values()].find((row) => row.projectId === id && row.sourcePath === path) ?? null),
      get: (id) => Promise.resolve(rows.get(id) ?? null),
      getEmbeddingDimensions: () => Promise.resolve(storedDimensions),
      upsert: (document, dimensions) => {
        rows.set(document.id, document);
        storedDimensions.set(document.id, dimensions);
        return Promise.resolve();
      },
      delete: (id) => {
        storedDimensions.delete(id);
        return Promise.resolve(rows.delete(id));
      },
    };
    const loaded = loadSeeds(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../config'));
    if (!loaded.ok) throw new Error(loaded.error.message);
    const logger = createLogger({ level: 'silent' });
    let storedSettings: { readonly json: string; readonly updatedAt: string } | null = null;
    const settings = new SettingsService({
      repository: {
        load: () => Promise.resolve(storedSettings),
        save: (json, updatedAt) => {
          storedSettings = { json, updatedAt };
          return Promise.resolve();
        },
      },
      defaults: buildDefaultSettings(loaded.value),
      dataDir: root,
      themeIds: new Set(loaded.value.themes.themes.map((theme) => theme.id)),
      clock: systemClock,
      logger,
    });
    let embedCalls = 0;
    let vectorDimensions = 1536;
    let embeddingFailure: AppError | undefined;
    const vectors = new MemoryVectorStore();
    const events = new EventBus<RpcNotificationMap>();
    const statuses: string[] = [];
    events.subscribe('rag.progress', (job) => statuses.push(job.status));
    const completed = new Promise<void>((resolveDone) => {
      events.subscribe('rag.progress', (job) => {
        if (job.status === 'indexed') resolveDone();
      });
    });
    const rag = new RagService({
      projects,
      documents,
      fileSystem: fs,
      vectors,
      embeddings: {
        embed: (texts) => {
          embedCalls += 1;
          if (embeddingFailure !== undefined) return Promise.resolve({ ok: false, error: embeddingFailure });
          return Promise.resolve({
            ok: true,
            value: texts.map(() => Array.from({ length: vectorDimensions }, (_, index) => (index === 0 ? 1 : 0))),
          });
        },
      },
      settings,
      events,
      ids: systemIdGenerator,
      clock: systemClock,
      logger,
      embeddingCost: () => Promise.resolve(45),
    });

    const first = await rag.ingest({ projectId: PROJECT_ID, paths: ['guide.md'], tags: ['manual'] });
    expect(first.ok && first.value.status).toBe('queued');
    await completed;
    expect(await documents.list(PROJECT_ID)).toHaveLength(1);
    expect(embedCalls).toBe(1);
    const documentId = (await documents.list(PROJECT_ID))[0]?.id;
    const secondDone = new Promise<void>((resolveDone) => {
      let indexedCount = 0;
      events.subscribe('rag.progress', (job) => {
        if (job.status === 'indexed' && ++indexedCount === 1) resolveDone();
      });
    });
    const second = await rag.ingest({ projectId: PROJECT_ID, paths: ['guide.md'] });
    expect(second.ok).toBe(true);
    await secondDone;
    expect(embedCalls).toBe(1);
    expect((await documents.list(PROJECT_ID))[0]?.id).toBe(documentId);
    expect(statuses).toContain('skipped_unchanged');

    await fs.writeFile(file, '# Guide\n\nUpdated project notes.');
    const thirdDone = nextIndexed(events);
    const third = await rag.ingest({ projectId: PROJECT_ID, paths: ['guide.md'] });
    expect(third.ok).toBe(true);
    await thirdDone;
    expect(embedCalls).toBe(2);
    expect((await documents.list(PROJECT_ID))[0]?.id).toBe(documentId);

    const currentSettings = await settings.get();
    if (!currentSettings.ok) throw new Error(currentSettings.error.message);
    const changedSettings = await settings.update({
      rag: { embedding: { ...currentSettings.value.rag.embedding, dimensions: 1537 } },
    });
    expect(changedSettings.ok).toBe(true);
    if (!changedSettings.ok) throw new Error(changedSettings.error.message);
    expect(changedSettings.value.rag.embedding.dimensions).toBe(1537);
    vectorDimensions = 1537;
    const fourthDone = nextIndexed(events);
    const fourth = await rag.ingest({ projectId: PROJECT_ID, paths: ['guide.md'] });
    expect(fourth.ok).toBe(true);
    const fourthJob = await fourthDone;
    expect(fourthJob.totalFiles).toBe(1);
    expect(embedCalls).toBe(3);
    expect((await documents.list(PROJECT_ID))[0]?.id).toBe(documentId);

    const budgetFile = resolve(root, 'budget.md');
    await fs.writeFile(budgetFile, '# Budget');
    const remainingBudgetFile = resolve(root, 'budget-second.md');
    await fs.writeFile(remainingBudgetFile, '# Should remain untouched');
    embeddingFailure = {
      code: ErrorCode.BUDGET_HARD_STOP,
      message: 'Budget hard stop.',
      retryable: false,
      remediation: ['Increase the project budget.'],
    };
    const budgetDone = nextStatus(events, 'failed');
    const budgetJob = await rag.ingest({ projectId: PROJECT_ID, paths: ['budget.md', 'budget-second.md'] });
    expect(budgetJob.ok).toBe(true);
    const failedBudget = await budgetDone;
    expect(failedBudget.processedFiles).toBe(1);
    expect(failedBudget.totalFiles).toBe(2);
    expect(failedBudget.cost).toBe(45);
    expect((await documents.list(PROJECT_ID)).some((row) => row.sourcePath === budgetFile)).toBe(false);
    expect((await documents.list(PROJECT_ID)).some((row) => row.sourcePath === remainingBudgetFile)).toBe(false);
    embeddingFailure = undefined;

    await fs.mkdir(resolve(root, 'mixed'), true);
    await fs.writeFile(resolve(root, 'mixed', 'a.txt'), 'First valid file.');
    await fs.writeFile(resolve(root, 'mixed', 'b.pdf'), 'not a valid pdf');
    await fs.writeFile(resolve(root, 'mixed', 'c.md'), '# Third file');
    const mixedDone = nextIndexed(events);
    const mixedJob = await rag.ingest({ projectId: PROJECT_ID, paths: ['mixed'] });
    expect(mixedJob.ok).toBe(true);
    const mixedResult = await mixedDone;
    expect(mixedResult.totalFiles).toBe(3);
    expect(mixedResult.processedFiles).toBe(3);
    expect(await documents.list(PROJECT_ID)).toHaveLength(3);

    await fs.mkdir(resolve(root, 'all-bad'), true);
    await fs.writeFile(resolve(root, 'all-bad', 'broken.pdf'), 'not a valid pdf');
    const allBadDone = nextStatus(events, 'failed');
    const allBad = await rag.ingest({ projectId: PROJECT_ID, paths: ['all-bad'] });
    expect(allBad.ok).toBe(true);
    expect((await allBadDone).processedFiles).toBe(1);

    const emptyDone = nextIndexed(events);
    const empty = await rag.ingest({ projectId: PROJECT_ID, paths: [] });
    expect(empty.ok).toBe(true);
    expect((await emptyDone).totalFiles).toBe(0);

    expect(await rag.listDocuments({ projectId: PROJECT_ID })).toMatchObject({ ok: true });
    const deletionFailure = vi.spyOn(vectors, 'deleteByDocument').mockResolvedValueOnce({
      ok: false,
      error: { code: ErrorCode.INTERNAL, message: 'vector delete failed', retryable: false, remediation: ['Retry.'] },
    });
    expect(await rag.deleteDocument({ documentId: documentIdSchema.parse(documentId) })).toMatchObject({ ok: false });
    deletionFailure.mockRestore();
    expect(await rag.deleteDocument({ documentId: documentIdSchema.parse(documentId) })).toEqual({
      ok: true,
      value: { deleted: true },
    });

    const settingsFailure = vi.spyOn(settings, 'get').mockResolvedValueOnce({
      ok: false,
      error: { code: ErrorCode.INTERNAL, message: 'settings unavailable', retryable: false, remediation: ['Retry.'] },
    });
    expect(await rag.ingest({ projectId: PROJECT_ID, paths: [] })).toMatchObject({ ok: false });
    settingsFailure.mockRestore();

    await fs.mkdir(resolve(root, 'store-failure'), true);
    await fs.writeFile(resolve(root, 'store-failure', 'write.md'), '# Store failure');
    const upsertFailure = vi.spyOn(vectors, 'upsertChunks').mockResolvedValueOnce({
      ok: false,
      error: { code: ErrorCode.INTERNAL, message: 'vector upsert failed', retryable: false, remediation: ['Retry.'] },
    });
    const storeFailed = nextStatus(events, 'failed');
    const storeFailureJob = await rag.ingest({ projectId: PROJECT_ID, paths: ['store-failure'] });
    expect(storeFailureJob.ok).toBe(true);
    await storeFailed;
    upsertFailure.mockRestore();

    const directoryFailure = {
      code: ErrorCode.INTERNAL,
      message: 'directory read failed',
      retryable: false,
      remediation: ['Retry.'],
    };
    vi.spyOn(fs, 'readdir').mockResolvedValueOnce({ ok: false, error: directoryFailure });
    const discoveryFailed = nextStatus(events, 'failed');
    const discoveryJob = await rag.ingest({ projectId: PROJECT_ID, paths: ['mixed'] });
    expect(discoveryJob.ok).toBe(true);
    await discoveryFailed;
    vi.restoreAllMocks();

    const persistedSettings = await settings.get();
    if (!persistedSettings.ok) throw new Error(persistedSettings.error.message);
    await settings.update({
      rag: { embedding: { ...persistedSettings.value.rag.embedding, dimensions: 1538 } },
    });
    vi.spyOn(vectors, 'dropTable').mockResolvedValueOnce({
      ok: false,
      error: { code: ErrorCode.INTERNAL, message: 'vector drop failed', retryable: false, remediation: ['Retry.'] },
    });
    const dropFailed = nextStatus(events, 'failed');
    const dropFailureJob = await rag.ingest({ projectId: PROJECT_ID, paths: ['mixed'] });
    expect(dropFailureJob.ok).toBe(true);
    await dropFailed;
    vi.restoreAllMocks();

    expect(
      await rag.listDocuments({ projectId: projectIdSchema.parse('22222222-2222-4222-8222-222222222222') }),
    ).toMatchObject({ ok: false, error: { code: ErrorCode.NOT_FOUND } });
    expect(
      await rag.deleteDocument({ documentId: documentIdSchema.parse('33333333-3333-4333-8333-333333333333') }),
    ).toEqual({ ok: true, value: { deleted: false } });
    expect(await rag.query({ projectId: PROJECT_ID, query: 'missing retriever', topK: 1, minScore: 0 })).toMatchObject({
      ok: false,
      error: { code: ErrorCode.INTERNAL },
    });

    const unsafe = await rag.ingest({ projectId: PROJECT_ID, paths: ['../outside.md'] });
    expect(unsafe).toMatchObject({ ok: false, error: { code: ErrorCode.VALIDATION } });
    const unknown = await rag.ingest({
      projectId: projectIdSchema.parse('22222222-2222-4222-8222-222222222222'),
      paths: [],
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: ErrorCode.NOT_FOUND } });
  });
});

function nextIndexed(events: EventBus<RpcNotificationMap>): Promise<IngestJob> {
  return nextStatus(events, 'indexed');
}

function nextStatus(events: EventBus<RpcNotificationMap>, status: IngestJob['status']): Promise<IngestJob> {
  return new Promise((resolveDone) => {
    const unsubscribe = events.subscribe('rag.progress', (job) => {
      if (job.status === status) {
        unsubscribe();
        resolveDone(job);
      }
    });
  });
}
