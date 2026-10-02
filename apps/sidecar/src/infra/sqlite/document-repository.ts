import { asc, eq, and } from 'drizzle-orm';
import type { DocumentId, ProjectId, SourceDocument } from '@itstudio/schemas';
import { documents } from './schema.js';
import type { AppDatabase } from './database.js';
import type { IDocumentRepository } from '../../ports/document-repository.js';
import { sourceDocumentSchema } from '../../validation/rag.js';
import { documentIdSchema } from '../../validation/brand.js';

export class DocumentRepository implements IDocumentRepository {
  private readonly db: AppDatabase;

  constructor(db: AppDatabase) {
    this.db = db;
  }

  list(projectId: ProjectId): Promise<readonly SourceDocument[]> {
    return Promise.resolve(
      this.db
        .select()
        .from(documents)
        .where(eq(documents.projectId, projectId))
        .orderBy(asc(documents.title))
        .all()
        .map(toDocument),
    );
  }

  getByPath(projectId: ProjectId, sourcePath: string): Promise<SourceDocument | null> {
    const row = this.db
      .select()
      .from(documents)
      .where(and(eq(documents.projectId, projectId), eq(documents.sourcePath, sourcePath)))
      .get();
    return Promise.resolve(row === undefined ? null : toDocument(row));
  }

  get(id: DocumentId): Promise<SourceDocument | null> {
    const row = this.db.select().from(documents).where(eq(documents.id, id)).get();
    return Promise.resolve(row === undefined ? null : toDocument(row));
  }

  getEmbeddingDimensions(projectId: ProjectId): Promise<ReadonlyMap<DocumentId, number>> {
    const rows = this.db
      .select({ id: documents.id, dimensions: documents.embeddingDimensions })
      .from(documents)
      .where(eq(documents.projectId, projectId))
      .all();
    return Promise.resolve(new Map(rows.map((row) => [documentIdSchema.parse(row.id), row.dimensions])));
  }

  upsert(document: SourceDocument, embeddingDimensions: number): Promise<void> {
    this.db
      .insert(documents)
      .values({
        id: document.id,
        projectId: document.projectId,
        title: document.title,
        sourcePath: document.sourcePath,
        format: document.format,
        contentHash: document.contentHash,
        chunkCount: document.chunkCount,
        embeddingModel: document.embeddingModel,
        embeddingDimensions,
        ingestedAt: document.ingestedAt,
        tagsJson: JSON.stringify(document.tags),
      })
      .onConflictDoUpdate({
        target: [documents.projectId, documents.sourcePath],
        set: {
          title: document.title,
          format: document.format,
          contentHash: document.contentHash,
          chunkCount: document.chunkCount,
          embeddingModel: document.embeddingModel,
          embeddingDimensions,
          ingestedAt: document.ingestedAt,
          tagsJson: JSON.stringify(document.tags),
        },
      })
      .run();
    return Promise.resolve();
  }

  delete(id: DocumentId): Promise<boolean> {
    return Promise.resolve(this.db.delete(documents).where(eq(documents.id, id)).run().changes > 0);
  }
}

function toDocument(row: typeof documents.$inferSelect): SourceDocument {
  let tags: unknown;
  try {
    tags = JSON.parse(row.tagsJson) as unknown;
  } catch {
    tags = [];
  }
  return sourceDocumentSchema.parse({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    sourcePath: row.sourcePath,
    format: row.format,
    contentHash: row.contentHash,
    chunkCount: row.chunkCount,
    embeddingModel: row.embeddingModel,
    ingestedAt: row.ingestedAt,
    tags,
  });
}
