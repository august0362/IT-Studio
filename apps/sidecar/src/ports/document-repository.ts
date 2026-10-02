import type { DocumentId, ProjectId, SourceDocument } from '@itstudio/schemas';

export interface IDocumentRepository {
  list(projectId: ProjectId): Promise<readonly SourceDocument[]>;
  getByPath(projectId: ProjectId, sourcePath: string): Promise<SourceDocument | null>;
  get(id: DocumentId): Promise<SourceDocument | null>;
  getEmbeddingDimensions(projectId: ProjectId): Promise<ReadonlyMap<DocumentId, number>>;
  upsert(document: SourceDocument, embeddingDimensions: number): Promise<void>;
  delete(id: DocumentId): Promise<boolean>;
}
