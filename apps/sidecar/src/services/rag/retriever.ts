import {
  ErrorCode,
  type AppError,
  type ProjectId,
  type RetrievalHit,
  type RetrievalQuery,
  type Result,
  type SearchKnowledgeArgs,
} from '@itstudio/schemas';
import type { IDocumentRepository } from '../../ports/document-repository.js';
import type { IVectorStore } from '../../ports/vector-store.js';
import type { EmbeddingDispatcher } from '../embedding-dispatcher.js';
import type { SettingsService } from '../settings-service.js';
import { rerankMmr } from '../../domain/mmr.js';
import { retrievalHitSchema, retrievalQuerySchema } from '../../validation/rag.js';
import { documentIdSchema } from '../../validation/brand.js';
import type { WorkflowInternalEventBus } from '../workflow-internal-events.js';

const MODEL_MISMATCH = 'Knowledge index uses another embedding model — re-index required';

export interface RetrieverDependencies {
  readonly documents: IDocumentRepository;
  readonly vectors: IVectorStore;
  readonly embeddings: Pick<EmbeddingDispatcher, 'embed'>;
  readonly settings: Pick<SettingsService, 'get'>;
  readonly internalEvents?: WorkflowInternalEventBus;
}

export class Retriever {
  private readonly deps: RetrieverDependencies;

  constructor(dependencies: RetrieverDependencies) {
    this.deps = dependencies;
  }

  async query(input: RetrievalQuery): Promise<Result<readonly RetrievalHit[]>> {
    const startedAt = performance.now();
    this.deps.internalEvents?.publish({ type: 'retriever', phase: 'started', projectId: input.projectId });
    const result = await this.queryInternal(input);
    const hits = result.ok ? result.value : [];
    this.deps.internalEvents?.publish({
      type: 'retriever',
      phase: 'completed',
      projectId: input.projectId,
      hitCount: hits.length,
      ...(hits[0] === undefined ? {} : { topScore: hits[0].score }),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
    return result;
  }

  private async queryInternal(input: RetrievalQuery): Promise<Result<readonly RetrievalHit[]>> {
    const parsed = retrievalQuerySchema.safeParse(input);
    if (!parsed.success)
      return failure(ErrorCode.VALIDATION, 'Retrieval query is invalid.', ['Correct the query and retrieval options.']);
    const settings = await this.deps.settings.get();
    if (!settings.ok) return settings;
    const docs = await this.deps.documents.list(parsed.data.projectId);
    if (docs.length === 0) return { ok: true, value: [] };
    const config = settings.value.rag.embedding;
    const dimensions = await this.deps.documents.getEmbeddingDimensions(parsed.data.projectId);
    if (
      docs.some(
        (document) => document.embeddingModel !== config.modelKey || dimensions.get(document.id) !== config.dimensions,
      )
    )
      return failure(ErrorCode.VALIDATION, MODEL_MISMATCH, [
        'Re-index the project with the configured embedding model.',
      ]);

    const embeddedQuery = await this.deps.embeddings.embed([parsed.data.query], {
      projectId: parsed.data.projectId,
      purpose: 'embedding',
    });
    if (!embeddedQuery.ok) return embeddedQuery;
    const matchingDocuments =
      parsed.data.tagFilter === undefined
        ? docs
        : docs.filter((document) => parsed.data.tagFilter?.every((tag) => document.tags.includes(tag)) === true);
    if (matchingDocuments.length === 0) return { ok: true, value: [] };
    const searched = await this.deps.vectors.search(parsed.data.projectId, embeddedQuery.value[0] ?? [], {
      topK: parsed.data.topK * 2,
      minScore: parsed.data.minScore,
      documentIds: matchingDocuments.map((document) => document.id),
    });
    if (!searched.ok) return searched;
    if (searched.value.length === 0) return { ok: true, value: [] };
    const byId = new Map(matchingDocuments.map((document) => [document.id, document]));
    const candidates = searched.value.map((hit) => ({
      ...hit,
      document: byId.get(documentIdSchema.parse(hit.documentId)),
    }));
    const ranked = rerankMmr(
      candidates.filter((candidate) => candidate.document !== undefined),
      parsed.data.topK,
      0.7,
    );
    return {
      ok: true,
      value: ranked.map((candidate) =>
        retrievalHitSchema.parse({
          chunkId: candidate.chunkId,
          documentId: candidate.document?.id,
          documentTitle: candidate.document?.title,
          sectionPath: candidate.sectionPath,
          text: candidate.text,
          score: candidate.score,
        }),
      ),
    };
  }

  searchKnowledge(projectId: ProjectId, args: SearchKnowledgeArgs): Promise<Result<readonly RetrievalHit[]>> {
    const settingsResult = this.deps.settings.get();
    return settingsResult.then((settings) => {
      if (!settings.ok) return settings;
      const topK = Math.max(1, Math.min(20, Math.trunc(args.topK ?? settings.value.rag.defaultTopK)));
      return this.query({ projectId, query: args.query, topK, minScore: settings.value.rag.minScore });
    });
  }
}

function failure<T = never>(code: AppError['code'], message: string, remediation: readonly string[]): Result<T> {
  return { ok: false, error: { code, message, retryable: false, remediation } };
}
