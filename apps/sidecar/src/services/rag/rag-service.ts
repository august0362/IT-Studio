import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import {
  ErrorCode,
  IngestStatus,
  type AppError,
  type DocumentId,
  type IngestJob,
  type ProjectId,
  type RagSettings,
  type Result,
  type RpcNotificationMap,
  type SourceDocument,
} from '@itstudio/schemas';
import type { Logger } from 'pino';
import type { IClock } from '../../infra/clock.js';
import type { IIdGenerator } from '../../infra/id.js';
import type { IFileSystem } from '../../ports/file-system.js';
import type { IProjectRepository } from '../../ports/project-repository.js';
import type { IDocumentRepository } from '../../ports/document-repository.js';
import type { IVectorStore } from '../../ports/vector-store.js';
import type { SettingsService } from '../settings-service.js';
import type { EmbeddingDispatcher } from '../embedding-dispatcher.js';
import type { EventBus } from '../../rpc/event-bus.js';
import { chunkDocument } from '../../domain/chunker.js';
import { resolveSafe } from '../../domain/path-guard.js';
import { parseDocument } from './parsers/parse-document.js';
import { discoverFiles } from './discover-files.js';
import {
  chunkIdSchema,
  documentIdSchema,
  ingestJobIdSchema,
  isoDateTimeSchema,
  microUsdSchema,
  sha256Schema,
} from '../../validation/brand.js';
import { modelKeySchema } from '../../validation/common.js';

export interface RagServiceDependencies {
  readonly projects: IProjectRepository;
  readonly documents: IDocumentRepository;
  readonly fileSystem: IFileSystem;
  readonly vectors: IVectorStore;
  readonly embeddings: Pick<EmbeddingDispatcher, 'embed'>;
  readonly settings: SettingsService;
  readonly events: EventBus<RpcNotificationMap>;
  readonly ids: IIdGenerator;
  readonly clock: IClock;
  readonly logger: Logger;
  readonly embeddingCost?: (projectId: ProjectId, startedAt: string) => Promise<number>;
}

export class RagService {
  private readonly deps: RagServiceDependencies;
  private readonly projectQueues = new Map<ProjectId, Promise<void>>();
  private readonly jobs = new Map<string, IngestJob>();

  constructor(dependencies: RagServiceDependencies) {
    this.deps = dependencies;
  }

  async ingest(input: {
    readonly projectId: ProjectId;
    readonly paths: readonly string[];
    readonly tags?: readonly string[];
  }): Promise<Result<IngestJob>> {
    const project = await this.deps.projects.get(input.projectId);
    if (project === null) return error(ErrorCode.NOT_FOUND, 'Project was not found.');
    const absolutePaths: string[] = [];
    for (const path of input.paths) {
      const safe = await resolveSafe(project.workspaceRoot, path, [path], this.deps.fileSystem);
      if (!safe.ok) return error(ErrorCode.VALIDATION, 'Every selected path must be inside the project workspace.');
      absolutePaths.push(safe.value);
    }
    const settings = await this.deps.settings.get();
    if (!settings.ok) return settings;
    const job: IngestJob = {
      id: ingestJobIdSchema.parse(this.deps.ids.uuid()),
      projectId: input.projectId,
      paths: input.paths,
      status: IngestStatus.QUEUED,
      processedFiles: 0,
      totalFiles: 0,
      cost: microUsdSchema.parse(0),
    };
    this.jobs.set(job.id, job);
    const previous = this.projectQueues.get(input.projectId) ?? Promise.resolve();
    const next = previous.then(() =>
      this.runJob(job, project.workspaceRoot, absolutePaths, input.tags ?? [], settings.value.rag),
    );
    this.projectQueues.set(
      input.projectId,
      next.catch(() => undefined),
    );
    return { ok: true, value: job };
  }

  async listDocuments(input: { readonly projectId: ProjectId }): Promise<Result<readonly SourceDocument[]>> {
    if ((await this.deps.projects.get(input.projectId)) === null)
      return error(ErrorCode.NOT_FOUND, 'Project was not found.');
    return { ok: true, value: await this.deps.documents.list(input.projectId) };
  }

  async deleteDocument(input: { readonly documentId: DocumentId }): Promise<Result<{ readonly deleted: boolean }>> {
    const document = await this.deps.documents.get(input.documentId);
    if (document === null) return { ok: true, value: { deleted: false } };
    const removed = await this.deps.vectors.deleteByDocument(tableName(document.projectId), document.id);
    if (!removed.ok) return removed;
    return { ok: true, value: { deleted: await this.deps.documents.delete(input.documentId) } };
  }

