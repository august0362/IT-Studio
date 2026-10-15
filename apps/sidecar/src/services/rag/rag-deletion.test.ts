import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentId, IngestJob, SourceDocument, RpcNotificationMap } from '@itstudio/schemas';
import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import { MemoryVectorStore } from '../../infra/memory-vector-store.js';
import { systemClock } from '../../infra/clock.js';
import { systemIdGenerator } from '../../infra/id.js';
import { createLogger } from '../../infra/logger.js';
import { loadSeeds } from '../../config/load-seeds.js';
import { buildDefaultSettings } from '../../domain/default-settings.js';
import { EventBus } from '../../rpc/event-bus.js';
import { projectSchema } from '../../validation/projects.js';
import type { IDocumentRepository } from '../../ports/document-repository.js';
import { SettingsService } from '../settings-service.js';
import { RagService } from './rag-service.js';

describe('RAG source cancellation', () => {
  it.each(['embedding', 'vectors', 'metadata'] as const)(
    'QA-BREAK-02-D05 deletion wins during %s and cancels queued replacements',
    async (phase) => {
      const root = resolve('rag-delete-workspace');
      const fs = new MemoryFileSystem();
      await fs.mkdir(root, true);
      const path = resolve(root, 'guide.txt');
      await fs.writeFile(path, 'original');
      const project = projectSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Test',
        workspaceRoot: root,
        createdAt: '2026-01-01T00:00:00.000Z',
        archived: false,
      });
      const rows = new Map<DocumentId, SourceDocument>();
      const documents: IDocumentRepository = {
        list: () => Promise.resolve([...rows.values()]),
        get: (id) => Promise.resolve(rows.get(id) ?? null),
        getByPath: (_id, sourcePath) =>
          Promise.resolve([...rows.values()].find((row) => row.sourcePath === sourcePath) ?? null),
        getEmbeddingDimensions: () => Promise.resolve(new Map()),
        upsert: (row) => {
          rows.set(row.id, row);
          return Promise.resolve();
        },
        delete: (id) => Promise.resolve(rows.delete(id)),
      };
      const seeds = loadSeeds('config');
      if (!seeds.ok) throw new Error(seeds.error.message);
      let json: string | undefined;
      const settings = new SettingsService({
        repository: {
          load: () => Promise.resolve(json === undefined ? null : { json, updatedAt: '' }),
          save: (value) => {
            json = value;
            return Promise.resolve();
          },
        },
        defaults: buildDefaultSettings(seeds.value),
        dataDir: root,
        themeIds: new Set(seeds.value.themes.themes.map((theme) => theme.id)),
        clock: systemClock,
        logger: createLogger({ streams: [] }),
      });
      const vectors = new MemoryVectorStore();
      const embeddings = {
        embed: (texts: readonly string[]) => Promise.resolve({ ok: true as const, value: texts.map(() => [1, 0]) }),
      };
      const events = new EventBus<RpcNotificationMap>();
      const jobs = new Map<string, IngestJob>();
      events.subscribe('rag.progress', (job) => jobs.set(job.id, job));
      const rag = new RagService({
        projects: {
          list: () => Promise.resolve([project]),
          get: () => Promise.resolve(project),
          getByWorkspaceRoot: () => Promise.resolve(project),
          create: () => Promise.resolve(),
          setArchived: () => Promise.resolve(false),
        },
        documents,
        vectors,
        embeddings,
        settings,
        events,
        fileSystem: fs,
        ids: systemIdGenerator,
        clock: systemClock,
        logger: createLogger({ streams: [] }),
      });
      const ingest = async () => {
        const result = await rag.ingest({ projectId: project.id, paths: ['guide.txt'] });
        if (!result.ok) throw new Error(result.error.message);
        return result.value.id;
      };
      const done = async (id: string) =>
        vi.waitFor(() => {
          expect(jobs.get(id)?.status).toBe('indexed');
        });
      await done(await ingest());
      const original = [...rows.values()][0];
      if (original === undefined) throw new Error('Missing initial source');
      await fs.writeFile(path, 'replacement');
      let release = (): void => undefined;
      const blocked = new Promise<void>((resolveDone) => {
        release = resolveDone;
      });
      let entered = false;
      if (phase === 'embedding') {
        const embed = embeddings.embed;
        vi.spyOn(embeddings, 'embed').mockImplementationOnce(async (texts) => {
          entered = true;
          await blocked;
          return embed(texts);
        });
      } else if (phase === 'vectors') {
        const upsert = vectors.upsertChunks.bind(vectors);
        vi.spyOn(vectors, 'upsertChunks').mockImplementationOnce(async (...args) => {
          entered = true;
          await blocked;
          return upsert(...args);
        });
      } else {
        const upsert = documents.upsert.bind(documents);
        vi.spyOn(documents, 'upsert').mockImplementationOnce(async (...args) => {
          entered = true;
          await blocked;
          return upsert(...args);
        });
      }
      const first = await ingest();
      await vi.waitFor(() => {
        expect(entered).toBe(true);
      });
      const queued = await ingest();
      const deleting = rag.deleteDocument({ documentId: original.id });
      await new Promise<void>((resolveDone) => setImmediate(resolveDone));
      release();
      expect(await deleting).toEqual({ ok: true, value: { deleted: true } });
      await done(first);
      await done(queued);
      expect([...rows.values()]).toEqual([]);
      expect(await vectors.search(project.id, [1, 0], { topK: 10, minScore: 0 })).toEqual({ ok: true, value: [] });
      // An explicit ingest after deletion is a new generation and can recreate the source.
      await done(await ingest());
      expect([...rows.values()]).toHaveLength(1);
    },
  );
});