  private async runJob(
    original: IngestJob,
    workspaceRoot: string,
    selectedPaths: readonly string[],
    tags: readonly string[],
    rag: RagSettings,
  ): Promise<void> {
    const existing = await this.deps.documents.list(original.projectId);
    const storedDimensions = await this.deps.documents.getEmbeddingDimensions(original.projectId);
    const currentDimension = rag.embedding.dimensions;
    const dimensionChanged = existing.some((document) => {
      const oldDimensions = storedDimensions.get(document.id);
      return oldDimensions !== undefined && oldDimensions !== currentDimension;
    });
    if (dimensionChanged) {
      const dropped = await this.deps.vectors.dropTable(tableName(original.projectId));
      if (!dropped.ok) {
        this.finish(original, IngestStatus.FAILED, dropped.error);
        return;
      }
    }
    const paths = dimensionChanged
      ? [...selectedPaths, ...existing.map((document) => document.sourcePath)]
      : [...selectedPaths];
    const discovered = await discoverFiles(workspaceRoot, paths, this.deps.fileSystem);
    if (!discovered.ok) {
      this.finish(original, IngestStatus.FAILED, discovered.error);
      return;
    }
    const startedAt = this.deps.clock.now().toISOString();
    let job: IngestJob = { ...original, status: IngestStatus.PARSING, totalFiles: discovered.value.length };
    this.publish(job);
    let successes = 0;
    let firstError: AppError | undefined;
    for (const path of discovered.value) {
      let result: Result<{ readonly skipped: boolean }>;
      try {
        result = await this.indexFile(job, path, tags, rag, dimensionChanged);
      } catch {
        result = internalError();
      }
      if (result.ok) successes += 1;
      else {
        firstError ??= result.error;
        this.deps.logger.warn(
          { svc: 'rag', projectId: job.projectId, path, error: result.error.message },
          'RAG file indexing failed',
        );
        if (result.error.code === ErrorCode.BUDGET_HARD_STOP) {
          job = { ...job, processedFiles: job.processedFiles + 1 };
          this.publish(job);
          job = {
            ...job,
            cost: microUsdSchema.parse(
              Math.max(0, Math.trunc((await this.deps.embeddingCost?.(job.projectId, startedAt)) ?? 0)),
            ),
          };
          this.finish(job, IngestStatus.FAILED, result.error);
          return;
        }
      }
      job = {
        ...job,
        status: result.ok && result.value.skipped ? IngestStatus.SKIPPED_UNCHANGED : IngestStatus.PARSING,
        processedFiles: job.processedFiles + 1,
      };
      this.publish(job);
    }
    const cost = (await this.deps.embeddingCost?.(job.projectId, startedAt)) ?? 0;
    job = { ...job, cost: microUsdSchema.parse(Math.max(0, Math.trunc(cost))) };
    if (successes === 0 && discovered.value.length > 0) this.finish(job, IngestStatus.FAILED, firstError);
    else this.finish(job, IngestStatus.INDEXED);
  }

  private async indexFile(
    job: IngestJob,
    path: string,
    tags: readonly string[],
    rag: RagSettings,
    force: boolean,
  ): Promise<Result<{ readonly skipped: boolean }>> {
    const parsed = await parseDocument(path, this.deps.fileSystem);
    if (!parsed.ok) return parsed;
    const contentHash = sha256Schema.parse(createHash('sha256').update(parsed.value.text).digest('hex'));
    const sourcePath = path;
    const previous = await this.deps.documents.getByPath(job.projectId, sourcePath);
    if (!force && previous?.contentHash === contentHash && previous.embeddingModel === rag.embedding.modelKey)
      return { ok: true, value: { skipped: true } };
    const drafts = chunkDocument({ text: parsed.value.text, format: parsed.value.format, config: rag.chunking });
    const embeddings = await this.deps.embeddings.embed(
      drafts.map((chunk) => chunk.text),
      { projectId: job.projectId, purpose: 'embedding' },
    );
    if (!embeddings.ok) return embeddings;
    const documentId = previous?.id ?? documentIdSchema.parse(this.deps.ids.uuid());
    const rows = drafts.map((chunk, index) => ({
      chunkId: chunkIdSchema.parse(this.deps.ids.uuid()),
      documentId,
      projectId: job.projectId,
      ordinal: chunk.ordinal,
      text: chunk.text,
      sectionPath: chunk.sectionPath,
      vector: embeddings.value[index] ?? [],
      tags,
    }));
    const table = tableName(job.projectId);
    const deleted = await this.deps.vectors.deleteByDocument(table, documentId);
    if (!deleted.ok) return deleted;
    const stored = await this.deps.vectors.upsertChunks(table, rows);
    if (!stored.ok) return stored;
    await this.deps.documents.upsert(
      {
        id: documentId,
        projectId: job.projectId,
        title: parsed.value.title || basename(path, extname(path)),
        sourcePath,
        format: parsed.value.format,
        contentHash,
        chunkCount: drafts.length,
        embeddingModel: modelKeySchema.parse(rag.embedding.modelKey),
        ingestedAt: isoDateTimeSchema.parse(this.deps.clock.now().toISOString()),
        tags,
      },
      rag.embedding.dimensions,
    );
    return { ok: true, value: { skipped: false } };
  }

  private finish(job: IngestJob, status: IngestJob['status'], failure?: AppError): void {
    const completed = { ...job, status, ...(failure === undefined ? {} : { error: failure }) };
    this.jobs.set(job.id, completed);
    this.publish(completed);
  }

  private publish(job: IngestJob): void {
    this.jobs.set(job.id, job);
    this.deps.events.publish('rag.progress', job);
  }
}

function tableName(projectId: ProjectId): string {
  return projectId;
}

function error<T = never>(code: AppError['code'], message: string): Result<T> {
  return { ok: false, error: { code, message, retryable: false, remediation: ['Check the project and try again.'] } };
}

function internalError(): Result<never> {
  return {
    ok: false,
    error: {
      code: ErrorCode.INTERNAL,
      message: 'Document indexing failed unexpectedly.',
      retryable: false,
      remediation: ['Check the document and storage permissions, then retry the ingest.'],
    },
  };
}
